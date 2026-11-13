# Creates an isolated SmileCare test environment under .tmp/test-env (gitignored).
# Does not touch the clinic production SQLite file.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envDir = Join-Path $root '.tmp\test-env'
$dataDir = Join-Path $envDir 'data'
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

$secret = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 40 | ForEach-Object { [char]$_ })
$platformKey = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })

@(
  'NODE_ENV=test'
  'PORT=3011'
  "SESSION_SECRET=$secret"
  'CLIENT_ORIGIN=http://localhost:5173'
  "DATABASE_PATH=$($dataDir -replace '\\','/')/smilecare-test.db"
  'TRUST_PROXY=0'
  'LOG_LEVEL=silent'
  "PLATFORM_SETUP_KEY=$platformKey"
) | Set-Content -Path (Join-Path $envDir '.env') -Encoding utf8

Write-Host "Test environment ready: $envDir"
Write-Host "Run checks with: npm run verify"
