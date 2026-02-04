# install.ps1 - ASH (Awesome Skills Hub) Windows Native Installer
# This script sets up ASH on Windows by adding it to the environment path and setting up an alias.

Write-Host "🚀 开始安装 Awesome Skills Hub (ASH)..." -ForegroundColor Cyan

$CurrentDir = Get-Location
$BinDir = Join-Path $CurrentDir "bin"
$AshScript = Join-Path $BinDir "ash.ps1"

if (-not (Test-Path $AshScript)) {
    Write-Host "❌ 错误: 未能在 $BinDir 找到 ash.ps1。请在项目根目录下运行此脚本。" -ForegroundColor Red
    exit 1
}

# 1. 尝试将 bin 目录添加到系统 PATH (用户级别)
Write-Host "📦 正在配置系统环境变量..." -ForegroundColor Yellow
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$BinDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$UserPath;$BinDir", "User")
    Write-Host "✅ 已将 $BinDir 添加到用户 PATH。" -ForegroundColor Green
} else {
    Write-Host "ℹ️ $BinDir 已在 PATH 中。" -ForegroundColor Gray
}

# 2. 尝试在 PowerShell Profile 中添加别名
Write-Host "🐚 正在配置 PowerShell 别名..." -ForegroundColor Yellow
if (-not (Test-Path $PROFILE)) {
    New-Item -Path $PROFILE -Type File -Force | Out-Null
    Write-Host "✅ 已创建 PowerShell 配置文件: $PROFILE" -ForegroundColor Gray
}

$AliasCode = @"

# Awesome Skills Hub (ASH) Alias
function ash { powershell -ExecutionPolicy Bypass -File "$AshScript" `$args }
"@

$ProfileContent = Get-Content $PROFILE -Raw
if ($ProfileContent -notlike "*function ash {*") {
    Add-Content -Path $PROFILE -Value $AliasCode
    Write-Host "✅ 已在 `$PROFILE 中添加 ash 别名。" -ForegroundColor Green
} else {
    Write-Host "ℹ️ `$PROFILE 中已存在 ash 配置。" -ForegroundColor Gray
}

# 3. 初始化环境与同步技能
Write-Host "📂 正在同步/初始化全局技能主目录 (~/.ash)..." -ForegroundColor Yellow
$AshHome = Join-Path $env:USERPROFILE ".ash"
$GlobalSkills = Join-Path $AshHome "skills"
if (-not (Test-Path $GlobalSkills)) { New-Item -Path $GlobalSkills -ItemType Directory -Force | Out-Null }
Copy-Item -Path "$(Join-Path $CurrentDir "skills")\*" -Destination $GlobalSkills -Recurse -Force

powershell -ExecutionPolicy Bypass -File "$AshScript" init

Write-Host "`n🎉 恭喜！ASH 已安装成功。" -ForegroundColor Green
Write-Host "请重启您的 PowerShell 或运行 '. `$PROFILE' 以使更改生效。" -ForegroundColor Cyan
Write-Host "现在您可以直接输入 'ash' 来管理您的 AI 技能了！" -ForegroundColor Cyan
