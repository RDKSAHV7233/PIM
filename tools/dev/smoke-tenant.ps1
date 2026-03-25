$ErrorActionPreference = "Stop"

function Set-DefaultEnvVar {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$Value
  )

  $current = [System.Environment]::GetEnvironmentVariable($Name, "Process")
  if ([string]::IsNullOrWhiteSpace($current)) {
    [System.Environment]::SetEnvironmentVariable($Name, $Value, "Process")
  }
}

function Set-SmokeRequiredEnvDefaults {
  param(
    [string]$TenantDatabaseUrl
  )

  if (-not [string]::IsNullOrWhiteSpace($TenantDatabaseUrl)) {
    Set-DefaultEnvVar -Name "DATABASE_URL_POOLED" -Value $TenantDatabaseUrl
    Set-DefaultEnvVar -Name "DATABASE_URL_DIRECT" -Value $TenantDatabaseUrl
  }

  Set-DefaultEnvVar -Name "JWT_SECRET" -Value "tej-pim-local-dev-jwt-secret-minimum-length-32"
  Set-DefaultEnvVar -Name "JWT_EXPIRY" -Value "4h"
  Set-DefaultEnvVar -Name "CREDENTIAL_ENCRYPTION_KEY_V1" -Value "tej-pim-local-encryption-key-v1-minimum-32"
  Set-DefaultEnvVar -Name "CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION" -Value "1"
  Set-DefaultEnvVar -Name "REDIS_URL" -Value "redis://localhost:6379"
  Set-DefaultEnvVar -Name "JWT_BLOCKLIST_REDIS_DISABLED" -Value "true"
  Set-DefaultEnvVar -Name "R2_ACCOUNT_ID" -Value "local-dev"
  Set-DefaultEnvVar -Name "R2_ACCESS_KEY_ID" -Value "local-dev"
  Set-DefaultEnvVar -Name "R2_SECRET_ACCESS_KEY" -Value "local-dev"
  Set-DefaultEnvVar -Name "R2_BUCKET_NAME" -Value "tej-pim-local"
  Set-DefaultEnvVar -Name "R2_PUBLIC_URL" -Value "https://example.com/tej-pim-local"
  Set-DefaultEnvVar -Name "APP_ENV" -Value "development"
  Set-DefaultEnvVar -Name "FEATURE_REAL_SPAPI_VALIDATION" -Value "false"
}

function Set-SmokeTenantDatabaseUrl {
  param(
    [string]$TenantKey = $env:PIM_SMOKE_TENANT_KEY
  )

  $databaseUrl = [System.Environment]::GetEnvironmentVariable("DATABASE_URL", "Process")
  if ([string]::IsNullOrWhiteSpace($databaseUrl)) {
    Set-SmokeRequiredEnvDefaults -TenantDatabaseUrl ""
    return
  }

  $effectiveTenantKey = if ([string]::IsNullOrWhiteSpace($TenantKey)) {
    $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $suffix = Get-Random -Minimum 1000 -Maximum 9999
    "smoke-tenant-$timestamp-$suffix"
  } else {
    $TenantKey.Trim()
  }

  $optionValue = [System.Uri]::EscapeDataString("-c app.tenant_key=$effectiveTenantKey")
  $withTenant = if ($databaseUrl -match "(^|[?&])options=") {
    [System.Text.RegularExpressions.Regex]::Replace(
      $databaseUrl,
      "([?&])options=[^&]*",
      ('$1options=' + $optionValue),
      1
    )
  } elseif ($databaseUrl.Contains("?")) {
    "$databaseUrl&options=$optionValue"
  } else {
    "$databaseUrl?options=$optionValue"
  }

  [System.Environment]::SetEnvironmentVariable("DATABASE_URL", $withTenant, "Process")
  [System.Environment]::SetEnvironmentVariable("PIM_SMOKE_TENANT_KEY", $effectiveTenantKey, "Process")
  [System.Environment]::SetEnvironmentVariable("PIM_DEFAULT_TENANT_KEY", $effectiveTenantKey, "Process")
  [System.Environment]::SetEnvironmentVariable("PIM_DEFAULT_ROLE", "admin", "Process")
  [System.Environment]::SetEnvironmentVariable(
    "PIM_AUTH_IDENTITIES_JSON",
    (@{
        "smoke-admin" = @{
          tenantId = $effectiveTenantKey
          role = "admin"
        }
        "smoke-editor" = @{
          tenantId = $effectiveTenantKey
          role = "editor"
        }
        "smoke-viewer" = @{
          tenantId = $effectiveTenantKey
          role = "viewer"
        }
      } | ConvertTo-Json -Compress),
    "Process"
  )
  Set-SmokeRequiredEnvDefaults -TenantDatabaseUrl $withTenant
}
