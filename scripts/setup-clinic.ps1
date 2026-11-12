$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
if (-not (Test-Path "server\.env")) {
  Copy-Item "server\.env.example" "server\.env"
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $secret = [Convert]::ToHexString($bytes).ToLower()
  (Get-Content "server\.env") -replace 'SESSION_SECRET=dev-only-change-me', "SESSION_SECRET=$secret" | Set-Content "server\.env"
  Write-Host "Wrote server\.env with a generated SESSION_SECRET."
} else {
  Write-Host "server\.env already exists and was left unchanged."
}
Write-Host "Next: npm install"
Write-Host "Then: npm run dev"
Write-Host "Open http://localhost:5173 and create the clinic owner."
