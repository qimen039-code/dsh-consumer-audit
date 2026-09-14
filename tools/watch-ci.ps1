# Watch one commit's CI runs until they settle.
#
# jq filters that interpolate a PowerShell variable need escaped quotes inside a
# double-quoted string, and getting that wrong fails silently: the assignment
# yields nothing and the loop reports "no run registered" forever. So this reads
# the JSON and filters it in PowerShell instead.
param(
  [Parameter(Mandatory = $true)][string]$Sha,
  [string]$Repo = 'awesome-dsh-plugin/awesome-dsh-plugin',
  [int]$TimeoutMinutes = 30
)

$ErrorActionPreference = 'Stop'
$deadline = (Get-Date).AddMinutes($TimeoutMinutes)
$state = @{}

while ((Get-Date) -lt $deadline) {
  $json = gh api "repos/$Repo/actions/runs?per_page=20" 2>$null | Out-String
  $runs = @()
  if ($json.Trim()) { $runs = ($json | ConvertFrom-Json).workflow_runs | Where-Object { $_.head_sha -eq $Sha } }

  if ($runs.Count -eq 0) {
    Write-Output ("[{0}] no workflow run for {1} yet" -f (Get-Date -Format HH:mm:ss), $Sha.Substring(0, 8))
  }
  else {
    $pending = 0
    foreach ($r in $runs) {
      $line = "{0} | {1} {2}" -f $r.name, $r.status, ($r.conclusion ?? '-')
      Write-Output ("[{0}] {1}" -f (Get-Date -Format HH:mm:ss), $line)
      if ($r.status -ne 'completed') { $pending++ }
      $state[$r.name] = "{0}/{1}" -f $r.status, ($r.conclusion ?? '-')
    }
    if ($pending -eq 0) {
      Write-Output 'ALL_RUNS_SETTLED'
      foreach ($k in $state.Keys) { Write-Output ("FINAL {0} = {1}" -f $k, $state[$k]) }
      exit 0
    }
  }
  Start-Sleep -Seconds 30
}

Write-Output 'TIMED_OUT'
foreach ($k in $state.Keys) { Write-Output ("LAST {0} = {1}" -f $k, $state[$k]) }
exit 2
