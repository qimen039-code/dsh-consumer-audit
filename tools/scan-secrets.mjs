/**
 * Traverse every tracked file and flag anything that came from this machine and
 * does not belong in a public repository.
 *
 * Run from the repository root:
 *   node tools/scan-secrets.mjs [--json]
 *
 * The patterns are deliberately broad. A hit is a question, not a verdict, and
 * the report prints a redacted excerpt so the hit can be judged.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const asJson = process.argv.includes("--json");

const RULES = [
  // A drive letter must not be preceded by another word character, otherwise
  // `https:\/\/` inside an escaped URL or regex reads as the path `s:\`.
  { id: "absolute-windows-path", why: "local filesystem path", re: /(?<![A-Za-z0-9])[A-Za-z]:\\[^\s"'`)]*/g },
  { id: "absolute-posix-home", why: "local filesystem path", re: /\/(?:home|Users)\/[A-Za-z0-9._-]+\/[^\s"'`)]*/g },
  { id: "local-session-id", why: "session id from this machine", re: /session-[0-9a-f]{8}/g },
  { id: "loopback-endpoint", why: "local service address", re: /(?:127\.0\.0\.1|localhost):\d+/g },
  { id: "credential-shaped", why: "looks like a token", re: /\b(?:gho|ghp|ghs|ghr)_[A-Za-z0-9]{16,}\b|\bsk-[A-Za-z0-9_-]{16,}\b|\bBearer\s+[A-Za-z0-9._-]{16,}/g },
  { id: "dsh-home-layout", why: "local harness layout", re: /\.dsh[\\/](?:profiles|sessions|continuity|agent-presets|storages|mcp-servers)\b/g },
  { id: "private-plugin-scope", why: "private plugin package", re: /@mj\/[a-z0-9-]+/g },
  { id: "third-party-local-tooling", why: "local tooling path or product", re: /asar-extract|Video-Script-Production|screenpipe|paddleocr|skill-tools|paddlex/gi },
  { id: "private-notes-path", why: "personal document path", re: /Documents[\\/]Codex|Codex[\\/]Archives/gi },
];

// A rule table has to contain the strings it looks for, so this file would
// always match itself. The exclusion is one file wide and it is printed in the
// report rather than applied quietly.
const SELF = "tools/scan-secrets.mjs";

// Tracked files PLUS untracked files that are not gitignored. Scanning only
// `git ls-files` reads the index, so a newly written file is invisible until it
// is staged, and the gate passes on exactly the content about to be added.
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);

const scanned = files.filter((f) => f.replaceAll("\\", "/") !== SELF);
const excluded = files.filter((f) => f.replaceAll("\\", "/") === SELF);

const findings = [];
for (const file of scanned) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (text.includes("\u0000")) continue; // binary
  const lines = text.split("\n");
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(line)) !== null) {
        const hit = m[0];
        const at = m.index;
        findings.push({
          file,
          line: i + 1,
          rule: rule.id,
          why: rule.why,
          // Redact the middle so the report itself does not become the leak.
          excerpt: (line.slice(0, at) + hit.slice(0, 6) + "…" + hit.slice(-4)).slice(-90).trim(),
        });
        if (m[0].length === 0) break;
      }
    }
  }
}

const byRule = {};
for (const f of findings) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;
const byFile = {};
for (const f of findings) byFile[f.file] = (byFile[f.file] ?? 0) + 1;

if (asJson) {
  console.log(JSON.stringify({ files_considered: files.length, files_scanned: scanned.length, files_excluded: excluded, total_hits: findings.length, by_rule: byRule, by_file: byFile, findings }, null, 2));
} else {
  console.log(`scanned ${scanned.length} of ${files.length} files, ${findings.length} hits`);
for (const f of excluded) console.log(`  excluded: ${f} (its own rule table)`);
  console.log("");
  for (const [rule, n] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${rule}`);
  console.log("");
  for (const [file, n] of Object.entries(byFile).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${file}`);
  console.log("");
  for (const f of findings.slice(0, 60)) console.log(`  ${f.file}:${f.line}  ${f.rule}  ${f.excerpt}`);
  if (findings.length > 60) console.log(`  ... and ${findings.length - 60} more (use --json)`);
}
process.exitCode = findings.length === 0 ? 0 : 1;
