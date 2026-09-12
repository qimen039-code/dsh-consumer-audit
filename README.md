# dsh-consumer-audit

Audit a DSH profile for capabilities nothing consumes, and fix the format of a completion claim.

Two halves, one judgement:

- **`consumer_audit` (tool)** — measures. It reads the active profile's declared composition rows, scans each installed package for its registration sites, counts how often each registered tool and skill appears in the session logs on this machine, and reports the ones with no observed consumer. It also runs its own ablation on request.
- **`consumer-audit` (skill)** — reasons. It fixes the format for claiming work is complete (boundary statement, evidence chain, gap classification), the rules for an ablation, the first-principles self-review, and how to read the report.

The tool makes no quality judgement. A `tool_never_invoked` finding does not mean a plugin is bad; it means that capability currently has no observable consumer.

## Install

```sh
dsh plugin --profile <profile> add dsh-consumer-audit
```

Requires Node 22.15+ (session logs are multi-frame zstd).

## What the report contains

| Finding | Meaning |
|---|---|
| `tool_never_invoked` | Registered, but zero invocations in the scanned session logs |
| `skill_never_loaded` | `SKILL.md` on disk, no session ever loaded it |
| `prompt_only_capability` | Registers prompt text only — a description, not a mechanism |
| `row_without_capability` | The row is mounted and the package resolves, but it registers nothing |
| `duplicate_prompt_section` | Two packages register the same prompt section name |
| `package_unresolved` | A non-first-party row whose package could not be resolved |

Recorded as notes, deliberately **not** as findings:

- `first_party_shipped` — a `@deepseek-ai/*` row that ships inside the harness rather than the profile.
- `intercepts_host_behaviour` — a package that wraps an existing service method and registers no new capability. Invocation counting cannot judge it, so the report says so instead of calling the row empty.

Every finding carries an evidence locator, a classification from the ACCF effectiveness-gap taxonomy, and the observation that would falsify it.

## Boundaries

- A static registration site is evidence that a capability is **declared**, not that it works.
- An invocation count is evidence about **the logs that were scanned**. A tool used in an unscanned profile, or before the log window, reads as unused.
- First-party packages are not searched for. They are recorded as shipped, not reported missing.
- The scan is heuristic. A package that registers through a call site this scan does not know about is misreported, and the report says which patterns it looks for.
- The report contains no semantic judgement.

## Ablation

```js
import { collect } from "dsh-consumer-audit/collect";
import { ablation } from "dsh-consumer-audit/audit";

const input = collect({ dshHome, profileDir });
console.log(ablation(input));
```

With consumer counting disabled, the tool reports those capabilities as **unassessed** rather than as zero. An ablation that empties the input would look like it changed a lot while proving nothing.

## Verified

| Check | Result |
|---|---|
| Market entry requirements (manifest, patch shape, category, peer ranges, description) | 22/22 |
| `npm pack` → install into an isolated prefix → re-run the checks against the installed copy | 19/19 |
| Plugin export shape matches plugins that load in this deployment | `export default { name, apply }` |
| Reported `continuity_recall` as never invoked | Independently recounted over the same 15 session logs: 14 `tool/call` records contain the string, **0** carry it as the call name. Controls `continuity_state` 66, `set_retention_tier` 6 |

Not verified: loading through the DSH loader after install. The package was exercised by calling its exported `apply()` against a recording context, not by starting a harness against it.

One defect worth naming: the first version exported a bare function and its own verifier passed 15/15, because the verifier asserted a contract invented in this repository rather than the one two working plugins use. The shape was corrected and the verifier now asserts the real contract.

## Licence

MIT
