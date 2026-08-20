$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
$Node = Get-Command node -ErrorAction SilentlyContinue
$Npm = Get-Command npm -ErrorAction SilentlyContinue

if (-not $Node -or -not $Npm) {
    Write-Error "ASH requires Node.js and npm."
    exit 2
}

Write-Host "Installing ASH from $ProjectRoot ..."
& $Npm.Source install -g $ProjectRoot
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $Node.Source (Join-Path $ProjectRoot "bin\ash-wrapper.js") init
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "ASH installed. User Skills live only in $HOME/.agents/skills."
Write-Host "Run 'ash --help' to see the supported commands."
