# market/

The submission to [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin):
one file, `qimen039-code__dsh-consumer-audit.yml`, added as
`data/plugins/qimen039-code__dsh-consumer-audit.yml`, plus the pull-request body in
`PR.md`.

Submission and update both go through `tools/publish.ps1` (`-Stage create`, `pr`,
`update`), which also enforces the repository-age gate the market's CI applies.

## Shape of the entry file

The file holds fields only. Everything that describes *how* to submit it lives here
instead, because an entry that reads as instructions to its own author is scaffolding
left in a public diff. Both facts below were measured against the live list rather
than assumed:

- **No comment lines.** Sampled 12 entries from `data/plugins/`: 0 comment lines in
  every one, 7-8 lines each. `contributing.md`'s template is likewise plain YAML.
- **`description.en` near the length norm.** Extracted 3,632 description lines from
  the generated upstream README: median 182 characters, p75 240, p90 314, p99 527,
  max 2,206. The description is read as a claim about the plugin and checked against
  the code, so each added clause is another thing a reviewer has to verify. This
  entry is held under 400 characters by `tools/verify-market-manifest.mjs` — a
  self-imposed bound, not an upstream rule.

Field order follows the two entries that also carry a tarball
(`LuckVd__dsh-btw.yml`, `yindf__taskfold.yml`): `url`, `name`, `category`,
`tarball`, `description`.

`description.en` contains `": "`, so it is single-quoted; YAML would otherwise read
the rest of the line as a nested key. No apostrophes appear in it, so no doubling is
needed — an apostrophe would have to be written `''` inside single quotes.

## Why the tarball asset name carries no version

`contributing.md` states the rule and the failure it prevents: `latest/download/`
resolves `latest` at request time but takes the filename literally, so a versioned
asset name works on submission day and 404s at the next release. The URL here points
at a version-free asset name; `tools/verify-market-manifest.mjs` asserts that shape,
and the URL was fetched to confirm it serves the same bytes as the release asset
(24,274 bytes, sha256 `5B6AA502…C362E280`).

The alternative contributing.md allows — pinning a release tag, where a versioned
filename is normal — is deliberately not used: it would have to be edited at every
release.

## No `npm:` key

`contributing.md`: the npm mapping is collected from the registry and "a
hand-written `npm:` key in your yml is rejected". The package is not published to
npm, so the entry declares only the tarball.

## What the description claims, and where it is checked

`contributing.md` treats `description.en` as a claim about the plugin. The claims
this one makes resolve to:

| claim | checked against |
| --- | --- |
| audits a profile for capabilities nothing consumes | `lib/index.js` → tool `consumer_audit`; findings in `lib/audit.js` |
| inventories the declared composition rows | `lib/collect.js` → `readRows` |
| counts tool and skill calls in the session logs | `lib/collect.js` → `countConsumers` |
| separates calls that were made from calls that returned a result | `lib/collect.js` → `countConsumers` (`invocationErrors` vs `invocations`) |
| reports the ones with no observed consumer | `lib/audit.js` → `tool_never_invoked`, `skill_never_loaded` |
| ships a skill fixing the evidence-chain format | `skills/consumer-audit/SKILL.md` |

The description deliberately leaves out the `evidence` action and the `ablation`
mode. Dropping a true claim costs nothing; adding one that cannot be checked
against the code is what gets an entry sent back.

`PR.md` is not covered by that bound and runs longer on purpose: it is read once by
the reviewing maintainer, not rendered into the list.
