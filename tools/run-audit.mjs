import { join } from "node:path";
import { homedir } from "node:os";
import { collect } from "../lib/collect.js";
import { audit, ablation } from "../lib/audit.js";

const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
const profileDir = `${dshHome}\\profiles\\desktop`;
const shippedPresetsDir = process.env.SHIPPED_PRESETS_DIR;

const t0 = Date.now();
const input = collect({ dshHome, profileDir, shippedPresetsDir });
const seconds = ((Date.now() - t0) / 1000).toFixed(2);

console.log(
  JSON.stringify(
    {
      collect_seconds: seconds,
      console: input.console,
      rows: input.rows,
      packages: Object.fromEntries(
        Object.entries(input.packages).map(([k, v]) => [
          k,
          v.resolved === false ? { resolved: false } : { resolved: true, dir: v.dir, scanned: v.scanned, registrations: v.registrations },
        ]),
      ),
      skills_on_disk: input.skillsOnDisk,
      invocation_names: Object.keys(input.invocations).sort(),
    },
    null,
    2,
  ),
);

const report = audit(input);
console.log("\n=== REPORT ===");
console.log(JSON.stringify({ generated_from: report.generated_from, counts_by_kind: report.counts_by_kind }, null, 2));
for (const f of report.findings) {
  console.log(`- [${f.kind}/${f.classification}] ${f.object}: ${f.detail}`);
}
console.log("\n=== ABLATION ===");
console.log(JSON.stringify(ablation(input), null, 2));
