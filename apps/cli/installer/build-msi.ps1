<#
.SYNOPSIS
    Build a WiX v4 MSI installer for df-cli.

.DESCRIPTION
    Produces `dist/df-cli-<version>.msi` from:
      1. A Python wheel (built in-tree via pip wheel).
      2. The WiX v4 Product.wxs source in this directory.
      3. Banner / icon assets in `installer/resources/`.

    Prerequisites on the build machine:
      - .NET 8 SDK
      - WiX v4 toolset:  dotnet tool install --global wix
      - Python 3.11+ on PATH as `python`

.PARAMETER Version
    Semantic version string for the MSI (default: read from pyproject.toml).

.PARAMETER UpgradeCode
    Stable MSI UpgradeCode GUID. If not provided, a new one is generated and
    printed to the console — copy it into Product.wxs to make upgrades stable.

.PARAMETER OutputDir
    Directory where the .msi is written (default: installer/dist/).

.PARAMETER SkipWheel
    Skip the wheel build step (use an existing wheel in installer/dist/).

.EXAMPLE
    .\build-msi.ps1 -Version "0.2.0"
    # Full build from scratch.

.EXAMPLE
    .\build-msi.ps1
    # Use version from pyproject.toml; generate an UpgradeCode.

.EXAMPLE
    .\build-msi.ps1 -SkipWheel
    # Re-run WiX only, reusing an existing wheel.
#>

param(
    [string]$Version     = "",
    [string]$UpgradeCode = "",
    [string]$OutputDir   = "",
    [switch]$SkipWheel
)

$ErrorActionPreference = "Stop"
$InstallerDir         = $PSScriptRoot
$CliRoot              = Split-Path $InstallerDir -Parent   # apps/cli/
$ProjectRoot          = Split-Path $CliRoot -Parent         # repo root

# ── version from pyproject.toml ───────────────────────────────────────────────
if (-not $Version) {
    $tomlPath = Join-Path $CliRoot "pyproject.toml"
    $tomlRaw  = Get-Content $tomlPath -Raw
    if ($tomlRaw -match 'version\s*=\s*"([^"]+)"') {
        $Version = $Matches[1]
    } else {
        Write-Error "Could not parse version from pyproject.toml"
        exit 1
    }
}

# ── output dir ────────────────────────────────────────────────────────────────
if (-not $OutputDir) { $OutputDir = Join-Path $InstallerDir "dist" }
$SourceDir  = Join-Path $InstallerDir "dist"
$ResourcesDir = Join-Path $InstallerDir "resources"
if (-not (Test-Path $OutputDir)) { New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null }
if (-not (Test-Path $SourceDir)) { New-Item -ItemType Directory -Path $SourceDir -Force | Out-Null }

Write-Host ""
Write-Host "=== DataFoundry CLI MSI Builder ===" -ForegroundColor Cyan
Write-Host "  Version    : $Version"
Write-Host "  Output dir : $OutputDir"
Write-Host "  Source dir : $SourceDir"
Write-Host ""

# ── Python check ──────────────────────────────────────────────────────────────
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    Write-Error "Python not found on PATH. Install Python 3.11+ from https://www.python.org/downloads/"
    exit 1
}
Write-Host "Python: $(python --version 2>&1)" -ForegroundColor Green

# ── WiX check ─────────────────────────────────────────────────────────────────
$wix = Get-Command wix -ErrorAction SilentlyContinue
if (-not $wix) {
    Write-Host "WiX v4 not found. Installing..." -ForegroundColor Yellow
    dotnet tool install --global wix
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to install WiX. Run manually: dotnet tool install --global wix"
        exit 1
    }
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + $env:Path
    $wix = Get-Command wix -ErrorAction SilentlyContinue
}
if (-not $wix) {
    Write-Error "WiX not on PATH after install. Restart PowerShell or add $env:LOCALAPPDATA\.dotnet\tools to PATH."
    exit 1
}
Write-Host "WiX: $($wix.Source)" -ForegroundColor Green

# ── build wheel ───────────────────────────────────────────────────────────────
if (-not $SkipWheel) {
    Write-Host ""
    Write-Host "Step 1/4 — Building Python wheel..." -ForegroundColor Cyan
    Push-Location $CliRoot
    try {
        python -m pip install --upgrade pip hatchling 2>&1 | Out-Null
        python -m pip wheel . --no-deps --wheel-dir $SourceDir 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Wheel build failed."
            exit 1
        }
    } finally {
        Pop-Location
    }
    $wheel = Get-ChildItem $SourceDir -Filter "df_cli-*.whl" | Select-Object -First 1
    if (-not $wheel) {
        Write-Error "No wheel found in $SourceDir after build."
        exit 1
    }
    Write-Host "Wheel: $($wheel.Name)" -ForegroundColor Green
} else {
    $wheel = Get-ChildItem $SourceDir -Filter "df_cli-*.whl" | Select-Object -First 1
    if (-not $wheel) {
        Write-Error "SkipWheel set but no wheel found in $SourceDir. Run without -SkipWheel first."
        exit 1
    }
    Write-Host "Reusing wheel: $($wheel.Name)" -ForegroundColor Yellow
}

# ── prepare resource stubs ─────────────────────────────────────────────────────
Write-Host ""
Write-Host "Step 2/4 — Preparing resources..." -ForegroundColor Cyan
if (-not (Test-Path $ResourcesDir)) {
    New-Item -ItemType Directory -Path $ResourcesDir -Force | Out-Null
}

# ── Generate dfcli.ico (multi-size ICO) ─────────────────────────────────────
$icoPath = Join-Path $ResourcesDir "dfcli.ico"
Write-Host "  Generating dfcli.ico ..." -NoNewline

# DataFoundry brand colours
$DF_BLUE   = [System.Drawing.Color]::FromArgb(255, 45, 82, 134)   # #2D5286
$DF_TEAL   = [System.Drawing.Color]::FromArgb(255, 32,  137, 165)  # #2089A5
$DF_LIGHT  = [System.Drawing.Color]::FromArgb(255, 240, 248, 255)  # #F0F8FF

# Sizes required for a modern Windows ICO
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$iconSizes = $sizes | ForEach-Object { [Math]::Max(16, $_) }

# Build the ICO manually with embedded PNG images
# ICO header: 6 bytes
# Directory entries: 16 bytes each
# Image data: PNG bytes for each size

$iconMs = New-Object System.IO.MemoryStream
$iconBw = New-Object System.IO.BinaryWriter($iconMs)

# Count of images
$iconBw.Write([UInt16]($sizes.Count))
# First image data offset = 6 + (16 * count)
$firstOffset = 6 + (16 * $sizes.Count)
$imageOffsets = @(0) * $sizes.Count
$pngDataList = New-Object object[] $sizes.Count

# Generate PNG data for each size first
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $pngDataList[$i] = New-PngBytes -Width $sizes[$i] -Height $sizes[$i] `
        -BackgroundColor ([System.Drawing.ColorTranslator]::ToWin32($DF_BLUE)) `
        -ForegroundColor ([System.Drawing.ColorTranslator]::ToWin32($DF_TEAL)) `
        -Text "DF"
}

# Compute offsets
$cumulative = $firstOffset
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $imageOffsets[$i] = $cumulative
    $cumulative += $pngDataList[$i].Length
}

# Write directory entries
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $size = $sizes[$i]
    $w = if ($size -ge 256) { [byte]0 } else { [byte]$size }
    $h = if ($size -ge 256) { [byte]0 } else { [byte]$size }
    $iconBw.Write([byte]$w)           # Width
    $iconBw.Write([byte]$h)           # Height
    $iconBw.Write([byte]0)           # Color palette
    $iconBw.Write([byte]0)           # Reserved
    $iconBw.Write([UInt16]1)         # Colour planes
    $iconBw.Write([UInt16]32)        # Bits per pixel
    $iconBw.Write([UInt32]$pngDataList[$i].Length)  # Image data size
    $iconBw.Write([UInt32]$imageOffsets[$i])         # Image data offset
}

# Write image data
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $iconBw.Write($pngDataList[$i])
}

$iconBw.Flush()
[System.IO.File]::WriteAllBytes($icoPath, $iconMs.ToArray())
$iconBw.Close(); $iconMs.Close()
Write-Host " OK ($icoPath)" -ForegroundColor Green

# ── Generate banner.bmp (WiX UI banner — 493 × 64 pixels) ──────────────────
$bannerPath = Join-Path $ResourcesDir "banner.bmp"
Write-Host "  Generating banner.bmp ..." -NoNewline

$bannerBytes = New-BannerBmp -Width 493 -Height 64 `
    -BackgroundColor ([System.Drawing.ColorTranslator]::ToWin32($DF_BLUE)) `
    -AccentColor    ([System.Drawing.ColorTranslator]::ToWin32($DF_TEAL))
[System.IO.File]::WriteAllBytes($bannerPath, $bannerBytes)
Write-Host " OK ($bannerPath)" -ForegroundColor Green

# df-launch.bat (UTF-8 BOM — ensures cmd.exe reads it correctly on non-English Windows)
$launcherBom = [byte[]](0xEF, 0xBB, 0xBF)
$launcherContent = "@echo off`npython -m df_cli.app %*`n"
[System.IO.File]::WriteAllBytes(
    (Join-Path $SourceDir "df-launch.bat"),
    $launcherBom + [System.Text.Encoding]::UTF8.GetBytes($launcherContent)
)
[System.IO.File]::WriteAllBytes(
    (Join-Path $SourceDir "df-cli-launch.bat"),
    $launcherBom + [System.Text.Encoding]::UTF8.GetBytes($launcherContent)
)

# Banner BMP for WiX UI (if not present, create a minimal one)
$banner = Join-Path $ResourcesDir "banner.bmp"
if (-not (Test-Path $banner)) {
    Write-Warning "installer/resources/banner.bmp not found — WiX will use a default banner."
}

Write-Host "  Launchers written to: $SourceDir" -ForegroundColor DarkGray

# ── upgrade code ───────────────────────────────────────────────────────────────
if (-not $UpgradeCode) {
    $UpgradeCode = [guid]::NewGuid().ToString().ToUpper()
    Write-Host ""
    Write-Host "UpgradeCode not set. Using: $UpgradeCode" -ForegroundColor Yellow
    Write-Host "  Copy this into Product.wxs as UpgradeCode=""$UpgradeCode""" -ForegroundColor Yellow
}

# ── invoke WiX ─────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Step 3/4 — Running WiX..." -ForegroundColor Cyan

$msiOutput = Join-Path $OutputDir "df-cli-$Version.msi"

$wixArgs = @(
    "build"
    (Join-Path $InstallerDir "Product.wxs")
    "--output", $msiOutput
    "--bind-path", "SourceDir=$SourceDir"
    "--bind-path", "ResourcesDir=$ResourcesDir"
    "-var", "var.SourceDir=$SourceDir"
    "-var", "var.ResourcesDir=$ResourcesDir"
    "-dVersion=$Version"
    "-dUpgradeCode=$UpgradeCode"
)

Write-Host "wix $($wixArgs -join ' ')" -ForegroundColor DarkGray
wix @wixArgs 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "WiX build failed (exit code $LASTEXITCODE). See errors above."
    exit 1
}

# ── sign the MSI (optional) ───────────────────────────────────────────────────
Write-Host ""
Write-Host "Step 4/4 — Verifying output..." -ForegroundColor Cyan
if (-not (Test-Path $msiOutput)) {
    Write-Error "MSI was not produced at: $msiOutput"
    exit 1
}
$msiSize = [math]::Round((Get-Item $msiOutput).Length / 1MB, 2)
Write-Host ""
Write-Host "=== Build complete ===" -ForegroundColor Green
Write-Host "  MSI : $msiOutput"
Write-Host "  Size: $msiSize MB"
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Sign the MSI: signtool sign /fd SHA256 /td SHA256 /tr http://timestamp.digicert.com $msiOutput"
Write-Host "  2. Upload to your distribution endpoint."
Write-Host ""

# ══════════════════════════════════════════════════════════════════════════════
# Helper functions — must appear after all param/usage code
# ════════════════════════════════════════════════════════════════════════════════

function New-PngBytes {
    <#
    .SYNOPSIS
        Generates a PNG byte array for a solid-colour square icon with "DF" text.
        Uses System.Drawing-free pure .NET byte construction.
    #>
    param(
        [int]$Width,
        [int]$Height,
        [int]$BackgroundColor,
        [int]$AccentColor
    )

    # We use System.Drawing as a fallback since it's built into Windows .NET
    Add-Type -AssemblyName System.Drawing

    $bmp = New-Object System.Drawing.Bitmap($Width, $Height)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)

    # Fill background
    $bgBrush = New-Object System.Drawing.SolidBrush(
        [System.Drawing.Color]::FromArgb($BackgroundColor))
    $g.FillRectangle($bgBrush, 0, 0, $Width, $Height)

    # Draw "DF" text
    $accentBrush = New-Object System.Drawing.SolidBrush(
        [System.Drawing.Color]::FromArgb($AccentColor))
    $fontSize = [Math]::Max(6, [Math]::Floor($Width * 0.45))
    $font = New-Object System.Drawing.Font("Segoe UI", $fontSize,
        [System.Drawing.FontStyle]::Bold)

    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment     = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center

    $rect = New-Object System.Drawing.RectangleF(0, 0, $Width, $Height)
    $g.DrawString("DF", $font, $accentBrush, $rect, $sf)

    # Draw a subtle border
    $pen = New-Object System.Drawing.Pen($accentBrush, [Math]::Max(1, [Math]::Floor($Width * 0.04)))
    $g.DrawRectangle($pen, 0, 0, $Width - 1, $Height - 1)

    $g.Dispose()
    $bgBrush.Dispose()
    $accentBrush.Dispose()
    $font.Dispose()
    $sf.Dispose()
    $pen.Dispose()

    # Convert bitmap to PNG bytes
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $ms.ToArray()
    $ms.Close()
    $bmp.Dispose()
    return $bytes
}

function New-BannerBmp {
    <#
    .SYNOPSIS
        Generates a Windows BMP file for the WiX UI banner (493 × 64 pixels).
        The banner has a gradient background, brand name, and a right-side accent stripe.
    #>
    param(
        [int]$Width = 493,
        [int]$Height = 64,
        [int]$BackgroundColor,
        [int]$AccentColor
    )

    Add-Type -AssemblyName System.Drawing

    $bmp = New-Object System.Drawing.Bitmap($Width, $Height)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

    # Gradient background: left side darker, right side lighter
    $cb = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Point(0, 0)),
        (New-Object System.Drawing.Point($Width, 0)),
        [System.Drawing.Color]::FromArgb($BackgroundColor),
        [System.Drawing.Color]::FromArgb(
            [System.Drawing.Color]::FromArgb($BackgroundColor).R + 20,
            [System.Drawing.Color]::FromArgb($BackgroundColor).G + 30,
            [System.Drawing.Color]::FromArgb($BackgroundColor).B + 40
        )
    )
    $g.FillRectangle($cb, 0, 0, $Width, $Height)

    # Accent stripe on the right (8px wide)
    $accentBrush = New-Object System.Drawing.SolidBrush(
        [System.Drawing.Color]::FromArgb($AccentColor))
    $g.FillRectangle($accentBrush, $Width - 8, 0, 8, $Height)

    # Brand name: "DataFoundry" in white, large
    $whiteBrush = New-Object System.Drawing.SolidBrush(
        [System.Drawing.Color]::FromArgb(255, 255, 255, 255))
    $titleFont = New-Object System.Drawing.Font("Segoe UI",
        [Math]::Max(10, [Math]::Floor($Height * 0.28)),
        [System.Drawing.FontStyle]::Bold)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment     = [System.Drawing.StringAlignment]::Near
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center

    # Left padding: 16px
    $textRect = New-Object System.Drawing.RectangleF(16, 0, $Width - 24, $Height)
    $g.DrawString("DataFoundry", $titleFont, $whiteBrush, $textRect, $sf)

    # Version tag in accent colour
    $tagFont = New-Object System.Drawing.Font("Segoe UI",
        [Math]::Max(8, [Math]::Floor($Height * 0.18)),
        [System.Drawing.FontStyle]::Regular)
    $tagRect = New-Object System.Drawing.RectangleF(16,
        [Math]::Floor($Height * 0.55), $Width - 24, [Math]::Floor($Height * 0.35))
    $g.DrawString("Command-Line Interface", $tagFont, $accentBrush, $tagRect, $sf)

    $g.Dispose()
    $cb.Dispose()
    $accentBrush.Dispose()
    $whiteBrush.Dispose()
    $titleFont.Dispose()
    $tagFont.Dispose()
    $sf.Dispose()

    # Convert to BMP (BITMAPINFOHEADER format)
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Bmp)
    $bytes = $ms.ToArray()
    $ms.Close()
    $bmp.Dispose()

    # System.Drawing saves BMP with a 14-byte BITMAPFILEHEADER + DIB header.
    # For WiX, strip the BITMAPFILEHEADER (first 14 bytes) if present,
    # then re-add the BITMAPFILEHEADER.
    # Actually WiX expects a full BMP with file header, so we keep it as-is.
    return $bytes
}
