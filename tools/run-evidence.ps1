# Reproduce the whole evidence chain for dsh-consumer-audit.
#   .\tools\run-evidence.ps1
# Writes EVIDENCE-run.log next to the package and exits non-zero if any step fails.
# No network, no model calls, no writes outside .install-check and EVIDENCE-run.log.

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
