param(
  [Parameter(Mandatory=$true)][string]$WorkspacePath,
  [Parameter(Mandatory=$true)][string]$OperatorEnvFile,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-zA-Z0-9_.-]{1,100}$')][string]$ActorId,
  [ValidatePattern('^([01][0-9]|2[0-3]):[0-5][0-9]$')][string]$LocalTime = '03:00',
  [switch]$LinkedSupabase,
  [string]$NodeDirectory,
  [string]$PnpmCliPath,
  [switch]$UpdateExisting,
  [switch]$DpapiConfig
)
$ErrorActionPreference = 'Stop'
if ($DpapiConfig -and !$LinkedSupabase) { throw 'backup_protected_linked_required' }
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
if ($PnpmCliPath) {
  $pnpmCli = (Resolve-Path -LiteralPath $PnpmCliPath).Path
} else {
  $pnpmLauncher = (Get-Command pnpm -ErrorAction Stop | Select-Object -First 1).Source
  $pnpmCli = Join-Path (Split-Path -Parent $pnpmLauncher) 'node_modules/corepack/dist/pnpm.js'
}
if (!(Test-Path -LiteralPath $pnpmCli -PathType Leaf)) { throw 'backup_pnpm_cli_required' }
$runner = Join-Path $workspace 'tools/backup/run-daily.ps1'
if (!(Test-Path -LiteralPath $runner -PathType Leaf)) { throw 'backup_workspace_invalid' }
if (@($workspace,$operatorEnv,$runner,$effectiveNodeDirectory,$pnpmCli) | Where-Object { $_.Contains('"') }) { throw 'backup_path_invalid' }
$taskName = 'Recalino encrypted daily backup'
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask) {
  if (!$UpdateExisting) { throw 'backup_task_already_exists' }
  if ($existingTask.State -eq 'Running') { throw 'backup_task_running' }
  if ($existingTask.Actions.Count -ne 1 -or $existingTask.Actions.WorkingDirectory -ne $workspace -or !$existingTask.Actions.Arguments.Contains('"' + $runner + '"')) { throw 'backup_task_identity_invalid' }
  $taskUserSid = ([Security.Principal.NTAccount]::new($existingTask.Principal.UserId)).Translate([Security.Principal.SecurityIdentifier]).Value
  if ($taskUserSid -ne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) { throw 'backup_task_identity_invalid' }
}
$arguments = '-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -WindowStyle Hidden -File "' + $runner + '" -WorkspacePath "' + $workspace + '" -OperatorEnvFile "' + $operatorEnv + '" -ActorId "' + $ActorId + '"'
$arguments += ' -NodeDirectory "' + $effectiveNodeDirectory + '"'
$arguments += ' -PnpmCliPath "' + $pnpmCli + '"'
if ($LinkedSupabase) { $arguments += ' -LinkedSupabase' }
if ($DpapiConfig) { $arguments += ' -DpapiConfig' }
$powershellExecutable = Join-Path ([Environment]::GetFolderPath('System')) 'WindowsPowerShell/v1.0/powershell.exe'
if (!(Test-Path -LiteralPath $powershellExecutable -PathType Leaf)) { throw 'backup_powershell_required' }
$action = New-ScheduledTaskAction -Execute $powershellExecutable -Argument $arguments -WorkingDirectory $workspace
$trigger = New-ScheduledTaskTrigger -Daily -At $LocalTime
# Same-day backup creation is idempotent. Bounded scheduler retries recover transient failures.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 10)
if ($existingTask) {
  Set-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings | Select-Object TaskName, State
} else {
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'Encrypted logical Postgres backup to existing private Blob; no plaintext dump files; 30-day retention. Requires this trusted operator host and its credentials to remain available.' | Select-Object TaskName, State
}
