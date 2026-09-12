/**
 * Mechanically check the requirements the market's contributing.md states for an
 * entry, plus the wiring this package needs in order to be loadable at all.
 * It does not judge quality and it cannot check repo age.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const entryPath = join(root, "market", "data__plugins__qimen039-code__dsh-consumer-audit.yml");
const entry = existsSync(entryPath) ? readFileSync(entryPath, "utf8") : "";

// --- dsh.bundle manifest
check("package.json declares dsh.bundle.patch", pkg?.dsh?.bundle?.patch === "./cordis.patch.yml", pkg?.dsh?.bundle?.patch);
const patchPath = join(root, "cordis.patch.yml");
check("cordis.patch.yml exists next to package.json", existsSync(patchPath), patchPath);
const patch = existsSync(patchPath) ? readFileSync(patchPath, "utf8") : "";
check("patch has the insert list shape", /^-\s*insert:\s*$/m.test(patch) && /^\s+-\s+id:/m.test(patch));
check("patch row name matches the package name", patch.includes(`name: ${pkg.name}`), pkg.name);
check("main entry exists", existsSync(join(root, "package.json")) && existsSync(join(root, pkg.main ?? "")));

// --- market entry file
check("entry file present", entry.length > 0, entryPath);
const urlMatch = /^url:\s*(\S+)$/m.exec(entry);
check("entry url is a github repo url", /^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(urlMatch?.[1] ?? ""), urlMatch?.[1]);
const nameMatch = /^name:\s*(\S+)$/m.exec(entry);
check("entry name is owner/repo", /^[^/\s]+\/[^/\s]+$/.test(nameMatch?.[1] ?? ""), nameMatch?.[1]);
check(
  "entry url and name agree",
  (urlMatch?.[1] ?? "").replace("https://github.com/", "") === (nameMatch?.[1] ?? ""),
  `${urlMatch?.[1]} vs ${nameMatch?.[1]}`,
);
const CATEGORIES = "agi ui usage theme model identity session memory tools wsl browser vision voice docs skill workflow git notify dev security remote market fun".split(" ");
const cat = /^category:\s*(\S+)$/m.exec(entry)?.[1];
check("category is one of the allowed values", CATEGORIES.includes(cat ?? ""), cat);

// description.en must exist and end with a period; ": " forces quoting
const rawEn = /^\s*en:\s*(.*)$/m.exec(entry)?.[1] ?? "";
const en = /^(['"])([\s\S]*)\1$/.exec(rawEn.trim())?.[2] ?? rawEn.trim();
check("description.en present", en.length > 20, en.slice(0, 40));
check("description.en ends with a period", en.trim().endsWith("."), en.slice(-20));
check(
  "description containing ': ' is quoted",
  !en.includes(": ") || /^(['"])/.test(rawEn.trim()),
  rawEn.trim().slice(0, 12),
);

// description must not claim things the code does not expose
check("described tool name exists in source", readFileSync(join(root, "lib", "index.js"), "utf8").includes("consumer_audit"));
check("described skill name exists in source", readFileSync(join(root, "lib", "index.js"), "utf8").includes('"consumer-audit"'));

// --- peer ranges: explicit prerelease branch per contributing.md
//
// The rule applies to packages that publish prereleases (the harness packages
// versioned 0.1.x-rc.N). @deepseek-ai/cordis is on a stable 4.x line, so ^4.0.1
// is already correct and demanding a prerelease branch there would be wrong.
const peers = pkg.peerDependencies ?? {};
for (const [dep, range] of Object.entries(peers)) {
  const publishesPrereleases = /^@deepseek-ai\/dsh-/.test(dep);
  if (!publishesPrereleases) {
    check(`peer ${dep} resolves against a stable line`, /^\^?\d+\.\d+\.\d+$/.test(range), range);
    continue;
  }
  check(`peer ${dep} has an explicit prerelease branch`, range.includes("||") && /-rc\.|-alpha\.|-beta\./.test(range), range);
}
// A bare `>=x <y` range silently excludes every prerelease; reject that shape.
for (const [dep, range] of Object.entries(peers)) {
  if (!/^@deepseek-ai\/dsh-/.test(dep)) continue;
  const silentlyExcludes = !range.includes("||") && /^>=/.test(range);
  check(`peer ${dep} does not use a bare >= range`, !silentlyExcludes, range);
}
check(
  "official @deepseek-ai packages are peers, not dependencies",
  Object.keys(pkg.dependencies ?? {}).every((d) => !d.startsWith("@deepseek-ai/")),
  JSON.stringify(Object.keys(pkg.dependencies ?? {})),
);
check("no install-time scripts", pkg.scripts === undefined, JSON.stringify(pkg.scripts));

console.log(JSON.stringify({ passed: checks.filter((c) => c.ok).length, total: checks.length, checks }, null, 2));
process.exit(checks.every((c) => c.ok) ? 0 : 1);
