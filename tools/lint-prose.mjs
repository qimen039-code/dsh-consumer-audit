/**
 * Flag the AI-writing tells that apply to technical prose, so "I removed the AI
 * flavour" is a measurement instead of a claim.
 *
 * Rule set taken from Wikipedia:Signs of AI writing (CC BY-SA), fetched to
 * ../dsh-consumer-audit-references/signs-of-ai-writing.md. That reference is
 * deliberately not committed into this MIT repository.
 *
 * Usage: node tools/lint-prose.mjs [files...]
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const RULES = [
  {
    id: "em-dash",
    why: "overuse of em dashes",
    // Chinese and English em dashes. A lone hyphen is fine.
    re: /—|――|——/g,
  },
  {
    id: "negative-parallelism",
    why: "not just / not only ... but",
    re: /\bnot (just|only|merely)\b[^.!?\n]{0,80}\bbut\b|\bnot\b[^.!?\n]{0,40}\bbut rather\b/gi,
  },
  {
    id: "negative-parallelism-zh",
    why: "不是…而是…",
    re: /不是[^。\n]{0,30}而是|并非[^。\n]{0,30}而是|不是[^。\n]{0,20}，是/g,
  },
  {
    id: "outline-of-negatives",
    why: "no X, no Y, just Z",
    re: /\bno [a-z][^.!?\n]{0,25}, no [a-z][^.!?\n]{0,25}(,| and) no\b/gi,
  },
  {
    id: "inline-header-list",
    why: "vertical list with an inline bolded header",
    re: /^\s*[-*]\s+\*\*[^*]+\*\*\s*[:：]/gm,
  },
  {
    id: "curly-quotes",
    why: "curly quotation marks and apostrophes",
    re: /[“”‘’]/g,
  },
  {
    id: "importance-inflation",
    why: "undue emphasis on importance or legacy",
    re: /\b(crucial|pivotal|vital|essential|groundbreaking|game-chang\w+|cutting-edge|seamless\w*|robust\w*|comprehensive|leverage\w*|delve\w*|showcas\w+|underscor\w+|highlight\w+ the importance)\b/gi,
  },
  {
    id: "summary-heading",
    why: "a summary or conclusion section that restates",
    re: /^#{1,4}\s*(summary|conclusion|in summary|conclusion and|总结|结论|小结)\s*$/gim,
  },
  {
    id: "false-range",
    why: "false ranges",
    re: /\bfrom [a-z][^,.\n]{2,30} to [a-z][^,.\n]{2,30}\b/gi,
  },
];

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node tools/lint-prose.mjs <file> [file...]");
  process.exit(2);
}

let total = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  // Fenced code blocks are not prose; strip them before counting.
  const prose = text.replace(/```[\s\S]*?```/g, (m) => "\n".repeat(m.split("\n").length - 1));
  const boldCount = (prose.match(/\*\*/g) ?? []).length;
  const lines = prose.split("\n").length;
  const hits = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    const found = [...prose.matchAll(rule.re)];
    if (found.length > 0) {
      hits.push({
        rule: rule.id,
        why: rule.why,
        count: found.length,
        first: found[0][0].replace(/\s+/g, " ").slice(0, 70),
      });
    }
  }
  total += hits.reduce((n, h) => n + h.count, 0);
  console.log(
    JSON.stringify(
      {
        file: basename(file),
        lines,
        bold_marks: boldCount,
        bold_per_100_lines: Number(((boldCount / Math.max(1, lines)) * 100).toFixed(1)),
        violations: hits,
        violation_count: hits.reduce((n, h) => n + h.count, 0),
      },
      null,
      2,
    ),
  );
}
process.exitCode = total === 0 ? 0 : 1;
