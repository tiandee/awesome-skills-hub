# ASH compatibility launcher. All business logic lives in the shared Node CLI.
$Node = Get-Command node -ErrorAction SilentlyContinue
if (-not $Node) {
    Write-Error "ASH requires Node.js 12 or newer."
    exit 2
}

$Wrapper = Join-Path $PSScriptRoot "ash-wrapper.js"
& $Node.Source $Wrapper @args
exit $LASTEXITCODE
