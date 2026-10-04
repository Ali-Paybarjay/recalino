param(
  [Parameter(Mandatory=$true)][string]$OperatorEnvFile,
  [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
$plainBytes = $null
try {
  Add-Type -AssemblyName System.Security
  $allowedNames = @('RECALINO_BACKUP_KEY_BASE64','RECALINO_BACKUP_KEY_ID','RECALINO_BACKUP_SETTINGS_JSON','RECALINO_BACKUP_TOOLS_JSON','RECALINO_SUPABASE_CLI_PATH','RECALINO_BACKUP_LINKED_WORKSPACE','BLOB_READ_WRITE_TOKEN')
  $config = [ordered]@{}
  foreach ($line in [IO.File]::ReadAllLines((Resolve-Path -LiteralPath $OperatorEnvFile).Path)) {
    if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) { continue }
    if ($line -notmatch "^([A-Z0-9_]+)='([^']*)'$" -or $allowedNames -notcontains $Matches[1] -or $config.Contains($Matches[1])) { throw 'backup_protected_config_invalid' }
    $config[$Matches[1]] = $Matches[2]
  }
  if ($config.Count -ne $allowedNames.Count) { throw 'backup_protected_config_invalid' }
  $keyBytes = [Convert]::FromBase64String($config.RECALINO_BACKUP_KEY_BASE64)
  try {
    if ($keyBytes.Length -ne 32 -or [Convert]::ToBase64String($keyBytes) -ne $config.RECALINO_BACKUP_KEY_BASE64) { throw 'backup_protected_config_invalid' }
  } finally { [Array]::Clear($keyBytes, 0, $keyBytes.Length) }
  $settings = $config.RECALINO_BACKUP_SETTINGS_JSON | ConvertFrom-Json
  if ($settings.keyId -ne $config.RECALINO_BACKUP_KEY_ID -or ![IO.Path]::IsPathRooted($config.RECALINO_SUPABASE_CLI_PATH) -or ![IO.Path]::IsPathRooted($config.RECALINO_BACKUP_LINKED_WORKSPACE)) { throw 'backup_protected_config_invalid' }
  if ([IO.File]::ReadAllText((Join-Path $config.RECALINO_BACKUP_LINKED_WORKSPACE 'supabase/.temp/project-ref')).Trim() -ne 'twowhuzhvyuzjrpraikm') { throw 'backup_protected_config_invalid' }
  $entropy = [Text.Encoding]::UTF8.GetBytes('recalino:daily-backup:twowhuzhvyuzjrpraikm:v1')
  $plainBytes = [Text.Encoding]::UTF8.GetBytes(($config | ConvertTo-Json -Compress))
  $cipherBytes = [Security.Cryptography.ProtectedData]::Protect($plainBytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  $protectedConfig = [ordered]@{
    version='1'
    scope='CurrentUser'
    projectRef='twowhuzhvyuzjrpraikm'
    ownerSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    protectedConfig=[Convert]::ToBase64String($cipherBytes)
  }
  $output = [IO.Path]::GetFullPath($OutputPath)
  # CreateNew rejects a competing writer atomically; an existing config is never replaced.
  $outputStream = [IO.File]::Open($output, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $outputBytes = [Text.Encoding]::UTF8.GetBytes(($protectedConfig | ConvertTo-Json -Compress))
    $outputStream.Write($outputBytes, 0, $outputBytes.Length)
    $outputStream.Flush($true)
  } finally { $outputStream.Dispose() }
  [pscustomobject]@{ protectedConfigCreated=$true; scope='CurrentUser'; projectRef='twowhuzhvyuzjrpraikm'; persistentDatabasePassword=$false } | ConvertTo-Json -Compress
} catch {
  Write-Error 'backup_protected_config_failed'
  exit 1
} finally {
  if ($plainBytes) { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
}
