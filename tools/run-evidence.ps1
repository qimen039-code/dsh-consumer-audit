# Reproduce the whole evidence chain for dsh-consumer-audit.
#   .\tools\run-evidence.ps1
# Writes EVIDENCE-run.log next to the package and exits non-zero if any step fails.
# Section 1b reads the installed market plugin if it is present, and section 4b
# downloads the release asset the market entry declares. Both reach outside this
# package; every other section is local. Nothing writes outside .install-check and
# EVIDENCE-run.log.

$ErrorActionPreference = 'Stop'
$pkgRoot = Split-Path -Parent $PSScriptRoot
$log = Join-Path $pkgRoot 'EVIDENCE-run.log'
$stage = Join-Path $pkgRoot '.install-check'
$failed = @()
$explicitPresets = $env:SHIPPED_PRESETS_DIR

# npm resolves package.json from the working directory, so the npm steps must run
# from the package root rather than wherever this script was invoked.
Push-Location $pkgRoot
try {

function Section([string]$title) { "## $title" | Add-Content $log }

function Run([string]$label, [string]$command, [string[]]$cmdArgs) {
  "### $label" | Add-Content $log
  "    $command $($cmdArgs -join ' ')" | Add-Content $log
  # Native tools write warnings to stderr; with ErrorActionPreference=Stop a
  # redirected stderr stream can become a terminating error. Keep it local.
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $command @cmdArgs 2>&1 | Out-File -Append -Encoding utf8 $log
  } finally {
    $ErrorActionPreference = $previous
  }
  $code = $LASTEXITCODE
  "exit=$code" | Add-Content $log
  if ($code -ne 0) { $script:failed += $label }
}

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null

"=== dsh-consumer-audit evidence run ===" | Set-Content $log
"generated: $(Get-Date -Format o)" | Add-Content $log
"node: $(node --version)" | Add-Content $log
"platform: $([System.Environment]::OSVersion.VersionString)" | Add-Content $log

Section '1. market entry requirements'
Run 'market manifest checks' 'node' @(Join-Path $PSScriptRoot 'verify-market-manifest.mjs')

Section '1b. the real market consumer (its own catalog parser + install resolver)'
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$market = Join-Path $dshHome 'profiles\desktop\node_modules\dshmarket'
if (Test-Path $market) {
  Run 'market consumer checks' 'node' @(
    (Join-Path $PSScriptRoot 'verify-market-consumer.mjs'), '--market', $market
  )
} else {
  'market not installed at the expected path; SKIPPED (not a pass)' | Add-Content $log
}

Section '1c. prose: the AI-writing tells this repository claims to avoid'
Run 'prose lint' 'node' @(
  (Join-Path $PSScriptRoot 'lint-prose.mjs'),
  (Join-Path $pkgRoot 'README.md'),
  (Join-Path $pkgRoot 'README.en.md'),
  (Join-Path $pkgRoot 'skills\consumer-audit\SKILL.md'),
  (Join-Path $pkgRoot 'EVIDENCE.md')
)

Section '2. plugin contract and behaviour, with the shipped presets root NOT supplied'
# This is the deployment-realistic path: nothing tells the plugin where the
# shipped presets live, so the report must say that root was not searched.
$env:SHIPPED_PRESETS_DIR = $null
Run 'plugin checks (default roots)' 'node' @(Join-Path $PSScriptRoot 'verify-plugin.mjs')

Section '3. plugin contract and behaviour, with the shipped presets root supplied'
if ($explicitPresets) { $env:SHIPPED_PRESETS_DIR = $explicitPresets }
if ($explicitPresets) { Run 'plugin checks (explicit roots)' 'node' @(Join-Path $PSScriptRoot 'verify-plugin.mjs') } else { 'SHIPPED_PRESETS_DIR is not set; SKIPPED (not a pass)' | Add-Content $log }

Section '4. npm pack + isolated install + behaviour of the installed copy'
Run 'npm pack' 'npm' @('pack', '--pack-destination', $stage)
$tgz = (Get-ChildItem (Join-Path $stage '*.tgz') | Select-Object -First 1).FullName
"tarball: $tgz" | Add-Content $log
Run 'tarball contents' 'tar' @('-tzf', $tgz)
Run 'install into isolated prefix' 'npm' @('install', '--prefix', $stage, '--no-save', '--ignore-scripts', $tgz)
Run 'plugin checks (installed copy)' 'node' @(
  (Join-Path $PSScriptRoot 'verify-plugin.mjs'),
  (Join-Path $stage 'node_modules\dsh-consumer-audit')
)

Section '4b. the release asset the market entry points users at'
# Section 4 packs the working tree. That is not the artifact a storefront hands a
# user: the entry declares a tarball URL, and until this section existed nothing
# checked that the declared URL resolves, that it is a real tarball, or that what
# it contains loads. A submission can declare a 404 and still pass everything else.
$entryPath = Join-Path $pkgRoot 'market\qimen039-code__dsh-consumer-audit.yml'
$declaredMatch = [regex]::Match((Get-Content $entryPath -Raw), '(?m)^tarball:\s*(\S+)\s*$')
if (-not $declaredMatch.Success) {
  'the entry declares no tarball; SKIPPED (not a pass)' | Add-Content $log
} else {
  $declared = $declaredMatch.Groups[1].Value
  "declared: $declared" | Add-Content $log
  $released = Join-Path $stage 'released.tgz'
  $releasedRoot = Join-Path $stage 'released'
  Run 'download the declared asset' 'curl.exe' @('-sSL', '--fail', '-o', $released, $declared)
  if (Test-Path $released) {
    "bytes: $((Get-Item $released).Length)" | Add-Content $log
    "sha256: $((Get-FileHash $released -Algorithm SHA256).Hash)" | Add-Content $log
    # Byte-identity with the local pack is reported, not asserted: npm embeds
    # timestamps, so two packs of the same tree need not be identical, and a
    # digest mismatch here would be a false alarm rather than a defect.
    if (Test-Path $tgz) { "local pack sha256: $((Get-FileHash $tgz -Algorithm SHA256).Hash)" | Add-Content $log }
    Run 'declared asset is a tarball' 'tar' @('-tzf', $released)
    Run 'install the declared asset' 'npm' @('install', '--prefix', $releasedRoot, '--no-save', '--ignore-scripts', $released)
    Run 'plugin checks (declared asset)' 'node' @(
      (Join-Path $PSScriptRoot 'verify-plugin.mjs'),
      (Join-Path $releasedRoot 'node_modules\dsh-consumer-audit')
    )
    # A stale asset at the declared URL would still install; version drift is the
    # cheapest signal that the release lags the tree it claims to be.
    $installed = Join-Path $releasedRoot 'node_modules\dsh-consumer-audit\package.json'
    if (Test-Path $installed) {
      $theirVersion = (Get-Content $installed -Raw | ConvertFrom-Json).version
      $ourVersion = (Get-Content (Join-Path $pkgRoot 'package.json') -Raw | ConvertFrom-Json).version
      "version: declared asset $theirVersion / this tree $ourVersion" | Add-Content $log
      if ($theirVersion -ne $ourVersion) { $script:failed += 'declared asset version differs from this tree' }
    }
  }
}

Section '5. independent recount of the reported finding'
Run 'continuity_recall' 'node' @((Join-Path $PSScriptRoot 'recount-name.mjs'), 'continuity_recall')
Run 'continuity_state (control)' 'node' @((Join-Path $PSScriptRoot 'recount-name.mjs'), 'continuity_state')
Run 'set_retention_tier (control)' 'node' @((Join-Path $PSScriptRoot 'recount-name.mjs'), 'set_retention_tier')

Section '6. machine-specific content in tracked files'
Run 'secret scan' 'node' @((Join-Path $PSScriptRoot 'scan-secrets.mjs'))

Section 'result'
if ($failed.Count -eq 0) { 'all steps passed' | Add-Content $log } else { "FAILED: $($failed -join ', ')" | Add-Content $log }

Get-Content $log | Select-String -Pattern '"passed"|exit=|tool_call_records_with_exact_name|all steps passed|FAILED' |
  ForEach-Object { $_.Line.Trim() }

if ($failed.Count -ne 0) { exit 1 }
} finally { Pop-Location }
