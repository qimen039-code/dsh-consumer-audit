/**
 * Verify the submission against the REAL consumer: the market plugin's own
 * catalog parser and install-target resolver, not a reading of contributing.md.
 *
 * The market documents this technique itself (src/registry.ts): "the layer-3
 * e2e points it at a local fixture catalog so the install route can be driven
 * end to end without publishing anything". DSHM_REGISTRY_URL is that hatch.
 *
 * Boundary: this script reconstructs the site's YAML -> plugins.json mapping
 * (owner/page/install/added/version). That generator is not in the data repo,
 * so the mapping is inferred from the live catalog's own shape. The CONSUMER
 * side exercised here is genuine and unmodified.
 *
 * Usage: node tools/verify-market-consumer.mjs [--market <dshmarket dir>]
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";

const pkgRoot = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const marketArg = args.indexOf("--market");
const marketRoot =
  marketArg >= 0
    ? args[marketArg + 1]
    : join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "profiles", "desktop", "node_modules", "dshmarket");

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });
const entryPath = join(pkgRoot, "market", "data__plugins__qimen039-code__dsh-consumer-audit.yml");

// ---------------------------------------------------------------- submission YAML

/** Minimal reader for the five fields this submission actually uses. */
function readSubmission(path) {
  const text = readFileSync(path, "utf8");
  const field = (re) => re.exec(text)?.[1];
  const url = field(/^url:\s*(\S+)\s*$/m);
  const name = field(/^name:\s*(\S+)\s*$/m);
  const category = field(/^category:\s*(\S+)\s*$/m);
  const rawEn = field(/^\s*en:\s*(.*)$/m) ?? "";
  const rawZh = field(/^\s*zh:\s*(.*)$/m) ?? "";
  const unquote = (s) => /^(['"])([\s\S]*)\1$/.exec(s.trim())?.[2] ?? s.trim();
  return { url, name, category, description: { en: unquote(rawEn), zh: unquote(rawZh) } };
}

check("submission entry exists", existsSync(entryPath), entryPath);
const submission = readSubmission(entryPath);
check("submission url is a github repo url", /^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(submission.url ?? ""), submission.url);
check("submission name equals the repo in the url", (submission.url ?? "").replace("https://github.com/", "") === submission.name, `${submission.name} vs ${submission.url}`);
check("submission category present", typeof submission.category === "string" && submission.category.length > 0, submission.category);
check("submission has both description languages", submission.description.en.length > 20 && submission.description.zh.length > 5, `${submission.description.en.length}/${submission.description.zh.length}`);

// ------------------------------------- reconstruct the generated entry (inferred)
const owner = submission.name.split("/")[0];
const repo = submission.name.split("/")[1];
const generated = {
  name: submission.name,
  owner,
  url: submission.url,
  page: `https://awesome-dsh-plugin.com/p/${owner}/${repo}/`,
  category: submission.category,
  description: submission.description,
  npm: null,
  tarball: null,
  stars: null,
  downloads: null,
  install: `dsh plugin --profile web add github:${owner}/${repo}`,
  added: new Date().toISOString().slice(0, 10),
};

const fixture = {
  name: "awesome-dsh-plugin local fixture",
  url: "http://127.0.0.1/fixture/plugins.json",
  source: "local-fixture",
  updated: new Date().toISOString(),
  count: 0,
  categories: { [submission.category]: { en: "Development & Runtime", zh: "开发与运行时" } },
  plugins: [],
};

// ---------------------------------------------------------------- local fixture

let served = fixture;
const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ...served, count: served.plugins.length }));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

// The hatch must be set before the market modules read the environment.
process.env.DSHM_REGISTRY_URL = `http://127.0.0.1:${port}/plugins.json`;
process.env.DSHM_GITHUB_PROXY = "";

const registryUrl = pathToFileURL(join(marketRoot, "lib", "registry.js")).href;
const sourcesUrl = pathToFileURL(join(marketRoot, "lib", "sources.js")).href;
const { loadRegistry } = await import(registryUrl);
const { installTargetFor } = await import(sourcesUrl);

// ---------------------------------------------------------------- positive case
served = { ...fixture, plugins: [generated] };
const loaded = await loadRegistry();

check("the market's own loader accepted the catalog", loaded?.plugins?.length === 1, loaded?.plugins?.length);
const got = loaded.plugins[0];
check("entry survived the parser with its identity intact", got.name === generated.name && got.url === generated.url, `${got.name} | ${got.url}`);
check("category was normalised to an array by the parser", Array.isArray(got.category) && got.category[0] === submission.category, JSON.stringify(got.category));
check("both description languages survived", got.description?.en === submission.description.en && got.description?.zh === submission.description.zh, Object.keys(got.description ?? {}));
const target = installTargetFor(got);
check("the market's installer resolves our entry to a git target", target === `github:${owner}/${repo}`, target);

// ---------------------------------------------------------------- negative controls
served = { ...fixture, plugins: [{ ...generated, url: "https://example.com/not-a-github-repo" }] };
const badUrl = installTargetFor({ url: "https://example.com/not-a-github-repo" });
check("control: a non-GitHub url resolves to no install target", badUrl === null, badUrl);

served = { ...fixture, plugins: [{ ...generated, category: "" }] };
let categoryRejected = null;
try {
  await loadRegistry();
} catch (error) {
  categoryRejected = String(error.message);
}
check("control: an entry with no usable category is rejected", /no usable category/.test(categoryRejected ?? ""), categoryRejected);

served = { ...fixture, plugins: [] };
let emptyRejected = null;
try {
  await loadRegistry();
} catch (error) {
  emptyRejected = String(error.message);
}
check("control: an empty catalog is rejected", /came back empty/.test(emptyRejected ?? ""), emptyRejected);

// Close cleanly and let the process drain. Calling process.exit() here trips a
// libuv assertion on Windows (UV_HANDLE_CLOSING on the server's async handle)
// and appends the crash text to stdout, which corrupts the JSON report.
await new Promise((resolve) => server.close(resolve));

console.log(
  JSON.stringify(
    {
      market: marketRoot,
      submission_entry: entryPath,
      generated_entry_used: generated,
      install_target_resolved: target,
      passed: checks.filter((c) => c.ok).length,
      total: checks.length,
      checks,
    },
    null,
    2,
  ),
);
process.exitCode = checks.every((c) => c.ok) ? 0 : 1;
