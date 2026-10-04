param(
  [Parameter(Mandatory=$true)][string]$WorkspacePath,
  [Parameter(Mandatory=$true)][string]$OperatorEnvFile,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-zA-Z0-9_.-]{1,100}$')][string]$ActorId,
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
$env:PATH = $effectiveNodeDirectory + [IO.Path]::PathSeparator + $env:PATH
$runner = Join-Path $workspace 'packages/ops-cli/src/backup.ts'
if (!(Test-Path -LiteralPath $runner -PathType Leaf)) { throw 'backup_workspace_invalid' }
Set-Location -LiteralPath $workspace
$backupArgs = @('--filter','@recalino/ops-cli','backup','--command','create','--env',$operatorEnv,'--actor',$ActorId,'--reason','Scheduled daily encrypted logical backup under ADR-0001')
if ($LinkedSupabase) { $backupArgs += '--linked-supabase' }
& pnpm @backupArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
