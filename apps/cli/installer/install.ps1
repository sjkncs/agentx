<#
.SYNOPSIS
    AgentX CLI bootstrap installer (install.ps1).

.DESCRIPTION
    Installs df-cli via pip into a user-owned virtual environment,
    then creates lightweight .bat launcher stubs on the system PATH
    so the `df` / `df-cli` commands are available in any terminal session.

    This is the "zero-WiX" path for users who want a quick install
    without building an MSI. For enterprise / controlled deployment
    use build-msi.ps1 + WiX to produce a proper .msi installer.

.PARAMETER Version
    Specific pip version to install (default: latest from PyPI).

.PARAMETER PyProjectRoot
    Path to the df-cli pyproject.toml root (default: this script's parent).

.PARAMETER InstallScope
    "user" (default) or "machine". Machine scope requires admin privileges.

.PARAMETER SkipPythonCheck
    Skip the Python availability check.

.EXAMPLE
    .\install.ps1
    # Install latest df-cli for current user.

.EXAMPLE
    .\install.ps1 -Version "0.2.0" -InstallScope machine
    # Install a specific version for all users (requires admin).
#>

param(
    [string]$Version       = "latest",
    [string]$PyProjectRoot = $PSScriptRoot,
    [ValidateSet("user", "machine")][string]$InstallScope = "user",
    [switch]$SkipPythonCheck
)

$ErrorActionPreference = "Stop"
$ProgressPreference     = "SilentlyContinue"

# ── helpers ──────────────────────────────────────────────────────────────────

function Assert-Administrator {
    if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
            [Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Error "Machine-scope install requires Administrator privileges. Run PowerShell as admin, or use -InstallScope user."
        exit 1
    }
}

function Assert-Python([string]$Version = "3.11") {
    $python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $python) {
        Write-Error "Python is not installed or not on PATH.`nDownload from https://www.python.org/downloads/"
        exit 1
    }
    $pyVersion = python --version 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Error "python command failed: $pyVersion"
        exit 1
    }
    # Extract major.minor
    $m = $pyVersion -match 'Python (\d+\.\d+)'
    if (-not $m) {
        Write-Error "Unable to parse Python version: $pyVersion"
        exit 1
    }
    $pyVer = [version]$Matches[1]
    $minVer = [version]$Version
    if ($pyVer -lt $minVer) {
        Write-Error "df-cli requires Python $Version or newer (found: $pyVer). Please upgrade Python."
        exit 1
    }
    Write-Host "Python $pyVer detected." -ForegroundColor Green
}

function Invoke-PipInstall {
    param([string]$WheelPath, [string]$Scope)
    $scopeArg = if ($Scope -eq "machine") { "--system" } else { "--user" }
    Write-Host "Installing df-cli from $WheelPath ..." -ForegroundColor Cyan
    pip install $scopeArg $WheelPath
    if ($LASTEXITCODE -ne 0) {
        Write-Error "pip install failed."
        exit 1
    }
}

function New-BatchLauncher {
    param(
        [string]$Path,
        [string]$ScriptName,
        [string]$Cmd
    )
    # Write a UTF-8 with BOM launcher (BOM ensures correct encoding on Windows)
    $bom = [byte[]](0xEF, 0xBB, 0xBF)
    $content = "@echo off`npython -m df_cli.$ScriptName %*`n"
    [System.IO.File]::WriteAllBytes($Path, $bom + [System.Text.Encoding]::UTF8.GetBytes($content))
    Write-Host "Created launcher: $Path" -ForegroundColor Green
}

function Register-Path {
    param([string]$Path)
    $current = [Environment]::GetEnvironmentVariable("Path", "Machine")
    if ($current -notlike "*$Path*") {
        [Environment]::SetEnvironmentVariable("Path", "$current;$Path", "Machine")
        $env:Path = "$env:Path;$Path"
        Write-Host "Added $Path to system PATH (persistent)." -ForegroundColor Green
    } else {
        Write-Host "PATH already contains $Path." -ForegroundColor Yellow
    }
}

# ── main ──────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "=== AgentX CLI Installer ===" -ForegroundColor Cyan
Write-Host "Scope: $InstallScope" -ForegroundColor DarkGray
Write-Host ""

# 1. Python check
if (-not $SkipPythonCheck) {
    Assert-Python
}

# 2. Scope check
if ($InstallScope -eq "machine") {
    Assert-Administrator
}

# 3. Resolve pyproject.toml
$pyproject = Join-Path $PyProjectRoot "pyproject.toml"
if (-not (Test-Path $pyproject)) {
    Write-Error "pyproject.toml not found at: $pyproject"
    Write-Error "Run this script from the df-cli project root, or set -PyProjectRoot."
    exit 1
}

# 4. Build / fetch wheel
$distDir   = Join-Path $PyProjectRoot "dist"
$wheelPath = $null

# Look for a pre-built wheel matching the requested version
if ($Version -ne "latest") {
    $candidate = Get-ChildItem $distDir -Filter "df_cli-$Version-*.whl" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($candidate) { $wheelPath = $candidate.FullName }
}
# Otherwise build fresh
if (-not $wheelPath) {
    Write-Host "Building wheel (no existing dist/ found or -Version=latest)..." -ForegroundColor Cyan
    Push-Location $PyProjectRoot
    try {
        # Ensure pip is recent
        python -m pip install --upgrade pip | Out-Null

        # Build wheel into dist/
        python -m pip wheel . --no-deps --wheel-dir $distDir
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Failed to build wheel."
            exit 1
        }
        $wheelPath = (Get-ChildItem $distDir -Filter "df_cli-*.whl" | Select-Object -First 1).FullName
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path $wheelPath)) {
    Write-Error "Could not resolve wheel path: $wheelPath"
    exit 1
}
Write-Host "Using wheel: $wheelPath" -ForegroundColor DarkGray

# 5. Install via pip
Invoke-PipInstall -WheelPath $wheelPath -Scope $InstallScope

# 6. Create .bat launchers on PATH
# Choose a well-known user-writable location that is on PATH by default on Win10+
$launcherDir = if ($InstallScope -eq "machine") {
    "C:\ProgramData\df-cli\bin"
} else {
    "$HOME\AppData\Local\df-cli\bin"
}

if (-not (Test-Path $launcherDir)) {
    New-Item -ItemType Directory -Path $launcherDir -Force | Out-Null
}

# Place both launchers
New-BatchLauncher -Path (Join-Path $launcherDir "df.bat")       -ScriptName "app"   -Cmd "df"
New-BatchLauncher -Path (Join-Path $launcherDir "df-cli.bat")    -ScriptName "app"   -Cmd "df-cli"

# 7. Register launcher dir on PATH
if ($InstallScope -eq "machine") {
    Register-Path -Path $launcherDir
} else {
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -notlike "*$launcherDir*") {
        [Environment]::SetEnvironmentVariable("Path", "$userPath;$launcherDir", "User")
        $env:Path = "$env:Path;$launcherDir"
        Write-Host "Added $launcherDir to user PATH (persistent)." -ForegroundColor Green
    }
}

# 8. Verify
Write-Host ""
Write-Host "Verifying installation..." -ForegroundColor Cyan
$dfCmd = Get-Command df -ErrorAction SilentlyContinue
if (-not $dfCmd) {
    $dfCmd = Get-Command "$launcherDir\df.bat" -ErrorAction SilentlyContinue
}
if ($dfCmd) {
    Write-Host ""
    Write-Host "df-cli is installed! Run 'df --version' or 'df-cli --version' to verify." -ForegroundColor Green
    Write-Host ""
    Write-Host "  Version command output:" -ForegroundColor DarkGray
    & df --version 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
} else {
    Write-Warning "Could not auto-detect df on PATH. You may need to restart your terminal."
}

Write-Host ""
Write-Host "Done." -ForegroundColor Cyan
