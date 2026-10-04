param(
  [Parameter(Mandatory=$true)][string]$WorkspacePath,
  [Parameter(Mandatory=$true)][string]$OperatorEnvFile,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-zA-Z0-9_.-]{1,100}$')][string]$ActorId,
  [ValidatePattern('^([01][0-9]|2[0-3]):[0-5][0-9]$')][string]$LocalTime = '03:00',
  [switch]$LinkedSupabase,
  [string]$NodeDirectory
)
$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path -LiteralPath $WorkspacePath).Path
$operatorEnv = (Resolve-Path -LiteralPath $OperatorEnvFile).Path
if ($NodeDirectory) {
  $effectiveNodeDirectory = (Resolve-Path -LiteralPath $NodeDirectory).Path
  $nodeExecutable = Join-Path $effectiveNodeDirectory 'node.exe'
} else {
  $nodeExecutable = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  $effectiveNodeDirectory = Split-Path -Parent $nodeExecutable
}
if (!(Test-Path -LiteralPath $effectiveNodeDirectory -PathType Container) -or !(Test-Path -LiteralPath $nodeExecutable -PathType Leaf)) { throw 'backup_node24_required' }
$nodeVersion = (& $nodeExecutable --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v24\.[0-9]+\.[0-9]+$') { throw 'backup_node24_required' }
$runner = Join-Path $workspace 'tools/backup/run-daily.ps1'
if (!(Test-Path -LiteralPath $runner -PathType Leaf)) { throw 'backup_workspace_invalid' }
if (@($workspace,$operatorEnv,$runner,$effectiveNodeDirectory) | Where-Object { $_.Contains('"') }) { throw 'backup_path_invalid' }
$taskName = 'Recalino encrypted daily backup'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { throw 'backup_task_already_exists' }
$arguments = '-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -WindowStyle Hidden -File "' + $runner + '" -WorkspacePath "' + $workspace + '" -OperatorEnvFile "' + $operatorEnv + '" -ActorId "' + $ActorId + '"'
$arguments += ' -NodeDirectory "' + $effectiveNodeDirectory + '"'
if ($LinkedSupabase) { $arguments += ' -LinkedSupabase' }
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $workspace
$trigger = New-ScheduledTaskTrigger -Daily -At $LocalTime
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'Encrypted logical Postgres backup to existing private Blob; no plaintext dump files; 30-day retention. Requires this trusted operator host and its credentials to remain available.' | Select-Object TaskName, State
