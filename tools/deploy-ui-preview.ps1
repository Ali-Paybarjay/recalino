param([switch]$Deploy)

# Invoke only after the local production fixture checks pass. Without -Deploy this is a plan.
# No local/cloud credentials are read. All overrides are harmless, deployment-specific fixtures.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$linkedProject = Get-Content -LiteralPath (Join-Path $workspace '.vercel/project.json') -Raw | ConvertFrom-Json
if ($linkedProject.projectId -ne 'prj_sexBQckLtPOxFHgqV385Bx1JaxqF' -or
    $linkedProject.orgId -ne 'team_8WX5ZTQoGLK3XQim9CHcQ350') {
    throw 'This script requires the existing linked Recalino project.'
}

$scope = 'ali-paybarjay-s-projects'
$project = 'recalino'
$syntheticKey = 'ui-preview-disabled-' + [System.Guid]::NewGuid().ToString('N')
$fixture = [ordered]@{
    RECALINO_UI_PREVIEW = '1'
    DATABASE_URL = 'postgresql://sample:sample@127.0.0.1:1/recalino_preview'
    SUPABASE_URL = 'https://ui-preview.invalid'
    SUPABASE_PUBLISHABLE_KEY = $syntheticKey
    SUPABASE_SECRET_KEY = $syntheticKey
    BLOB_READ_WRITE_TOKEN = $syntheticKey
    BLOB_STORE_ID = 'ui-preview-disabled'
    RATE_LIMIT_IP_KEY = $syntheticKey
    CRON_SECRET = $syntheticKey
}

$deploymentArgs = @('deploy', '--target=preview', '--scope', $scope, '--project', $project, '--yes', '--cwd', $workspace)
foreach ($entry in $fixture.GetEnumerator()) {
    $assignment = '{0}={1}' -f $entry.Key, $entry.Value
    $deploymentArgs += @('--env', $assignment, '--build-env', $assignment)
}

if (-not $Deploy) {
    Write-Output "Prepared existing-project Preview deployment: $scope/$project."
    Write-Output 'Both runtime and build receive the fixture flag and eight synthetic backend overrides.'
    Write-Output 'No project environment, deployment protection, production alias or cloud data is changed.'
    Write-Output 'After verification, invoke this script with -Deploy. Create a deployment-specific share link separately.'
    return
}

& vercel @deploymentArgs
if ($LASTEXITCODE -ne 0) { throw 'The UI Preview deployment did not complete successfully.' }
