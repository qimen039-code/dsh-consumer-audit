/**
 * Verify the plugin object itself, without starting DSH.
 *
 * Proves: the default export is apply(), it registers through the real service
 * contracts (ctx.get("tools").register / ctx.get("skills").register), the
 * registered tool's execute() actually produces a report from real data, and the
 * fiber's disposer tears the registrations down.
 */
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const pkgRoot = process.argv[2] ? process.argv[2] : join(import.meta.dirname, "..");
const mod = await import(pathToFileURL(join(pkgRoot, "lib", "index.js")).href);

const registrations = { tools: [], skills: [], effectDisposers: [] };
const live = { tools: new Set(), skills: new Set() };

const ctx = {
  get(name) {
    if (name === "tools") {
      return {
        register(def) {
          registrations.tools.push(def);
          live.tools.add(def.name);
          return () => live.tools.delete(def.name);
        },
      };
    }
    if (name === "skills") {
      return {
        register(skill) {
          registrations.skills.push(skill);
          live.skills.add(skill.name);
          return () => live.skills.delete(skill.name);
        },
      };
    }
    return undefined;
  },
  effect(callback) {
    registrations.effectDisposers.push(callback());
    return () => {};
  },
  on() {
    return () => {};
  },
};

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });

// Assert the contract the loader actually uses, read off two plugins that load
// in this deployment (export default { name, inject?, apply(ctx) }). The first
// version of this file asserted a bare exported function — a contract invented
// here — so it passed while the plugin could not have loaded.
check("default export is an object", mod.default !== null && typeof mod.default === "object", typeof mod.default);
check("plugin declares a name", typeof mod.default?.name === "string" && mod.default.name.length > 0, mod.default?.name);
check("plugin exposes apply()", typeof mod.default?.apply === "function", typeof mod.default?.apply);

// Supply the shipped-presets root explicitly, so this harness and tools/run-audit.mjs
// scan the same skill set. Otherwise the two report different unassessed counts
// and neither is wrong — which is exactly the kind of silent difference the
// report now records under generated_from.preset_roots_searched.
let shippedPresetsDir;
try {
  const { createRequire } = await import("node:module");
  const { dirname: dn, join: jn } = await import("node:path");
  const req = createRequire(join(pkgRoot, "lib", "index.js"));
  shippedPresetsDir =
    process.env.SHIPPED_PRESETS_DIR ??
    jn(dn(req.resolve("@deepseek-ai/dsh-agent-presets/package.json")), "presets");
} catch {
  shippedPresetsDir = process.env.SHIPPED_PRESETS_DIR;
}
check("shipped presets root resolution attempted", true, shippedPresetsDir ?? "(not resolved — must be visible as unsearched in the report)");

const api = mod.default.apply(ctx, { profile: "desktop", shippedPresetsDir });
check("apply() returns its declared surface", Array.isArray(api?.tools) && Array.isArray(api?.skills), JSON.stringify(api));
check("one tool registered", registrations.tools.length === 1, registrations.tools.map((t) => t.name));
check("one skill registered", registrations.skills.length === 1, registrations.skills.map((s) => s.name));

const tool = registrations.tools[0];
check("tool name", tool?.name === "consumer_audit", tool?.name);
check("tool has parameters schema", tool?.parameters?.type === "object", JSON.stringify(tool?.parameters?.required));
check("tool declares an output renderer", typeof tool?.output?.render === "function", typeof tool?.output?.render);

const skill = registrations.skills[0];
check("skill name is kebab-case", /^[a-z0-9]+(-[a-z0-9]+)*$/.test(skill?.name ?? ""), skill?.name);
check("skill body was loaded from disk", (skill?.content ?? "").length > 2000, `${(skill?.content ?? "").length} chars`);
check("skill is model-invocable", skill?.invocation?.modelInvocable === true, JSON.stringify(skill?.invocation));

const t0 = Date.now();
const report = await tool.execute({ action: "report" }, {});
const seconds = (Date.now() - t0) / 1000;
check("execute returned our report schema", report?.schema === "dsh-consumer-audit/report/v1", report?.schema);
check("execute measured the real machine", (report?.measured?.sessions_scanned ?? 0) > 0, JSON.stringify(report?.measured?.sessions_scanned));
check("report carries boundaries", Array.isArray(report?.boundaries) && report.boundaries.length > 0, report?.boundaries?.length);

// The report must state which roots it searched, and the shipped-preset root
// must be marked searched exactly when one was supplied. Without this the run
// that has no root silently reports fewer skills and looks like a clean result.
const roots = report?.generated_from?.preset_roots_searched ?? [];
check("report lists the preset roots it searched", roots.length > 0, JSON.stringify(roots.map((r) => `${r.origin}:${r.searched}`)));
const shippedRoot = roots.find((r) => r.origin === "shipped preset");
check(
  "shipped-preset root marked searched iff one was supplied",
  Boolean(shippedRoot?.searched) === Boolean(shippedPresetsDir),
  `supplied=${Boolean(shippedPresetsDir)} searched=${Boolean(shippedRoot?.searched)}`,
);

const rendered = tool.output.render({}, report);
check("renderer produced content blocks", Array.isArray(rendered) && rendered[0]?.type === "text", JSON.stringify(rendered?.[0]?.type));

const abl = await tool.execute({ action: "ablation" }, {});
check("ablation action returns a verdict", typeof abl?.ablation?.verdict === "string", abl?.ablation?.verdict);

for (const d of registrations.effectDisposers) d();
check("disposer removed the tool", live.tools.size === 0, [...live.tools]);
check("disposer removed the skill", live.skills.size === 0, [...live.skills]);

console.log(
  JSON.stringify(
    {
      checks,
      passed: checks.filter((c) => c.ok).length,
      total: checks.length,
      execute_seconds: Number(seconds.toFixed(2)),
      findings: report?.findings?.map((f) => `${f.kind}: ${f.object}`) ?? [],
      notes: report?.notes?.map((n) => `${n.kind}: ${n.object}`) ?? [],
      ablation_verdict: abl?.ablation?.verdict,
    },
    null,
    2,
  ),
);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
