# Publish dsh-consumer-audit to the DSH plugin market.
#
# Two stages, deliberately separate, because the market's CI rejects a repository
# that is less than 1 day old. Stage 1 is safe to run now; stage 2 must wait.
#
#   .\tools\publish.ps1 -Stage create            # create the public repo and push
#   .\tools\publish.ps1 -Stage pr                # open the entry PR (>24h later)
#   .\tools\publish.ps1 -Stage create -DryRun    # print what would run
#
# Nothing here touches $DSH_HOME. Nothing here installs anything locally.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('create', 'pr', 'status')]
  [string]$Stage,
  [switch]$DryRun,
  [string]$Owner = 'qimen039-code',
  [string]$Repo = 'dsh-consumer-audit'
)

$ErrorActionPreference = 'Stop'
$pkgRoot = Split-Path -Parent $PSScriptRoot
$slug = "$Owner/$Repo"
$upstream = 'awesome-dsh-plugin/awesome-dsh-plugin'
$gitId = (gh api user --jq '.id')
$upstreamRepo = ($upstream -split '/')[1]   # the fork keeps the upstream repo name
$gitIdentity = @('-c', "user.name=$Owner", '-c', "user.email=$gitId+$Owner@users.noreply.github.com")
$entryName = "$($Owner)__$Repo.yml"
$branch = "add-$Repo"

function Invoke-Step([string]$Label, [string[]]$Command) {
  $pretty = ($Command | ForEach-Object { if ($_ -match '\s') { "'$_'" } else { $_ } }) -join ' '
  if ($DryRun) { Write-Host "[dry-run] $Label`n          $pretty"; return }
  Write-Host "[run] $Label"
  & $Command[0] @($Command[1..($Command.Length - 1)])
  if ($LASTEXITCODE -ne 0) { throw "$Label failed with exit $LASTEXITCODE" }
}

switch ($Stage) {
  'status' {
    Write-Host "package      : $pkgRoot"
    Write-Host "repo slug    : $slug"
    Write-Host "entry file   : market\$entryName"
    Write-Host "remote       : $((git -C $pkgRoot remote get-url origin 2>$null) ?? '(none)')"
    Write-Host "commits      : $(git -C $pkgRoot rev-list --count HEAD 2>$null)"
    Write-Host ""
    Write-Host "gh auth:"
    gh auth status 2>&1 | Select-Object -First 6
    Write-Host ""
    Write-Host "repo exists?:"
    gh repo view $slug --json name,createdAt,visibility 2>&1 | Select-Object -First 4
  }

  'create' {
    if (-not (Test-Path (Join-Path $pkgRoot '.git'))) { throw "not a git repository: $pkgRoot" }
    $dirty = git -C $pkgRoot status --porcelain
    if ($dirty) { throw "working tree is dirty; commit first:`n$dirty" }

    # Create the public repository from this directory and push the local commit.
    Invoke-Step 'create public repository and push' @(
      'gh', 'repo', 'create', $slug, '--public', '--source', $pkgRoot, '--push',
      '--description', 'Audit a DSH profile for capabilities nothing consumes, and record completion claims with the evidence that supports them.'
    )

    # The market's contributing guide requires this topic.
    Invoke-Step 'add the dsh-plugin topic' @('gh', 'repo', 'edit', $slug, '--add-topic', 'dsh-plugin')

    if (-not $DryRun) {
      Write-Host ""
      Write-Host "Created $slug." -ForegroundColor Green
      Write-Host "The market CI checks repository age: it must be at least 1 day old."
      Write-Host "Re-run with -Stage pr after that window closes."
    }
  }

  'pr' {
    $created = gh repo view $slug --json createdAt --jq .createdAt 2>$null
    if (-not $created) { throw "cannot read $slug; run -Stage create first" }
    $age = (Get-Date).ToUniversalTime() - ([datetime]$created).ToUniversalTime()
    Write-Host "repository age: $([math]::Round($age.TotalHours,1)) h (CI requires >= 24 h)"
    if ($age.TotalHours -lt 24) { throw "repository is younger than 24 h; the market CI will reject the PR" }

    # The upstream grants READ only, so the branch has to live on a fork and the
    # pull request is cross-repo. Pushing to upstream directly would fail.
    if (-not (gh repo view "${Owner}/$upstreamRepo" --json name 2>$null)) {
      Invoke-Step 'fork the curated list' @('gh', 'repo', 'fork', $upstream, '--clone=false')
    }

    $work = Join-Path $env:TEMP "$Repo-pr"
    if (Test-Path $work) { Remove-Item $work -Recurse -Force }
    Invoke-Step 'clone the fork' @('git', 'clone', "https://github.com/${Owner}/$upstreamRepo.git", $work)
    Invoke-Step 'branch' @('git', '-C', $work, 'checkout', '-b', $branch)

    $dest = Join-Path $work "data\plugins\$entryName"
    if ($DryRun) {
      Write-Host "[dry-run] copy $pkgRoot\market\$entryName -> $dest"
    } else {
      Copy-Item (Join-Path $pkgRoot "market\$entryName") $dest -Force
      Write-Host "[run] copied the entry into data\plugins"
    }

    Invoke-Step 'stage' @('git', '-C', $work, 'add', "data/plugins/$entryName")
    Invoke-Step 'commit' @(@('git', '-C', $work) + $gitIdentity + @('commit', '-m', "Add $slug"))
    Invoke-Step 'push to the fork' @('git', '-C', $work, 'push', '-u', 'origin', $branch)
    Invoke-Step 'open the pull request' @(
      'gh', 'pr', 'create', '--repo', $upstream, '--head', "${Owner}:${branch}",
      '--title', "Add $slug", '--body-file', (Join-Path $pkgRoot 'market\PR.md')
    )
  }
}
