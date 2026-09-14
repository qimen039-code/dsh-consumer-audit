# Add qimen039-code/dsh-consumer-audit

Adds `data/plugins/qimen039-code__dsh-consumer-audit.yml`.

## What it does

`dsh-consumer-audit` measures whether the capabilities a DSH profile declares are actually consumed:

- reads the active profile's declared composition rows (`cordis.patch.yml` inserts plus `dsh.profile.bundles`);
- resolves each row to its installed package and scans that package for registration sites, using `dsh.capabilities` from the package.json when the package declares it and a source scan otherwise;
- pairs `tool/call` records with their `tool/result` records across the session logs under `DSH_HOME`, so a call that was made stays apart from a call that delivered a result;
- reports the registered capabilities with no observed consumer, the ones whose calls all came back with `isError`, and the counts for the rest.

A second entry point, `action: "evidence"`, returns the arguments and the result text of a capability's recent calls. Session logs are multi-frame zstd, so a model cannot open them with a plain file read; this is the bridge from those logs to something readable.

It also ships a skill that fixes the format for claiming work is complete, and states the boundary that a call count is not evidence that a capability did what it was designed to do.

## What it deliberately does not do

- No LLM calls. Nothing is graded by a model.
- No semantic judgement. A finding says a capability has no observed consumer, not that a plugin is bad. Whether a delivered capability did what it was designed to do is left to the model reading the report.
- No writes. The tool reads; it never edits a profile, a plugin, or a log.

## Verification

One command from the repository root reruns every check:

```
.\tools\run-evidence.ps1
```

It covers the market entry requirements, this repository's own catalog parser and install resolver driven against a local fixture through `DSHM_REGISTRY_URL`, the writing style of the documents, the plugin contract in three contexts, an isolated install of the packed tarball, an independent recount of the first finding, and a scan of every tracked file for machine-specific content. Any failing section exits non-zero.

The package declares `dsh.bundle` and ships `cordis.patch.yml` beside it.
