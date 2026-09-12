/**
 * Independent re-count of one tool name, classified by WHERE it appears.
 * This deliberately does not reuse lib/collect.js.
 *
 * A registered-but-unused tool should appear in request headers (its schema is
 * shipped to the model every turn) and in tool/call records zero times.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import zlib from "node:zlib";

const name = process.argv[2];
const sessionsRoot = process.argv[3] ?? join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "sessions");
const ZSTD_MAGIC = 4247762216;

function records(file) {
  const buffer = readFileSync(file);
  const out = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) break;
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) break;
    offset += 4;
    const d = buffer.readUInt8(offset);
    offset += 1;
    const c = d >>> 6;
    const ss = (d & 32) !== 0;
    const ck = (d & 4) !== 0;
    const df = d & 3;
    const db = df === 3 ? 4 : df;
    const sb = c === 0 ? (ss ? 1 : 0) : 1 << c;
    offset += (ss ? 0 : 1) + db + sb;
    for (;;) {
      const h = buffer.readUIntLE(offset, 3);
      offset += 3;
      const last = (h & 1) !== 0;
      const kind = (h >>> 1) & 3;
      const size = h >>> 3;
      offset += kind === 1 ? 1 : size;
      if (last) break;
    }
    if (ck) offset += 4;
    let plain;
    try {
      plain = zlib.zstdDecompressSync(buffer.subarray(start, offset)).toString("utf8");
    } catch {
      break;
    }
    for (const line of plain.split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        /* partial */
      }
    }
  }
  return out;
}

function walk(dir, depth, visit) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (depth > 0) walk(p, depth - 1, visit);
    } else if (/^session(\..+)?\.jsonl\.zstd$/.test(e.name)) visit(p);
  }
}

const byCarrier = {};
let callRecordsWithName = 0;
let files = 0;
walk(sessionsRoot, 3, (file) => {
  files += 1;
  for (const r of records(file)) {
    const t = String(r?.type ?? "?");
    const s = JSON.stringify(r);
    if (!s.includes(name)) continue;
    byCarrier[t] = (byCarrier[t] ?? 0) + 1;
    if (t === "tool/call") {
      const n = r?.data?.name ?? r?.data?.toolName ?? r?.data?.call?.name;
      if (n === name) callRecordsWithName += 1;
    }
  }
});
console.log(JSON.stringify({ name, files_scanned: files, by_carrier: byCarrier, tool_call_records_with_exact_name: callRecordsWithName }, null, 2));
