/**
 * I/O layer: read a DSH home and produce the plain inventory that lib/audit.js judges.
 * Everything here is measurement. Nothing here decides what a finding means.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, basename, dirname, extname } from "node:path";
import zlib from "node:zlib";

const ZSTD_MAGIC = 4247762216;

// ---------------------------------------------------------------- session logs

/** Walk a multi-frame zstd log and return its JSON records. */
export function readSessionRecords(file, cap = 400000) {
  if (typeof zlib.zstdDecompressSync !== "function") {
    const e = new Error("ZSTD_UNAVAILABLE");
    e.code = "ZSTD_UNAVAILABLE";
    throw e;
  }
  const buffer = readFileSync(file);
  const out = [];
  let offset = 0;
  while (offset < buffer.length && out.length < cap) {
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
        /* frame-boundary partial line */
      }
    }
  }
  return out;
}

function walkDirs(root, depth, visit, level = 0) {
  if (level > depth) return;
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(root, e.name);
    if (e.isDirectory()) walkDirs(p, depth, visit, level + 1);
    else visit(p);
  }
}

/** Observed tool calls, plus two separate facts about skills: offered and loaded. */
export function countConsumers(dshHome) {
  const sessionsRoot = join(dshHome, "sessions");
  const invocations = {};
  // `offers` is the catalog listing the skill to the model. `loads` is the model
  // actually calling the skill tool with its name. Counting offers as loads was
  // the first version's mistake: it made `skill_never_loaded` mean "never
  // catalogued", which is a different and much weaker claim.
  const skillOffers = {};
  const skillLoads = {};
  // Attempts and failures are counted apart: a call that came back with isError
  // delivered nothing, so counting it as consumption overstates what happened.
  const invocationErrors = {};
  const skillLoadErrors = {};
  let sessionsScanned = 0;
  let unreadable = 0;
  let recordsSeen = 0;

  walkDirs(sessionsRoot, 3, (file) => {
    if (!/^session(\..+)?\.jsonl\.zstd$/.test(basename(file))) return;
    let records;
    try {
      records = readSessionRecords(file);
    } catch {
      unreadable += 1;
      return;
    }
    sessionsScanned += 1;
    recordsSeen += records.length;
    // A call and its result are two records. Pairing them by (turn, step) is what
    // turns "was it called" into "did the call deliver".
    const pendingName = new Map();
    for (const r of records) {
      const t = String(r?.type ?? "");
      if (t === "tool/call") {
        const name = r?.data?.name ?? r?.data?.toolName ?? r?.data?.call?.name;
        let counted = null;
        if (typeof name === "string") {
          invocations[name] = (invocations[name] ?? 0) + 1;
          counted = name;
        }
        if (name === "skill") {
          const raw = r?.data?.arguments ?? r?.data?.args;
          let parsed = raw;
          if (typeof raw === "string") {
            try {
              parsed = JSON.parse(raw);
            } catch {
              parsed = undefined;
            }
          }
          const requested = parsed && typeof parsed === "object" ? parsed.name : undefined;
          if (typeof requested === "string" && requested.length > 0) {
            skillLoads[requested] = (skillLoads[requested] ?? 0) + 1;
            counted = requested;
          }
        }
        if (counted !== null) pendingName.set(String(r?.data?.turn) + ":" + String(r?.data?.step), { name: counted, isSkill: name === "skill" });
      } else if (t === "tool/result") {
        const key = String(r?.data?.turn) + ":" + String(r?.data?.step);
        const call = pendingName.get(key);
        if (call) {
          pendingName.delete(key);
          const failed = r?.data?.message?.content?.[0]?.isError === true;
          if (failed) {
            const bucket = call.isSkill ? skillLoadErrors : invocationErrors;
            bucket[call.name] = (bucket[call.name] ?? 0) + 1;
          }
        }
      }
      if (t === "user/message" && r?.data?.source?.kind === "skill-catalog") {
        const text = JSON.stringify(r.data);
        for (const m of text.matchAll(/`([a-z0-9][a-z0-9-]{2,})`/g)) {
          skillOffers[m[1]] = (skillOffers[m[1]] ?? 0) + 1;
        }
      }
    }
  });
  return { invocations, invocationErrors, skillLoads, skillLoadErrors, skillOffers, sessionsScanned, unreadable, recordsSeen };
}

// ---------------------------------------------------------------- composition

/** Minimal targeted reader for the loader patch shape we care about. */
export function readRows(profileDir) {
  const rows = [];
  const patchPath = join(profileDir, "cordis.patch.yml");
  if (existsSync(patchPath)) {
    const text = readFileSync(patchPath, "utf8");
    const lines = text.split(/\r?\n/);
    let disabled = false;
    for (let i = 0; i < lines.length; i += 1) {
      const idMatch = /^\s*-\s+id:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(lines[i]);
      if (idMatch) {
        const id = idMatch[1];
        let name;
        let dis = false;
        for (let j = i + 1; j < Math.min(i + 6, lines.length); j += 1) {
          const n = /^\s+name:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(lines[j]);
          if (n && !name) name = n[1];
          if (/^\s+disabled:\s*true\s*$/.test(lines[j])) dis = true;
        }
        if (!name) continue;
        disabled = dis;
        if (!disabled) rows.push({ id, name, origin: `${patchPath}:${i + 1}` });
      }
    }
  }
  const pkgPath = join(profileDir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      for (const b of pkg?.dsh?.profile?.bundles ?? []) {
        rows.push({ id: `bundle:${b}`, name: b, origin: `${pkgPath}#dsh.profile.bundles` });
      }
    } catch {
      /* unreadable profile manifest */
    }
  }
  return rows;
}

const REGISTER_PATTERNS = [
  { kind: "tools", re: /\.tools\.register\s*\(/g, nameRe: /name:\s*['"]([^'"]+)['"]/ },
  { kind: "services", re: /\bprovide\s*\(\s*['"]([^'"]+)['"]/g, groupName: true },
  { kind: "promptSections", re: /\.section\s*\(/g, nameRe: /name:\s*['"]([^'"]+)['"]/ },
  { kind: "skills", re: /\.skills\.register\s*\(/g, nameRe: /name:\s*['"]([^'"]+)['"]/ },
  { kind: "commands", re: /\.commands\.register\s*\(/g, nameRe: /name:\s*['"]([^'"]+)['"]/ },
  { kind: "routes", re: /\.registerRoute\s*\(|\.webServer\.register\s*\(/g, nameRe: /path:\s*['"]([^'"]+)['"]/ },
  // Wrapping an existing service method is a mechanism that registers nothing.
  { kind: "effects", re: /\bctx\.effect\s*\(/g, nameRe: /['"]([^'"]{0,60})['"]/ },
];

/** Kinds a package may declare under `dsh.capabilities` in its package.json. */
const CAPABILITY_KINDS_FOR_DECLARATION = ["tools", "skills", "services", "promptSections", "commands", "routes"];

/**
 * Which capabilities an installed package declares.
 *
 * If the package's package.json carries `dsh.capabilities`, that is used as the
 * authoritative list and `method` says so. Otherwise the sources are scanned for
 * registration call sites, which is a heuristic: a call site whose name comes
 * from a variable cannot be read, and the window search may then attach a
 * neighbouring string. The report states which method produced the names, so a
 * reader can weigh them differently.
 */
export function scanPackage(dir, maxFiles = 400) {
  let declared = null;
  let declaredFrom = null;
  try {
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const caps = manifest?.dsh?.capabilities;
    if (caps && typeof caps === "object") {
      declared = {};
      for (const kind of CAPABILITY_KINDS_FOR_DECLARATION) {
        const list = caps[kind];
        if (Array.isArray(list)) declared[kind] = list.filter((x) => typeof x === "string" && x.length > 0);
      }
      declaredFrom = join(dir, "package.json") + "#dsh.capabilities";
    }
  } catch {
    /* no readable manifest; fall back to the scan */
  }
  if (declared && Object.values(declared).some((l) => l.length > 0)) {
    return { registrations: declared, scanned: 0, dir, method: "declared", declaredFrom };
  }

  const registrations = {};
  let scanned = 0;
  walkDirs(dir, 4, (file) => {
    if (scanned >= maxFiles) return;
    const ext = extname(file);
    if (ext !== ".js" && ext !== ".mjs" && ext !== ".cjs" && ext !== ".ts") return;
    let text;
    try {
      if (statSync(file).size > 4 << 20) return;
      text = readFileSync(file, "utf8");
    } catch {
      return;
    }
    scanned += 1;
    for (const p of REGISTER_PATTERNS) {
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(text)) !== null) {
        let name;
        if (p.groupName) name = m[1];
        else {
          const window = text.slice(m.index, m.index + 500);
          const nm = p.nameRe.exec(window);
          name = nm ? nm[1] : `<unnamed@${basename(file)}:${m.index}>`;
        }
        (registrations[p.kind] ??= []).push(name);
      }
    }
  });
  for (const k of Object.keys(registrations)) registrations[k] = [...new Set(registrations[k])];
  return { registrations, scanned, dir, method: "static" };
}

/** Skills declared on disk: user presets and the shipped presets. */
export function findSkillsOnDisk(dshHome, shippedPresetsDir) {
  const found = [];
  const roots = [];
  const userPresets = join(dshHome, ".agent-presets");
  roots.push({ dir: userPresets, origin: "user preset", exists: existsSync(userPresets) });
  if (shippedPresetsDir) {
    roots.push({ dir: shippedPresetsDir, origin: "shipped preset", exists: existsSync(shippedPresetsDir) });
  } else {
    // Not resolving this silently drops every shipped skill from the report, so
    // record that the root was never searched instead.
    roots.push({ dir: null, origin: "shipped preset", exists: false, note: "root not resolved for this run" });
  }
  for (const { dir, origin, exists } of roots) {
    if (!dir || !exists) continue;
    let presets;
    try {
      presets = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const preset of presets) {
      if (!preset.isDirectory()) continue;
      const skillsDir = join(dir, preset.name, "skills");
      if (!existsSync(skillsDir)) continue;
      let skills;
      try {
        skills = readdirSync(skillsDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const s of skills) {
        if (!s.isDirectory()) continue;
        const p = join(skillsDir, s.name, "SKILL.md");
        if (existsSync(p)) found.push({ name: s.name, preset: `${preset.name} (${origin})`, path: p });
      }
    }
  }
  return { skills: found, roots };
}

/** Resolve rows to installed package directories under the profile's node_modules. */
export function resolvePackages(rows, dshHome, profileDir) {
  const searchRoots = [
    join(profileDir, "node_modules"),
    join(dshHome, "profiles", "node_modules"),
    join(profileDir, ".dsh-module-fallback", "node_modules"),
  ];
  const packages = {};
  for (const row of rows) {
    if (packages[row.name]) continue;
    let dir = null;
    for (const root of searchRoots) {
      const candidate = join(root, ...row.name.split("/"));
      if (existsSync(candidate)) {
        dir = candidate;
        break;
      }
    }
    packages[row.name] = dir ? { resolved: true, ...scanPackage(dir) } : { resolved: false };
  }
  packages.__searchRoots = searchRoots;
  return packages;
}

/**
 * The bridge from the compressed session logs to something a model can read.
 *
 * A session log is multi-frame zstd, so the model cannot open it with an
 * ordinary file read. This pulls out, for one or more capability names, the
 * actual invocations: which session, which turn and step, the arguments the
 * model passed, and the text the tool returned. Whether that output matches
 * what the capability was designed to do is a judgement for the caller; this
 * supplies the material to judge it from and stops there.
 */
export function collectInvocationEvidence({ dshHome, names, perName = 5, excerptBytes = 700 }) {
  const wanted = new Set(names);
  const found = new Map();
  for (const n of wanted) found.set(n, []);
  const sessionsRoot = join(dshHome, "sessions");
  let sessionsScanned = 0;

  const clip = (value) => {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (text === undefined || text === null) return null;
    return text.length <= excerptBytes ? text : text.slice(0, excerptBytes) + "…[+" + (text.length - excerptBytes) + " chars]";
  };

  walkDirs(sessionsRoot, 3, (file) => {
    if (!/^session(\..+)?\.jsonl\.zstd$/.test(basename(file))) return;
    let records;
    try {
      records = readSessionRecords(file);
    } catch {
      return;
    }
    sessionsScanned += 1;
    const session = basename(dirname(file));
    // (turn, step) identifies one call inside one log, and the matching result
    // record carries the same pair, so no cross-log id table is needed.
    const pending = new Map();
    for (const r of records) {
      const d = r?.data;
      if (!d) continue;
      // A skill is never the tool name: the model calls `skill` and passes the
      // skill's name in the arguments, so that is where a skill name is found.
      let called = null;
      if (r.type === "tool/call" && typeof d.name === "string") {
        if (wanted.has(d.name)) called = d.name;
        else if (d.name === "skill") {
          let parsed = d.arguments;
          if (typeof parsed === "string") {
            try {
              parsed = JSON.parse(parsed);
            } catch {
              parsed = undefined;
            }
          }
          const requested = parsed && typeof parsed === "object" ? parsed.name : undefined;
          if (typeof requested === "string" && wanted.has(requested)) called = requested;
        }
      }
      if (called !== null) {
        pending.set(d.turn + ":" + d.step, {
          name: called,
          session,
          turn: d.turn,
          step: d.step,
          callId: d.callId,
          arguments: clip(d.arguments),
        });
      } else if (r.type === "tool/result") {
        const key = d.turn + ":" + d.step;
        const hit = pending.get(key);
        if (!hit) continue;
        pending.delete(key);
        const blocks = d.message?.content?.[0]?.content ?? [];
        hit.isError = d.message?.content?.[0]?.isError === true;
        hit.result = clip(blocks.map((b) => (b?.type === "text" ? b.text : "<< " + b?.type + " >>")).join("\n"));
        found.get(hit.name).push(hit);
      }
    }
  });

  return {
    sessions_scanned: sessionsScanned,
    per_name: Object.fromEntries([...found].map(([k, v]) => [k, v.slice(-perName)])),
  };
}

/** One call: gather everything lib/audit.js needs. */
export function collect({ dshHome, profileDir, shippedPresetsDir, countConsumersToo = true }) {
  const rows = readRows(profileDir);
  const packages = resolvePackages(rows, dshHome, profileDir);
  const searchedRoots = packages.__searchRoots ?? [];
  delete packages.__searchRoots;
  const consumers = countConsumersToo
    ? countConsumers(dshHome)
    : { invocations: {}, skillLoads: {}, sessionsScanned: 0, unreadable: 0, recordsSeen: 0 };
  const skillScan = findSkillsOnDisk(dshHome, shippedPresetsDir);
  return {
    rows,
    packages,
    searchedRoots,
    presetRoots: skillScan.roots,
    skillsOnDisk: skillScan.skills,
    invocations: consumers.invocations,
    invocationErrors: consumers.invocationErrors,
    skillLoads: consumers.skillLoads,
    skillLoadErrors: consumers.skillLoadErrors,
    skillOffers: consumers.skillOffers,
    sessionsScanned: consumers.sessionsScanned,
    console: {
      sessions_unreadable: consumers.unreadable,
      records_seen: consumers.recordsSeen,
      zstd_available: typeof zlib.zstdDecompressSync === "function",
    },
  };
}
