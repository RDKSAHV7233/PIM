param(
  [string]$StackName = "pim1-media-baseline",
  [string]$Region = "ap-south-1",
  [string]$MediaBucketName = "",
  [string]$PriceClass = "PriceClass_100"
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$templatePath = Join-Path $repoRoot "deploy\aws\media-baseline.yaml"

if (-not (Test-Path $templatePath)) {
  throw "Template not found at $templatePath"
}

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
  throw "AWS CLI is not installed. Install AWS CLI v2 and retry."
}

$identityJson = aws sts get-caller-identity --output json 2>$null
if (-not $identityJson) {
  throw "Unable to resolve AWS caller identity. Configure AWS credentials and retry."
}
$identity = $identityJson | ConvertFrom-Json
$accountId = [string]$identity.Account
if ([string]::IsNullOrWhiteSpace($accountId)) {
  throw "Failed to resolve AWS account id from sts get-caller-identity."
}

$effectiveBucketName = $MediaBucketName.Trim()
if ([string]::IsNullOrWhiteSpace($effectiveBucketName)) {
  $suffix = Get-Random -Minimum 1000 -Maximum 9999
  $effectiveBucketName = "pim1-media-$($accountId)-$suffix"
}

Write-Host "Provisioning media baseline stack..."
Write-Host "  Stack:  $StackName"
Write-Host "  Region: $Region"
Write-Host "  Bucket: $effectiveBucketName"

aws cloudformation deploy `
  --region $Region `
  --stack-name $StackName `
  --template-file $templatePath `
  --capabilities CAPABILITY_NAMED_IAM `
  --parameter-overrides `
    "MediaBucketName=$effectiveBucketName" `
    "CloudFrontPriceClass=$PriceClass" `
    "EnableVersioning=Enabled"

$outputsJson = aws cloudformation describe-stacks `
  --region $Region `
  --stack-name $StackName `
  --query "Stacks[0].Outputs" `
  --output json

$outputs = @{}
($outputsJson | ConvertFrom-Json) | ForEach-Object {
  $outputs[$_.OutputKey] = $_.OutputValue
}

$result = [PSCustomObject]@{
  stackName = $StackName
  region = $Region
  bucketName = $outputs.MediaBucketName
  bucketArn = $outputs.MediaBucketArn
  distributionId = $outputs.CloudFrontDistributionId
  distributionDomain = $outputs.CloudFrontDomainName
  mediaBaseUrl = $outputs.CloudFrontMediaBaseUrl
  envHints = [PSCustomObject]@{
    AWS_REGION = $Region
    AWS_S3_MEDIA_BUCKET = $outputs.MediaBucketName
    AWS_CLOUDFRONT_DISTRIBUTION_ID = $outputs.CloudFrontDistributionId
    R2_PUBLIC_URL = $outputs.CloudFrontMediaBaseUrl
  }
  checkedAt = (Get-Date).ToString("s")
}

$result | ConvertTo-Json -Depth 6
