param(
  [Parameter(Mandatory=$true)][string]$WorkspacePath,
  [Parameter(Mandatory=$true)][string]$OperatorEnvFile,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-zA-Z0-9_.-]{1,100}$')][string]$ActorId,
  [switch]$LinkedSupabase,
  [string]$NodeDirectory,
  [string]$PnpmCliPath,
  [switch]$DpapiConfig
)
$ErrorActionPreference = 'Stop'
function Write-BackupTaskStatus($status) {
  $statusJson = $status | ConvertTo-Json -Depth 4 -Compress
  # Both records contain only fixed stages/codes and whitelisted archive metadata.
  $statusPaths = @(
    (Join-Path (Split-Path -Parent $OperatorEnvFile) 'daily-status.json'),
    (Join-Path $WorkspacePath '.vercel/backup-task-runtime.json')
  )
  foreach ($statusPath in $statusPaths) {
    try { [IO.File]::WriteAllText($statusPath, $statusJson, [Text.UTF8Encoding]::new($false)) } catch { }
  }
  Write-Output $statusJson
}
$backupStage = 'arguments'
$backupInstalledEnv = @{}
try {
if ($DpapiConfig -and !$LinkedSupabase) { throw 'backup_protected_linked_required' }
$backupStage = 'workspace'
$workspace = (Resolve-Path -LiteralPath $WorkspacePath).Path
$backupStage = 'private_config'
$operatorEnv = (Resolve-Path -LiteralPath $OperatorEnvFile).Path
if ($DpapiConfig) {
  $backupStage = 'protected_config'
  Add-Type -AssemblyName System.Security
  $protectedConfig = [IO.File]::ReadAllText($operatorEnv) | ConvertFrom-Json
  if ($protectedConfig.version -ne '1' -or $protectedConfig.scope -ne 'CurrentUser' -or $protectedConfig.projectRef -ne 'twowhuzhvyuzjrpraikm' -or $protectedConfig.ownerSid -ne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) { throw 'backup_protected_identity_invalid' }
  $cipherBytes = [Convert]::FromBase64String($protectedConfig.protectedConfig)
  if ($cipherBytes.Length -gt 32768) { throw 'backup_protected_config_invalid' }
  $entropy = [Text.Encoding]::UTF8.GetBytes('recalino:daily-backup:twowhuzhvyuzjrpraikm:v1')
  $plainBytes = [Security.Cryptography.ProtectedData]::Unprotect($cipherBytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  try {
    $backupConfig = [Text.Encoding]::UTF8.GetString($plainBytes) | ConvertFrom-Json
    $allowedNames = @('RECALINO_BACKUP_KEY_BASE64','RECALINO_BACKUP_KEY_ID','RECALINO_BACKUP_SETTINGS_JSON','RECALINO_BACKUP_TOOLS_JSON','RECALINO_SUPABASE_CLI_PATH','RECALINO_BACKUP_LINKED_WORKSPACE','BLOB_READ_WRITE_TOKEN')
    if (@($backupConfig.PSObject.Properties).Count -ne $allowedNames.Count -or $backupConfig.RECALINO_BACKUP_LINKED_WORKSPACE -ne $workspace) { throw 'backup_protected_config_invalid' }
    foreach ($backupProperty in $backupConfig.PSObject.Properties) {
      if ($allowedNames -notcontains $backupProperty.Name -or $backupProperty.Value -isnot [string] -or [string]::IsNullOrEmpty($backupProperty.Value)) { throw 'backup_protected_config_invalid' }
      $backupInstalledEnv[$backupProperty.Name] = [Environment]::GetEnvironmentVariable($backupProperty.Name, 'Process')
      [Environment]::SetEnvironmentVariable($backupProperty.Name, $backupProperty.Value, 'Process')
    }
  } finally { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
}
$backupStage = 'node_path'
if ($NodeDirectory) {
  $effectiveNodeDirectory = (Resolve-Path -LiteralPath $NodeDirectory).Path
  $nodeExecutable = Join-Path $effectiveNodeDirectory 'node.exe'
} else {
  $nodeExecutable = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  $effectiveNodeDirectory = Split-Path -Parent $nodeExecutable
}
if (!(Test-Path -LiteralPath $effectiveNodeDirectory -PathType Container) -or !(Test-Path -LiteralPath $nodeExecutable -PathType Leaf)) { throw 'backup_node24_required' }
$backupStage = 'node_version'
$nodeVersion = (& $nodeExecutable --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v24\.[0-9]+\.[0-9]+$') { throw 'backup_node24_required' }
$env:PATH = $effectiveNodeDirectory + [IO.Path]::PathSeparator + $env:PATH
$backupStage = 'pnpm_path'
if ($PnpmCliPath) {
  $pnpmCli = (Resolve-Path -LiteralPath $PnpmCliPath).Path
} else {
  $pnpmLauncher = (Get-Command pnpm -ErrorAction Stop | Select-Object -First 1).Source
  $pnpmCli = Join-Path (Split-Path -Parent $pnpmLauncher) 'node_modules/corepack/dist/pnpm.js'
}
if (!(Test-Path -LiteralPath $pnpmCli -PathType Leaf)) { throw 'backup_pnpm_cli_required' }
$backupStage = 'workspace_runner'
$runner = Join-Path $workspace 'packages/ops-cli/src/backup.ts'
if (!(Test-Path -LiteralPath $runner -PathType Leaf)) { throw 'backup_workspace_invalid' }
Set-Location -LiteralPath $workspace
$backupArgs = @('--filter','@recalino/ops-cli','backup','--','--command','create','--actor',$ActorId,'--reason','Scheduled daily encrypted logical backup under ADR-0001')
if (!$DpapiConfig) { $backupArgs += @('--env',$operatorEnv) }
if ($LinkedSupabase) { $backupArgs += '--linked-supabase' }
$backupStage = 'execution'
$backupOutput = @()
$backupExitCode = 1
$backupFailure = 'backup_schedule_execution_failed'
$previousErrorPreference = $ErrorActionPreference
try {
  # Capture diagnostics in memory. Only the CLI's validated, non-secret result is persisted.
  $ErrorActionPreference = 'Continue'
  $backupOutput = @(& $nodeExecutable $pnpmCli @backupArgs 2>&1)
  $backupExitCode = $LASTEXITCODE
} catch {
  $backupExitCode = 1
} finally {
  $ErrorActionPreference = $previousErrorPreference
}
$backupResult = $null
$backupChildFailure = $null
$backupAllowedChildStages = @('arguments','environment_file','configuration','settings_validation','tools_validation','key_validation','linked_credentials','manifest_connection','archive_and_manifest','journal_read','isolated_restore')
$backupAllowedChildErrors = @('backup_arguments_invalid','backup_configuration_required','backup_linked_configuration_invalid','backup_linked_identity_invalid','backup_linked_generator_invalid','backup_linked_tls_required','backup_linked_cli_unavailable','backup_native_failed','backup_native_timeout','backup_catalog_invalid','backup_recovery_key_required','backup_integrity_failed','restore_local_target_required','restore_admin_database_required','restore_constraints_invalid','journal_integrity_failed','journal_recovery_key_required','backup_archive_invalid','backup_size_limit','backup_key_invalid','backup_native_server_version','backup_native_permission_denied','backup_native_tls_failed','backup_native_connection_failed','backup_native_dns_failed','backup_native_auth_failed','backup_native_connection_refused','backup_native_network_timeout','backup_native_network_unreachable','backup_native_tenant_failed','backup_operator_action_failed')
foreach ($backupLine in $backupOutput) {
  try {
    $backupCandidate = $backupLine.ToString() | ConvertFrom-Json -ErrorAction Stop
    # The CLI already sanitizes errors; accept only exact fixed enums here too.
    if ($backupAllowedChildStages -contains $backupCandidate.stage -and $backupAllowedChildErrors -contains $backupCandidate.error) {
      $backupChildFailure = [ordered]@{ stage=$backupCandidate.stage; error=$backupCandidate.error }
    }
    if ($backupCandidate.state -eq 'ready' -and $backupCandidate.id -match '^[a-fA-F0-9-]{36}$' -and $backupCandidate.keyId -match '^[a-zA-Z0-9_.-]{1,100}$' -and $backupCandidate.encryptedBytes -is [ValueType] -and $backupCandidate.encryptedBytes -gt 0) {
      $backupResult = [ordered]@{
        id=$backupCandidate.id
        state='ready'
        keyId=$backupCandidate.keyId
        encryptedBytes=[long]$backupCandidate.encryptedBytes
      }
    }
  } catch { }
}
if ($backupExitCode -eq 0 -and !$backupResult) { $backupExitCode = 1; $backupFailure = 'backup_schedule_result_missing' }
$backupStatus = [ordered]@{
  version='1'
  checkedAt=[DateTimeOffset]::UtcNow.ToString('o')
  nodeVersion=$nodeVersion
  linkedSupabase=[bool]$LinkedSupabase
  exitCode=$backupExitCode
  result=if ($backupExitCode -eq 0) { $backupResult } else { $null }
  error=if ($backupExitCode -eq 0) { $null } else { $backupFailure }
  childFailure=if ($backupExitCode -eq 0) { $null } else { $backupChildFailure }
}
Write-BackupTaskStatus $backupStatus
exit $backupExitCode
} catch {
  $backupKnownPreflightErrors = @('backup_node24_required','backup_pnpm_cli_required','backup_workspace_invalid','backup_protected_config_invalid','backup_protected_identity_invalid','backup_protected_linked_required')
  $backupSafeError = if ($backupKnownPreflightErrors -contains $_.Exception.Message) { $_.Exception.Message } else { 'backup_schedule_preflight_failed' }
  Write-BackupTaskStatus ([ordered]@{
    version='1'
    checkedAt=[DateTimeOffset]::UtcNow.ToString('o')
    stage=$backupStage
    exitCode=1
    result=$null
    error=$backupSafeError
  })
  exit 1
} finally {
  foreach ($backupEnvName in $backupInstalledEnv.Keys) { [Environment]::SetEnvironmentVariable($backupEnvName, $backupInstalledEnv[$backupEnvName], 'Process') }
}
