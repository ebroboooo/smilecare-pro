# Full commercial gate: typecheck, lint, unit/API tests, production build.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host '== setup test env =='
powershell -NoProfile -File (Join-Path $PSScriptRoot 'setup-test-env.ps1')

Write-Host '== typecheck =='
npm run typecheck
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host '== lint =='
npm run lint
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host '== test =='
npm test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host '== build =='
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host 'VERIFY OK — typecheck, lint, test, build all passed.'
