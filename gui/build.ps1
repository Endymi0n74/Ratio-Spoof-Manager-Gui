param(
    [Parameter(Mandatory = $true)]
    [string]$RatioSpoofExecutable
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$enginePath = (Resolve-Path -LiteralPath $RatioSpoofExecutable).Path
$sourcePath = Join-Path $PSScriptRoot "ratio_spoof_manager.py"
$distPath = Join-Path $repositoryRoot "dist"
$buildPath = Join-Path $repositoryRoot "build"

if (-not (Test-Path -LiteralPath $enginePath -PathType Leaf)) {
    throw "ratio-spoof.exe was not found: $RatioSpoofExecutable"
}

python -m PyInstaller `
    --noconfirm `
    --clean `
    --onefile `
    --windowed `
    --name "RatioSpoofManager-Modern" `
    --add-binary "$enginePath;." `
    --distpath $distPath `
    --workpath $buildPath `
    --specpath $buildPath `
    $sourcePath

Write-Host "Built: $distPath\RatioSpoofManager-Modern.exe"
