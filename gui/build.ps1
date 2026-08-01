param(
    [Parameter(Mandatory = $true)]
    [string]$RatioSpoofExecutable
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$enginePath = (Resolve-Path -LiteralPath $RatioSpoofExecutable).Path
$sourcePath = Join-Path $PSScriptRoot "ratio_spoof_manager.py"
$assetsPath = Join-Path $PSScriptRoot "assets"
$iconPath = Join-Path $assetsPath "app-icon.ico"
$versionFile = Join-Path $PSScriptRoot "version_info.txt"
$distPath = Join-Path $repositoryRoot "dist"
$buildPath = Join-Path $repositoryRoot "build"

if (-not (Test-Path -LiteralPath $enginePath -PathType Leaf)) {
    throw "ratio-spoof.exe was not found: $RatioSpoofExecutable"
}

New-Item -ItemType Directory -Force -Path $distPath, $buildPath | Out-Null

python -m PyInstaller `
    --noconfirm `
    --clean `
    --onefile `
    --windowed `
    --name "RatioSpoofManager-Windows-x86_64" `
    --icon $iconPath `
    --version-file $versionFile `
    --add-binary "$enginePath;." `
    --add-data "$assetsPath;assets" `
    --distpath $distPath `
    --workpath $buildPath `
    --specpath $buildPath `
    $sourcePath

Write-Host "Built: $distPath\RatioSpoofManager-Windows-x86_64.exe"
