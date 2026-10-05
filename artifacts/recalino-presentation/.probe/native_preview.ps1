param(
    [Parameter(Mandatory = $true)][string]$InputPptx,
    [Parameter(Mandatory = $true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$resolvedPptx = (Resolve-Path -LiteralPath $InputPptx).Path
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null
$pptApp = $null
$probeDeck = $null
try {
    $pptApp = New-Object -ComObject PowerPoint.Application
    # ReadOnly=true, Untitled=false, WithWindow=false. No document UI is opened.
    $probeDeck = $pptApp.Presentations.Open($resolvedPptx, -1, 0, 0)
    for ($slideNumber = 1; $slideNumber -le $probeDeck.Slides.Count; $slideNumber++) {
        $destination = Join-Path $resolvedOutput ('slide-' + $slideNumber + '.png')
        $probeDeck.Slides.Item($slideNumber).Export($destination, 'PNG', 1280, 720)
    }
    Write-Output ('Exported ' + $probeDeck.Slides.Count + ' slides from PowerPoint.')
} finally {
    if ($null -ne $probeDeck) {
        $probeDeck.Close()
        [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($probeDeck) | Out-Null
    }
    if ($null -ne $pptApp) {
        # Do not Quit: PowerPoint may share a user's existing application instance.
        [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($pptApp) | Out-Null
    }
}
