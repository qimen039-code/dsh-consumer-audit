# Add dsh-consumer-audit

Adds `data/plugins/OWNER__dsh-consumer-audit.yml`.

## What it does

`dsh-consumer-audit` measures whether the capabilities a DSH profile declares are
actually consumed:

- reads the active profile's declared composition rows (`cordis.patch.yml` inserts
  plus `dsh.profile.bundles`);
- resolves each row to its installed package and statically scans that package for
  registration sites (`tools.register`, `provide(`, `.section(`, `skills.register`,
  `commands.register`, `webServer.register`, `ctx.effect(`);
- counts `tool/call` records across the session logs under `DSH_HOME`;
- reports the registered capabilities with no observed consumer.

It also ships a skill that fixes the format for claiming work is complete — a
boundary statement, a five-field evidence chain, an ACCF gap classification, and
the falsifier for each claim.

## What it deliberately does not do

- No LLM calls. Nothing is graded by a model.
- No semantic judgement: a finding says a capability has no observed consumer, not
  that a plugin is bad.
- No writes. The tool reads; it never edits a profile, a plugin, or a log.

## Verification claimed

- `npm pack` → install into an isolated prefix → the package's own checks re-run
  against the installed copy: 17/17 pass.
- Its first real finding (`continuity_recall` registered but never invoked) was
  independently recounted over the same 15 session logs: 14 `tool/call` records
  contain the string, 0 carry it as the call name; controls `continuity_state` 66
  and `set_retention_tier` 6.
- Not verified: loading through the DSH loader after install. The exported
  `apply()` is exercised against a recording context, not against a started harness.

The package declares `dsh.bundle` and ships `cordis.patch.yml` beside it.
