# dsh-consumer-audit

A DeepSeek Harness plugin that reports which capabilities in a profile have no observed consumer, and a skill that fixes the format for claiming work is complete.

## What it does

The plugin registers one model tool and one skill.

`consumer_audit` reads the active profile's composition rows, resolves each row to its installed package, scans that package for registration sites, and counts how often each registered tool and skill appears in the session logs under `DSH_HOME`. It reports the ones with no observed consumer.

The skill, `consumer-audit`, supplies the wording rules for a completion claim: a boundary statement, a five-field evidence chain, a gap classification, and the observation that would falsify the claim.

The tool does not grade plugins. A finding says that a capability has no observed consumer, not that the plugin behind it is bad.

## Install

```sh
dsh plugin --profile <profile> add github:qimen039-code/dsh-consumer-audit
```

Node 22.15 or newer is required, because session logs are multi-frame zstd.

## Reading the report

| Field | Meaning |
| --- | --- |
| `tool_never_invoked` | The tool is registered, and the scanned logs contain no call to it |
| `skill_never_loaded` | `SKILL.md` exists on disk, and no scanned session loaded it |
| `prompt_only_capability` | The package registers prompt text and nothing else |
| `row_without_capability` | The row is mounted and the package resolves, but it registers nothing |
| `duplicate_prompt_section` | Two packages register the same prompt section name |
| `package_unresolved` | A row whose package is neither installed in the profile nor first-party |

Two results are recorded as notes instead of findings, because invocation counting cannot judge them. A row whose package name starts with `@deepseek-ai/` ships inside the harness rather than the profile, so an empty search says nothing about it. A package that wraps an existing service method registers no new capability and has no tool to count.

Each finding carries an evidence locator, a classification taken from the ACCF effectiveness-gap taxonomy, and the observation that would falsify it.

## Boundaries

A registration site in the source shows that a capability is declared. It does not show that the capability works.

An invocation count describes the logs that were scanned. A tool used in an unscanned profile, or before the log window, reads as unused. Counts also drift as a session grows.

First-party packages ship inside the harness and are not searched. They are recorded as shipped rather than reported missing.

The scan matches a fixed set of call patterns, and the report lists them. A package that registers through some other call site will be misreported.

The field `generated_from.preset_roots_searched` lists every skill root the run looked at. A root that was not resolved means its skills are absent from the report, not that they are unused.

The report carries no semantic judgement.

## Ablation

```js
import { collect } from "dsh-consumer-audit/collect";
import { ablation } from "dsh-consumer-audit/audit";

const input = collect({ dshHome, profileDir });
console.log(ablation(input));
```

With consumer counting switched off, the tools and skills that need a count are reported as unassessed. An ablation that empties its input would look like a large change while proving nothing.

## Verification

| Check | Result |
| --- | --- |
| Market entry requirements | 22/22 |
| The market's own catalog parser and install resolver, against a local fixture | 13/13, with three negative controls that do fail |
| Plugin contract and behaviour, default roots | 22/22 |
| Plugin contract and behaviour, shipped-presets root supplied | 22/22 |
| `npm pack`, then install into an isolated prefix and re-run the checks against the installed copy | 22/22 |
| First real finding, recounted independently | `continuity_recall` has 0 calls carrying that name across 15 session logs, while the control tools `continuity_state` and `set_retention_tier` have 70 and 6 |

```powershell
.\tools\run-evidence.ps1
```

Loading through the DSH loader after install has not been verified. The package is exercised by calling its exported `apply()` against a recording context, and the export shape is taken from two plugins that do load in this deployment.

## Repository layout

```
lib/audit.js     pure judgement over a plain inventory, no I/O
lib/collect.js   reads DSH_HOME and produces that inventory
lib/index.js     registers the tool and the skill
skills/          the skill body
tools/           the checks and the publish script
market/          the entry file for the curated list
```

## License

MIT
