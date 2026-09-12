/**
 * Fetch the live catalog and report the AUTHORITATIVE generated shape of one
 * entry plus the top level, so the local fixture is built from the real thing
 * rather than from a reading of contributing.md.
 */
import { writeFileSync } from "node:fs";

const url = process.env.DSHM_REGISTRY_URL ?? "https://awesome-dsh-plugin.com/plugins.json";
const res = await fetch(url, { headers: { "user-agent": "dsh-consumer-audit/0.1.0" } });
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const text = await res.text();
const data = JSON.parse(text);
writeFileSync(process.argv[2] ?? "plugins-live.json", text, "utf8");

const top = Object.keys(data);
const sample = data.plugins.find((p) => p.owner === "Jonah-Wu23") ?? data.plugins[0];
const keyTypes = Object.fromEntries(
  Object.entries(sample).map(([k, v]) => [k, Array.isArray(v) ? `array(${v.length})` : v === null ? "null" : typeof v]),
);
console.log(
  JSON.stringify(
    {
      bytes: text.length,
      top_level_keys: top,
      count: data.count,
      plugins_array_length: data.plugins.length,
      categories_sample: Object.fromEntries(Object.entries(data.categories ?? {}).slice(0, 3)),
      category_ids: Object.keys(data.categories ?? {}),
      sample_entry: sample,
      sample_entry_key_types: keyTypes,
      entries_missing_install: data.plugins.filter((p) => typeof p.install !== "string").length,
      entries_missing_owner: data.plugins.filter((p) => typeof p.owner !== "string").length,
      entries_with_npm: data.plugins.filter((p) => typeof p.npm === "string").length,
      entries_with_tarball: data.plugins.filter((p) => typeof p.tarball === "string").length,
      entries_without_tarball: data.plugins.filter((p) => p.tarball == null).length,
    },
    null,
    2,
  ),
);
