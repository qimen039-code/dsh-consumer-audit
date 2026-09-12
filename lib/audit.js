/**
 * Pure audit logic. No I/O, no DSH services, no globals beyond standard JS.
 *
 * The point of separating this from collection is that the *judgement* can be
 * re-run and disagreed with independently of how the facts were gathered:
 * feed it a different inventory and it must produce different findings.
 */

/** A row that declares a capability is only "consumed" if something invoked it. */
const CAPABILITY_KINDS = ["tools", "services", "promptSections", "skills", "commands", "routes"];

/** Packages that ship with the harness itself are not profile-installed. */
const FIRST_PARTY = /^@deepseek-ai\//;

function classify(finding) {
  // The taxonomy used for "why did the last attempt not take effect".
  if (finding.kind === "package_unresolved") return "activation_gap";
  if (finding.kind === "row_without_capability") return "coverage_gap";
  if (finding.kind === "prompt_only_capability") return "action_application_gap";
  if (finding.kind === "duplicate_prompt_section") return "action_application_gap";
  if (finding.kind.endsWith("never_invoked") || finding.kind === "skill_never_loaded") {
    return "consumer_verification_gap";
  }
  return "consumer_verification_gap";
}

/**
 * @param {object} input
 * @param {Array<{id:string,name:string,origin:string}>} input.rows
 * @param {Record<string,{resolved:boolean,dir?:string,registrations?:Record<string,string[]>,scanned?:number}>} input.packages
 * @param {Record<string,number>} input.invocations  tool name -> observed call count
 * @param {Array<{name:string,preset:string,path:string}>} input.skillsOnDisk
 * @param {Record<string,number>} input.skillLoads    skill name -> observed load count
 * @param {{countConsumers?:boolean}} [options]
 */
export function audit(input, options = {}) {
  const countConsumers = options.countConsumers !== false;
  const rows = input.rows ?? [];
  const packages = input.packages ?? {};
  const invocations = countConsumers ? (input.invocations ?? {}) : {};
  const skillsOnDisk = input.skillsOnDisk ?? [];
  const skillLoads = countConsumers ? (input.skillLoads ?? {}) : {};

  const findings = [];
  const unassessed = [];
  const notes = [];
  const sectionOwners = new Map();

  for (const row of rows) {
    const pkg = packages[row.name];
    if (!pkg || pkg.resolved === false) {
      // First-party packages ship inside the harness, not the profile. Reporting
      // them as missing would be a false alarm about a healthy deployment.
      if (FIRST_PARTY.test(row.name)) {
        notes.push({
          kind: "first_party_shipped",
          object: `${row.id} -> ${row.name}`,
          detail: "not found in the searched profile roots; a first-party package is expected to ship with the harness",
          evidence: { locator: row.origin, method: `searched: ${(input.searchedRoots ?? []).join(" | ")}` },
        });
        continue;
      }
      findings.push({
        kind: "package_unresolved",
        object: `${row.id} -> ${row.name}`,
        detail: "the row is declared but no installed package directory could be resolved for it",
        consumer_count: null,
        evidence: { locator: row.origin, method: `searched: ${(input.searchedRoots ?? []).join(" | ")}` },
        falsifier: `resolve ${row.name} from one of the searched roots and show the row contributes a capability`,
      });
      continue;
    }
    const reg = pkg.registrations ?? {};
    const present = CAPABILITY_KINDS.filter((k) => (reg[k] ?? []).length > 0);
    if (present.length === 0) {
      if ((reg.effects ?? []).length > 0) {
        // Wrapping an existing service method is a real mechanism and registers
        // no new capability, so invocation counting cannot judge it. Say that
        // instead of calling the row empty.
        notes.push({
          kind: "intercepts_host_behaviour",
          object: `${row.id} -> ${row.name}`,
          detail: `${(reg.effects ?? []).length} effect site(s) and no new capability: this row changes host behaviour in place`,
          evidence: { locator: pkg.dir, method: "static scan found ctx.effect and no registration call site" },
        });
        continue;
      }
      findings.push({
        kind: "row_without_capability",
        object: `${row.id} -> ${row.name}`,
        detail: `package resolved at ${pkg.dir}, but no registration or effect site was found in its sources`,
        consumer_count: null,
        evidence: { locator: `${pkg.dir} (scanned ${pkg.scanned ?? 0} files)`, method: "static scan for registration and effect call sites" },
        falsifier: "show a registration or effect site in that package's sources that the scan misses",
      });
      continue;
    }
    if (present.length === 1 && present[0] === "promptSections") {
      findings.push({
        kind: "prompt_only_capability",
        object: `${row.id} -> ${row.name}`,
        detail: "the package contributes prompt text only; it registers no tool, service, route or command",
        consumer_count: null,
        evidence: { locator: `${pkg.dir}`, method: "registration call sites found: promptSections only" },
        falsifier: "show a non-prompt registration in that package",
      });
    }
    for (const section of reg.promptSections ?? []) {
      const owner = sectionOwners.get(section);
      if (owner && owner !== row.name) {
        findings.push({
          kind: "duplicate_prompt_section",
          object: `prompt section "${section}"`,
          detail: `registered by both ${owner} and ${row.name}`,
          consumer_count: null,
          evidence: { locator: `${pkg.dir}`, method: "two packages register the same section name" },
          falsifier: "show that only one of the two registrations reaches the assembled prompt",
        });
      } else {
        sectionOwners.set(section, row.name);
      }
    }
    for (const tool of reg.tools ?? []) {
      if (!countConsumers) {
        unassessed.push({ kind: "tool_never_invoked", object: `${tool} (from ${row.name})`, reason: "consumer counting disabled in this run" });
        continue;
      }
      const n = invocations[tool] ?? 0;
      if (n === 0) {
        findings.push({
          kind: "tool_never_invoked",
          object: `${tool} (from ${row.name})`,
          detail: "the tool is registered but no invocation of it was found in the scanned session logs",
          consumer_count: 0,
          evidence: {
            locator: `${pkg.dir}`,
            method: `tool name "${tool}" searched across ${input.sessionsScanned ?? 0} scanned session logs`,
          },
          falsifier: `find one invocation of "${tool}" in a session log this run did not scan`,
        });
      }
    }
  }

  for (const skill of skillsOnDisk) {
    if (!countConsumers) {
      unassessed.push({ kind: "skill_never_loaded", object: `${skill.name} (${skill.preset})`, reason: "consumer counting disabled in this run" });
      continue;
    }
    const n = skillLoads[skill.name] ?? 0;
    if (n === 0) {
      findings.push({
        kind: "skill_never_loaded",
        object: `${skill.name} (${skill.preset})`,
        detail: "the skill file exists on disk but no load of it was found in the scanned session logs",
        consumer_count: 0,
        evidence: { locator: skill.path, method: "skill name searched across the scanned session logs" },
        falsifier: `find one load of "${skill.name}", or show the preset holding it is never used`,
      });
    }
  }

  for (const f of findings) f.classification = classify(f);

  return {
    schema: "dsh-consumer-audit/report/v1",
    generated_from: {
      rows: rows.length,
      resolved_packages: Object.values(packages).filter((p) => p.resolved !== false).length,
      sessions_scanned: countConsumers ? (input.sessionsScanned ?? 0) : 0,
      consumer_counting: countConsumers,
    },
    findings,
    notes,
    unassessed,
    counts_by_kind: findings.reduce((acc, f) => ((acc[f.kind] = (acc[f.kind] ?? 0) + 1), acc), {}),
    // Stated once, for every consumer of this report.
    boundaries: [
      "A static registration site is evidence that a capability is declared, not that it works.",
      "An invocation count is evidence about the logs that were scanned, not about the world: a tool used in an unscanned profile or before the log window reads as unused.",
      "Packages that ship with the harness are not searched for; they are recorded as first_party_shipped, not reported missing.",
      "A row that wraps an existing service method registers no capability and is reported as intercepts_host_behaviour; invocation counting cannot judge it.",
      "Prompt-only is inferred from registration call sites; a package that builds prompt text elsewhere is misreported.",
      "Skill consumption is counted from skill-catalog injections and skill loads in the scanned logs; a skill held by a preset that was never used reads as unused.",
      "This report contains no semantic judgement. It does not say a plugin is bad.",
    ],
  };
}

/**
 * Ablation: run once with consumer counting and once with it disabled, and state
 * exactly what the consumer evidence bought.
 *
 * With counting disabled the tool must NOT claim "never invoked" — it can only
 * say "not assessed". An ablation that merely breaks the input would look like it
 * changed a lot while proving nothing.
 */
export function ablation(input) {
  const withConsumers = audit(input, { countConsumers: true });
  const without = audit(input, { countConsumers: false });
  const key = (f) => `${f.kind}|${f.object}`;
  const a = new Set(withConsumers.findings.map(key));
  const b = new Set(without.findings.map(key));
  const onlyWith = [...a].filter((k) => !b.has(k));
  const onlyWithout = [...b].filter((k) => !a.has(k));
  return {
    with_consumers: withConsumers.counts_by_kind,
    without_consumers: without.counts_by_kind,
    unassessed_without_consumers: without.unassessed.length,
    findings_only_with_consumer_evidence: onlyWith,
    findings_only_without: onlyWithout,
    verdict:
      onlyWith.length > 0
        ? `consumer evidence narrowed ${without.unassessed.length} declared-but-unmeasured capabilities into ${onlyWith.length} finding(s)`
        : "consumer evidence changed nothing: the report is a plain inventory",
    falsifier:
      "produce an input where a finding attributed to consumer evidence is not actually supported by an invocation count in the scanned logs",
  };
}
