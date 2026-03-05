$ErrorActionPreference='Stop'
Set-Location 'C:\Users\Om Computers\PIM1'
if (Test-Path '.env') { Get-Content '.env' | % { if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }; $p=$_.Split('=',2); if($p.Length -eq 2){ [Environment]::SetEnvironmentVariable($p[0].Trim(),$p[1].Trim().Trim('"'),'Process')}} }
$env:DATABASE_URL_POOLED = $env:DATABASE_URL
$env:DATABASE_URL_DIRECT = $env:DATABASE_URL
$env:JWT_SECRET='pim1-local-dev-jwt-secret-minimum-length-32'
$env:JWT_EXPIRY='4h'
$env:CREDENTIAL_ENCRYPTION_KEY_V1='pim1-local-encryption-key-v1-minimum-32'
$env:CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION='1'
$env:REDIS_URL='redis://localhost:6379'
$env:JWT_BLOCKLIST_REDIS_DISABLED='true'
$env:R2_ACCOUNT_ID='local';$env:R2_ACCESS_KEY_ID='local';$env:R2_SECRET_ACCESS_KEY='local';$env:R2_BUCKET_NAME='local';$env:R2_PUBLIC_URL='https://example.com'
$env:APP_ENV='development';$env:FEATURE_REAL_SPAPI_VALIDATION='false';$env:PIM_ALLOW_LEGACY_HEADERS='false'
$port=4889; $env:PORT=[string]$port
$out='debug-out.log'; $err='debug-err.log'; if(Test-Path $out){Remove-Item $out -Force}; if(Test-Path $err){Remove-Item $err -Force}
$p=Start-Process node -ArgumentList 'apps/api/dist/main.js' -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
Start-Sleep -Seconds 4
try {
$base="http://127.0.0.1:$port/api/v1"
$l=Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType 'application/json' -Body (@{userId='u1';tenantId='ta';role='admin';expiresInMinutes=30}|ConvertTo-Json)
$h=@{Authorization="Bearer $($l.accessToken)"}
try { Invoke-RestMethod -Uri "$base/taxonomy/categories" -Method Post -Headers $h -ContentType 'application/json' -Body (@{name='Dbg Cat '+[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()}|ConvertTo-Json) | ConvertTo-Json -Compress | Write-Output } catch { $_.Exception.Message | Write-Output }
Start-Sleep -Seconds 1
'---OUT---' | Write-Output
Get-Content $out -Tail 120 | Write-Output
'---ERR---' | Write-Output
Get-Content $err -Tail 120 | Write-Output
} finally { if(-not $p.HasExited){ Stop-Process -Id $p.Id -Force } }
