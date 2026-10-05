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
  entry is held under 400 characters by `tools/verify-market-manifest.mjs`. That is a
  self-imposed bound, not an upstream rule.

Field order follows `contributing.md`'s template: `url`, `name`, `category`,
`description`.

`description.en` contains `": "`, so it is single-quoted; YAML would otherwise read
the rest of the line as a nested key. No apostrophes appear in it, so no doubling is
needed; an apostrophe would have to be written `''` inside single quotes.

## No `tarball:`, because it cannot be installed

`contributing.md` recommends `tarball:` for a repo that can't be installed from
source, and the market turns the field into the command users actually run:

```
dsh plugin --profile web add "<tarball url>"
```

`dsh plugin` is a passthrough to pnpm. On pnpm 11.8.0 that command **cannot install
any bare tarball URL** when the profile uses `nodeLinker: hoisted`, which is what
DSH writes into every profile's `pnpm-workspace.yaml` (checked on this machine:
`desktop` and `web` both `nodeLinker: hoisted`).

Measured in temp dirs, four target shapes, hoisted linker:

| target | result |
| --- | --- |
| `…/releases/latest/download/dsh-consumer-audit.tgz` | exit 1, `ERR_PNPM_MISSING_TARBALL_INTEGRITY` |
| `…/releases/download/v0.1.0/dsh-consumer-audit.tgz` | exit 1, same |
| another plugin's pinned tarball (`LuckVd/dsh-btw`) | exit 1, same |
| `github:qimen039-code/dsh-consumer-audit` | exit 0, installs |

pnpm records `resolution: {tarball: <url>}` with no `integrity` field and then
refuses its own lockfile. Pinning the tag does not help, and the failure is not
specific to this repo's asset. Under pnpm's default *isolated* linker the same URLs
install fine, which is why this is easy to miss: an `npm install` of the downloaded
file also passes, and did.

So the entry stays on the git target. `tools/verify-market-manifest.mjs` fails if a
`tarball:` line ever reappears without that being re-measured, and
`tools/run-evidence.ps1` section 4b installs whatever target the entry resolves to,
with a hoisted linker, so the check fails the same way the user's install would.

This is a market-wide shape, not a defect in this entry: of 4,412 live catalog
entries, 332 declare a tarball and 1,899 declare neither npm nor a tarball. Every one
of those 332 hands users a command that fails on a hoisted profile. Worth reporting
upstream; the fix there is on their side, not ours.

The release asset is still published and still useful for a manual install
(`pnpm add <tarball>` works under the default linker, and `npm install <tgz>` works
always). It is simply not what the entry should point at.

## No `npm:` key

`contributing.md`: the npm mapping is collected from the registry and "a
hand-written `npm:` key in your yml is rejected". The package is not published to
npm, so the entry declares neither npm nor a tarball, and the market falls back to
the git target.

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
