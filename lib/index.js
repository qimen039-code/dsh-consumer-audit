/**
 * dsh-consumer-audit — host half.
 *
 * Registers one tool (`consumer_audit`) and one skill (`consumer-audit`).
 * The tool measures; the skill says how to reason about what was measured.
 * Neither one makes a semantic judgement about a plugin.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { audit, ablation } from "./audit.js";
import { collect } from "./collect.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = join(HERE, "..", "skills", "consumer-audit", "SKILL.md");

function skillBody() {
  try {
    return readFileSync(SKILL_PATH, "utf8");
  } catch {
    return undefined;
  }
}

function resolveHome(config) {
  const fromConfig = typeof config?.dshHome === "string" ? config.dshHome : undefined;
  const fromEnv = process.env.DSH_HOME;
  if (fromConfig) return fromConfig;
  if (fromEnv) return fromEnv;
  const home = process.env.USERPROFILE ?? process.env.HOME;
  return home ? join(home, ".dsh") : undefined;
}

function profilePath(dshHome, config) {
  if (typeof config?.profileDir === "string") return config.profileDir;
  return join(dshHome, "profiles", typeof config?.profile === "string" ? config.profile : "desktop");
}

const AUDIT_TOOL = {
  name: "consumer_audit",
  description:
    "Inventory the active DSH profile: which composition rows are declared, which capabilities each installed package registers, and how many times each of those capabilities was actually invoked in the session logs on this machine. Reports declared-but-unconsumed capabilities. It measures; it does not judge quality.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["report", "ablation"],
        description:
          "'report' returns the findings. 'ablation' runs the audit twice, with and without consumer counting, and reports what the consumer evidence changed.",
      },
      count_consumers: {
        type: "boolean",
        description: "Set false to skip scanning session logs; findings that need invocation counts are then reported as unassessed rather than as zero.",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  output: {
    schema: { type: "object", description: "A JSON audit report." },
    render(_args, value) {
      const text = JSON.stringify(value, null, 2);
      return [{ type: "text", text }];
    },
  },
  async execute(args, exec) {
    const dshHome = resolveHome(this?.config);
    if (!dshHome) {
      return { error: "DSH_HOME_UNRESOLVED", detail: "set DSH_HOME or configure dshHome on this plugin row" };
    }
    const profileDir = profilePath(dshHome, this?.config);
    const countConsumers = args?.count_consumers !== false;
    const input = collect({
      dshHome,
      profileDir,
      shippedPresetsDir: this?.config?.shippedPresetsDir,
      countConsumersToo: countConsumers,
    });
    input.searchedRoots = input.searchedRoots ?? [];
    const report = audit(input, { countConsumers });
    report.measured = {
      dsh_home: dshHome,
      profile_dir: profileDir,
      searched_roots: input.searchedRoots,
      sessions_scanned: input.sessionsScanned,
      invocation_names_seen: Object.keys(input.invocations).length,
      collect_console: input.console,
    };
    report.notes = report.notes ?? [];
    if (args?.action === "ablation") {
      return { report, ablation: ablation(input) };
    }
    return report;
  },
};

export default {
  name: "dsh-consumer-audit",
  // No `inject`: tools and skills are read optionally and both call sites are
  // guarded, so the plugin stays loadable in a composition without them.
  apply(ctx, config) {
    const cfg = config ?? (typeof ctx === "object" && ctx !== null ? ctx.config : undefined) ?? {};
    const disposers = [];
    const settings = { config: cfg };

    const tool = { ...AUDIT_TOOL, execute: AUDIT_TOOL.execute.bind(settings) };

    const tools = ctx.get("tools");
    if (tools && typeof tools.register === "function") {
      disposers.push(tools.register(tool));
    }

    const skills = ctx.get("skills");
    const body = skillBody();
    if (skills && typeof skills.register === "function" && body) {
      disposers.push(
        skills.register({
          name: "consumer-audit",
          description:
            "Use when a task asserts that work is complete, or when auditing whether a declared capability is actually consumed. Supplies the boundary statement, the evidence-chain completion format, the ablation requirement, and the reading of a consumer_audit report.",
          whenToUse:
            "Before writing any claim that something is finished, fixed, implemented or in effect; and when asked to review existing plugins, skills or composition rows for redundancy or pseudo-implementations.",
          content: body,
          source: "runtime",
          provider: "dsh-consumer-audit",
          invocation: { modelInvocable: true, userInvocable: true },
        }),
      );
    }

    ctx.effect(() => () => {
      for (const d of disposers.reverse()) {
        try {
          d();
        } catch {
          /* disposal is best-effort; the fiber owns teardown */
        }
      }
    });

    return { tools: ["consumer_audit"], skills: body ? ["consumer-audit"] : [] };
  },
};
