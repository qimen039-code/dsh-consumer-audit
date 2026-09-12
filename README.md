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
| **The market's own catalog parser and install resolver, driven against a local fixture via `DSHM_REGISTRY_URL`** | 13/13, with three negative controls that do fail. `installTargetFor` resolves the entry to `github:<owner>/dsh-consumer-audit` |
| Plugin contract and behaviour — default roots, explicit roots, and the installed copy | 22/22 in each context |
| Plugin export shape matches plugins that load in this deployment | `export default { name, apply }` |
| The report marks the shipped-presets root searched iff one was supplied | default roots → `searched:false` and 2 skills; explicit root → `searched:true` and 4 skills |
| Reported `continuity_recall` as never invoked | Independently recounted over the same 15 session logs: 14 `tool/call` records contain the string, **0** carry it as the call name. Controls `continuity_state` 70, `set_retention_tier` 6 |

Reproduce all of it with one command:

```powershell
.\tools\run-evidence.ps1
```

Not verified: loading through the DSH loader after install. The package is exercised by calling its exported `apply()` against a recording context, not by starting a harness against it. The submission is not yet in the curated list — the market entry file is ready but no pull request has been opened.

Three defects worth naming, each caught by running a check rather than reading one:

- The first version exported a bare function and its own verifier passed 15/15, because the verifier asserted a contract invented in this repository rather than the one two working plugins use. The shape was corrected and the verifier now asserts the real contract.
- The first version never resolved the shipped-presets root, so an installed plugin silently reported 2 skills instead of 4. The report now states which roots it searched and the verifier asserts that the shipped root is marked searched exactly when one was supplied.
- The entry was first checked only against a reading of `contributing.md` — the same self-confirming shape as the first defect. It is now driven through the market's own `loadRegistry` and `installTargetFor`, which is what surfaced that the consumed shape (`owner`, `page`, `install`, `added`) differs from the submitted shape.

## Licence

MIT
