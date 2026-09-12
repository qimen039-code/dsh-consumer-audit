# dsh-consumer-audit

English | [中文](README.md)

The plugins and skills you install register capabilities. Registering one does not mean the model ever calls it, nor that what it was designed to do actually took effect, and nothing reports on that. This plugin does.

## The problem

A DSH plugin can register tools, skills, services and routes with the host. Registering a capability is not the same as the model calling it.

A plugin can quietly register three tools at startup and two of them may never be called across dozens of sessions. The code is there, it was tested, it loads. No task ever reaches those two. There is a subtler case as well: a plugin that only wraps an existing host method registers nothing at all, so a listing makes it look idle while it is in fact working.

`consumer_audit` turns this into a report the model can read. It reads the active profile's composition rows, resolves each row to the installed package, scans that package for registration sites, counts how often each registered tool and skill appears in the session logs under `DSH_HOME`, and reports the ones whose count is zero.

## What a report looks like

On a profile with 8 plugins, one run produces this shape (plugin names made neutral):

```
generated_from
  rows              8     declared composition rows
  sessions_scanned  16    session logs actually scanned

findings
  tool_never_invoked   some-plugin/tool-x          0 calls across 16 logs
  tool_never_invoked   this-plugin/consumer_audit  same, including itself

notes (not problems, just statements)
  intercepts_host_behaviour  some-plugin       wraps a host method, nothing to count
  first_party_shipped        @deepseek-ai/...  ships with the harness, not in the profile
```

Every finding carries an evidence locator, a gap classification, and a falsifier:

```json
{
  "kind": "tool_never_invoked",
  "object": "some-plugin/tool-x",
  "consumer_count": 0,
  "evidence": {
    "locator": "<that plugin's install directory>",
    "method": "tool name searched across 16 scanned session logs"
  },
  "falsifier": "find one invocation in a session log this run did not scan",
  "classification": "consumer_verification_gap"
}
```

Read the last three fields together. A finding says that this scan saw no consumer, and it ships the observation that would overturn it. It does not say the plugin is bad.

## When it is useful

A plugin was just installed and you want to know whether it is doing anything. A feature is suspected of having been written but never wired up. A profile is about to be cleaned and the question is which removals would go unnoticed. A plugin is being written and the question is which parts nothing calls.

The model makes those calls itself and runs the audit; asking in plain language is enough.

## Install

```sh
dsh plugin --profile <profile> add github:qimen039-code/dsh-consumer-audit
```

Restart DSH afterwards, or the tool will not appear in the model's tool table.

If you place the package into a profile by hand, mind where it goes. The DSH loader resolves plugin packages only from the active profile's own `node_modules`. A copy under `profiles/node_modules` is not found, and the profile fails to boot with `PackageOverlayNotFoundError`. The command above avoids this by writing into the profile's dependency graph.

Node 22.15 or newer is required, because session logs are multi-frame zstd.

## Reading the report

There are six finding fields.

| Field | Meaning |
| --- | --- |
| `tool_never_invoked` | The tool is registered, and the scanned logs contain no call to it |
| `skill_never_loaded` | `SKILL.md` exists on disk, and no scanned session loaded it |
| `prompt_only_capability` | The package registers prompt text and nothing else |
| `row_without_capability` | The row is mounted and the package resolves, but it registers nothing |
| `duplicate_prompt_section` | Two packages register the same prompt section name |
| `package_unresolved` | A row whose package is neither installed in the profile nor first-party |
| `tool_never_delivered` | Called, and every result came back with isError |
| `skill_never_delivered` | The same, for a skill |

Two results are recorded as notes instead of findings, because invocation counting cannot judge them. A row whose package name starts with `@deepseek-ai/` ships inside the harness rather than the profile, so an empty search says nothing about it. A package that wraps an existing service method registers no new capability and has no tool to count.

A separate `consumed` section gives `attempts`, `failed` and `succeeded` for each capability. Three levels are kept apart: registered, called, and delivered, where delivered means the paired result did not carry isError. The report stops at delivered. The field `generated_from.capability_names` marks whether each package's names were declared by the package or inferred by scanning; the declared ones are authoritative and the scanned ones can be misread.

Whether a capability did what it was designed to do is a judgement for the model, not for this plugin. The plugin's part is to hand over the records.

A session log is multi-frame zstd, so a model cannot open it with a plain file read. The tool therefore has a second entry point:

```json
{"action": "evidence", "name": "some_tool", "limit": 5}
```

It returns the arguments passed to that capability and the text that came back, for the most recent calls, with the isError flag on each. The model reads those against what the capability is supposed to do and draws the conclusion. The plugin does not draw it and does not pretend to.

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

One command from the repository root reruns every check:

```powershell
.\tools\run-evidence.ps1
```

It covers the market entry requirements, the market's own catalog parser and install resolver, the writing style of both READMEs and the skill, the plugin contract in three contexts, an isolated install of the packed tarball, an independent recount of the first finding, and a scan of every tracked file for machine-specific content. Any failing section exits non-zero.

Current numbers and the per-item description are in [EVIDENCE.md](EVIDENCE.md). The README does not repeat them, because they change on every run.

Not verified: a listing in the curated market. The entry file is ready and the repository is public, but no pull request has been opened.

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
