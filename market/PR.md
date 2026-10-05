# Update qimen039-code/dsh-consumer-audit: drop the `tarball:` field

Removes the `tarball:` line from `data/plugins/qimen039-code__dsh-consumer-audit.yml`.
No other entry is touched. The description is unchanged.

## Why

The field was added because `contributing.md` recommends it, and because a prebuilt
install skips the `allowBuilds` approval step. It does the opposite: the install
command the market generates from it cannot run.

The market turns `tarball:` into

```
dsh plugin --profile web add "<tarball url>"
```

and `dsh plugin` is a passthrough to pnpm (`dsh plugin --help` prints pnpm's own
help). On pnpm 11.8.0 that command cannot install **any** bare tarball URL when the
profile uses `nodeLinker: hoisted`, which is what DSH writes into every profile's
`pnpm-workspace.yaml`.

Measured in temp dirs, four target shapes, hoisted linker:

| target | result |
| --- | --- |
| `…/releases/latest/download/dsh-consumer-audit.tgz` (what the entry declared) | exit 1 |
| `…/releases/download/v0.1.0/dsh-consumer-audit.tgz` (tag pinned) | exit 1 |
| another plugin's pinned tarball, `LuckVd/dsh-btw` | exit 1 |
| `github:qimen039-code/dsh-consumer-audit` | exit 0, installs |

All three URL forms fail with `ERR_PNPM_MISSING_TARBALL_INTEGRITY`: pnpm records
`resolution: {tarball: <url>}` with no `integrity` field and then rejects its own
lockfile. Pinning the tag does not help, and the failure is not specific to this
repository's asset. Under pnpm's default *isolated* linker the same URLs install
fine, and so does `npm install` of the downloaded file, which is why this is easy
to miss.

**This is not specific to this entry.** Of 4,412 entries in the live catalog, 332
declare a `tarball:` and 1,899 declare neither npm nor a tarball. Every one of those
332 entries hands users a command that fails on a hoisted profile. Worth a decision
on the market side; this PR only fixes the entry we own.

## What replaces it

Nothing. With no `tarball:` and no npm package, the resolver falls back to the git
target, so the generated command becomes

```
dsh plugin --profile web add github:qimen039-code/dsh-consumer-audit
```

which is the form measured to install. The package has no `scripts`, so installing
from git needs no build approval.

## Verification

`.\tools\run-evidence.ps1`: one command, exits non-zero on any failure.

The relevant section was rewritten for this change. It used to download the declared
tarball and install it with `npm install --prefix`, which passed while the real
command failed: npm installing a local file is not what a profile install does. It
now resolves the target the entry actually yields and installs it with a hoisted
linker in an isolated directory, then runs the plugin contract against the result.

Negative control: restoring the `tarball:` line turns the chain red with the same
`ERR_PNPM_MISSING_TARBALL_INTEGRITY` a user would hit.
