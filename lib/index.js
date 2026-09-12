/**
 * dsh-consumer-audit — host half.
 *
 * Registers one tool (`consumer_audit`) and one skill (`consumer-audit`).
 * The tool measures; the skill says how to reason about what was measured.
 * Neither one makes a semantic judgement about a plugin.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { audit, ablation } from "./audit.js";
import { collect, collectInvocationEvidence } from "./collect.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = join(HERE, "..", "skills", "consumer-audit", "SKILL.md");
const require = createRequire(import.meta.url);

/**
 * The shipped presets live inside @deepseek-ai/dsh-agent-presets. Without this
 * the scan silently drops every shipped skill, so resolve it rather than making
 * it a config field someone has to know about. If it cannot be resolved, the
 * report says which roots were searched instead of quietly reporting fewer.
 */
function defaultShippedPresetsDir() {
  try {
    const pkg = require.resolve("@deepseek-ai/dsh-agent-presets/package.json");
    return join(dirname(pkg), "presets");
  } catch {
    return undefined;
  }
}

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
    "Inventory the active DSH profile: which composition rows are declared, which capabilities each installed package registers, and how many times each of those capabilities was actually invoked in the session logs on this machine. Reports declared-but-unconsumed capabilities, and lists the counts for the ones that are used. A count establishes that a tool was called or a skill was loaded. It does not establish that the capability did anything useful, and no log signal in this profile establishes that. It measures; it does not judge quality.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["report", "ablation", "evidence"],
        description:
          "'report' returns the findings. 'ablation' runs the audit twice, with and without consumer counting, and reports what the consumer evidence changed. 'evidence' returns the actual invocations of one capability, with the arguments passed and the text returned, so its behaviour can be read rather than inferred.",
      },
      name: {
        type: "string",
        description: "With action='evidence', the tool or skill name to pull invocations for.",
      },
      limit: {
        type: "number",
        description: "With action='evidence', how many of the most recent invocations to return. Defaults to 5.",
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
    if (args?.action === "evidence") {
      if (typeof args.name !== "string" || args.name.length === 0) {
        return { error: "EVIDENCE_NAME_REQUIRED", detail: "action='evidence' needs the tool or skill name to look up" };
      }
      const limit = Number.isInteger(args.limit) && args.limit > 0 ? Math.min(args.limit, 20) : 5;
      const ev = collectInvocationEvidence({ dshHome, names: [args.name], perName: limit });
      const invocations = ev.per_name[args.name] ?? [];
      return {
        schema: "dsh-consumer-audit/evidence/v1",
        name: args.name,
        sessions_scanned: ev.sessions_scanned,
        invocation_count: invocations.length,
        invocations,
        note: "These are the arguments the model passed and the text that came back. Whether the behaviour matches what this capability is designed to do is your judgement, not this tool's.",
      };
    }

    const countConsumers = args?.count_consumers !== false;
    const shippedPresetsDir =
      (typeof this?.config?.shippedPresetsDir === "string" ? this.config.shippedPresetsDir : undefined) ??
      defaultShippedPresetsDir();
    const input = collect({
      dshHome,
      profileDir,
      shippedPresetsDir,
      countConsumersToo: countConsumers,
    });
    input.searchedRoots = input.searchedRoots ?? [];
    const report = audit(input, { countConsumers });
    report.measured = {
      dsh_home: dshHome,
      profile_dir: profileDir,
      searched_roots: input.searchedRoots,
      shipped_presets_dir: shippedPresetsDir ?? null,
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
  // Both services are hard dependencies. Without `inject` Cordis does not put
  // them on the fiber, and `ctx.get("tools")` returns undefined during apply, so
  // the plugin would load and register nothing at all.
  inject: ["tools", "skills"],
  apply(ctx, config) {
    // Only the second argument. Reading `ctx.config` throws "cannot get property
    // config without inject" in Cordis, so the tempting defensive fallback is an
    // immediate boot failure rather than a safety net.
    const cfg = config ?? {};
    const disposers = [];
    const settings = { config: cfg };

    const tool = { ...AUDIT_TOOL, execute: AUDIT_TOOL.execute.bind(settings) };
    disposers.push(ctx.tools.register(tool));

    const body = skillBody();
    if (body) {
      disposers.push(
        ctx.skills.register({
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

    // No return value. Cordis executes apply's result as an effect, so returning
    // a plain descriptor object is rejected with TypeError("Invalid effect") and
    // the whole plugin tree fails to boot.
  },
};
