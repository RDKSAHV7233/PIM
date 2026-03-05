param(
  [Parameter(Mandatory = $true)]
  [string]$BucketName,
  [Parameter(Mandatory = $true)]
  [string]$CloudFrontDomain,
  [string]$Region = "ap-south-1",
  [int]$MaxAttempts = 12
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
  throw "AWS CLI is not installed. Install AWS CLI v2 and retry."
}

$key = "smoke/media-baseline-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds()).txt"
$bodyPath = Join-Path $env:TEMP "pim1-media-baseline-smoke.txt"
"pim1 media baseline smoke $(Get-Date -Format s)" | Set-Content -Path $bodyPath -NoNewline -Encoding ASCII

try {
  aws s3api put-object `
    --bucket $BucketName `
    --key $key `
    --body $bodyPath `
    --content-type "text/plain" `
    --region $Region | Out-Null

  $cdnUrl = "https://$CloudFrontDomain/$key"
  $success = $false
  $statusCode = 0

  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    try {
      $response = Invoke-WebRequest -Uri $cdnUrl -Method Head -TimeoutSec 8
      $statusCode = [int]$response.StatusCode
      if ($statusCode -ge 200 -and $statusCode -lt 300) {
        $success = $true
        break
      }
    } catch {
      if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
        $statusCode = [int]$_.Exception.Response.StatusCode
      } else {
        $statusCode = 0
      }
    }
    Start-Sleep -Seconds 5
  }

  $signedGetUrl = aws s3 presign "s3://$BucketName/$key" --expires-in 600 --region $Region
  $signedGetStatus = 0
  try {
    $signedResponse = Invoke-WebRequest -Uri $signedGetUrl.Trim() -Method Get -TimeoutSec 15
    $signedGetStatus = [int]$signedResponse.StatusCode
  } catch {
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $signedGetStatus = [int]$_.Exception.Response.StatusCode
    }
  }

  if (-not $success) {
    throw "CloudFront verification failed for $cdnUrl (last status: $statusCode)"
  }
  if ($signedGetStatus -lt 200 -or $signedGetStatus -ge 300) {
    throw "Signed S3 GET verification failed for key $key (status: $signedGetStatus)"
  }

  [PSCustomObject]@{
    bucketName = $BucketName
    cloudFrontDomain = $CloudFrontDomain
    cloudFrontUrl = $cdnUrl
    cloudFrontStatus = $statusCode
    signedGetStatus = $signedGetStatus
    validated = $true
    checkedAt = (Get-Date).ToString("s")
  } | ConvertTo-Json -Compress
} finally {
  if (Test-Path $bodyPath) {
    Remove-Item -Path $bodyPath -Force
  }
  if ($BucketName -and $key) {
    try {
      aws s3api delete-object --bucket $BucketName --key $key --region $Region | Out-Null
    } catch {
      Write-Warning "Cleanup failed for s3://$BucketName/$key"
    }
  }
}
