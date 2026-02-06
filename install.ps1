# install.ps1 - ASH (Awesome Skills Hub) Windows Native Installer
# This script sets up ASH on Windows by adding it to the environment path and setting up an alias.

# --- Encoding Setup ---
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null

# 0. Detect install mode (local vs remote)
$ScriptPath = $PSScriptRoot
if (-not (Test-Path -Path "$ScriptPath\bin\ash.ps1")) {
    Write-Host "[*] No local files detected, entering remote install mode..." -ForegroundColor Cyan

    $AshAppDir = Join-Path ([Environment]::GetFolderPath("UserProfile")) ".ash\app"

    if (Test-Path -Path $AshAppDir) {
        Write-Host "[*] Cleaning old version..." -ForegroundColor Gray
        Remove-Item -Path $AshAppDir -Recurse -Force
    }

    Write-Host "[*] Cloning repository to $AshAppDir ..." -ForegroundColor Cyan
    git clone https://github.com/tiandee/awesome-skills-hub.git $AshAppDir

    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERR] Clone failed. Please check Git and network." -ForegroundColor Red
        Write-Host ""
        Write-Host "Press Enter to exit..." -ForegroundColor Yellow
        Read-Host
        exit 1
    }

    Write-Host "[*] Handing off to local installer..." -ForegroundColor Green
    & "$AshAppDir\install.ps1"
    exit
}

# ========================================================
# Local Install Flow
# ========================================================

Write-Host "[*] Installing Awesome Skills Hub (ASH)..." -ForegroundColor Cyan

$SkillsHubHome = $ScriptPath
$BinDir = Join-Path $SkillsHubHome "bin"
$AshScript = Join-Path $BinDir "ash.ps1"

if (-not (Test-Path $AshScript)) {
    Write-Host "[ERR] Cannot find ash.ps1 in $BinDir. Please run from project root." -ForegroundColor Red
    Write-Host ""
    Write-Host "Press Enter to exit..." -ForegroundColor Yellow
    Read-Host
    exit 1
}

# 1. Add bin directory to user PATH
Write-Host "[*] Configuring environment variables..." -ForegroundColor Yellow
try {
    $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($UserPath -notlike "*$BinDir*") {
        [Environment]::SetEnvironmentVariable("Path", "$UserPath;$BinDir", "User")
        Write-Host "[OK] Added $BinDir to user PATH." -ForegroundColor Green
    } else {
        Write-Host "[OK] $BinDir already in PATH." -ForegroundColor Gray
    }
} catch {
    Write-Host "[WARN] Failed to set PATH: $_" -ForegroundColor Yellow
}

# 2. Add ash alias to PowerShell Profile
Write-Host "[*] Configuring PowerShell alias..." -ForegroundColor Yellow
try {
    if (-not (Test-Path $PROFILE)) {
        $ProfileDir = Split-Path -Parent $PROFILE
        if (-not (Test-Path $ProfileDir)) {
            New-Item -Path $ProfileDir -ItemType Directory -Force | Out-Null
        }
        New-Item -Path $PROFILE -Type File -Force | Out-Null
        Write-Host "[OK] Created PowerShell profile: $PROFILE" -ForegroundColor Gray
    }

    $AliasCode = @"

# Awesome Skills Hub (ASH) Alias
function ash { powershell -ExecutionPolicy Bypass -File "$AshScript" `$args }
"@

    $ProfileContent = Get-Content $PROFILE -Raw -ErrorAction SilentlyContinue
    if (-not ($ProfileContent -match 'function ash')) {
        Add-Content -Path $PROFILE -Value $AliasCode -Encoding UTF8
        Write-Host "[OK] Added ash alias to `$PROFILE." -ForegroundColor Green
    } else {
        Write-Host "[OK] ash alias already exists in `$PROFILE." -ForegroundColor Gray
    }
} catch {
    Write-Host "[WARN] Failed to configure alias: $_" -ForegroundColor Yellow
}

# 3. Sync skills to global directory
Write-Host "[*] Syncing skills to ~/.ash ..." -ForegroundColor Yellow
$AshHome = Join-Path $env:USERPROFILE ".ash"
$GlobalSkills = Join-Path $AshHome "skills"
if (-not (Test-Path $GlobalSkills)) {
    New-Item -Path $GlobalSkills -ItemType Directory -Force | Out-Null
}

$LocalSkills = Join-Path $SkillsHubHome "skills"
if (Test-Path $LocalSkills) {
    Copy-Item -Path (Join-Path $LocalSkills "*") -Destination $GlobalSkills -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "[OK] Skills synced to global directory." -ForegroundColor Green
} else {
    Write-Host "[WARN] Local skills directory not found, skipping sync." -ForegroundColor Yellow
}

# 4. Initialize IDE environments
Write-Host "[*] Initializing IDE environments..." -ForegroundColor Yellow
try {
    powershell -ExecutionPolicy Bypass -File "$AshScript" init
} catch {
    Write-Host "[WARN] IDE init failed: $_" -ForegroundColor Yellow
}

# Done
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " ASH installed successfully!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Restart PowerShell or run:  . `$PROFILE" -ForegroundColor White
Write-Host "  2. Then use 'ash' commands!" -ForegroundColor White
Write-Host ""
Write-Host "Quick start:" -ForegroundColor Yellow
Write-Host "  ash list           - View all available skills" -ForegroundColor White
Write-Host "  ash install --all  - Install all skills" -ForegroundColor White
Write-Host "  ash help           - Show help" -ForegroundColor White
Write-Host ""
Write-Host "Press Enter to exit..." -ForegroundColor Gray
Read-Host
