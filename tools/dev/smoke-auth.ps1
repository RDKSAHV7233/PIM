$ErrorActionPreference = "Stop"

function Get-SmokeAuthHeaders {
  param(
    [Parameter(Mandatory = $true)]
    [string]$BaseApiUrl,
    [string]$TenantId = $env:PIM_SMOKE_TENANT_KEY,
    [string]$UserId = "smoke-admin",
    [string]$Role = "admin",
    [string]$Password = $env:PIM_AUTH_PASSWORD,
    [int]$ExpiresInMinutes = 30
  )

  $effectiveTenant = if ([string]::IsNullOrWhiteSpace($TenantId)) {
    "smoke-tenant"
  } else {
    $TenantId.Trim()
  }

  $effectivePassword = if ([string]::IsNullOrWhiteSpace($Password)) {
    "pim1-demo-password"
  } else {
    $Password
  }

  # Server-owned identity mapping for smoke user.
  [System.Environment]::SetEnvironmentVariable(
    "PIM_AUTH_IDENTITIES_JSON",
    (@{
        $UserId = @{
          tenantId = $effectiveTenant
          role = $Role
        }
      } | ConvertTo-Json -Compress),
    "Process"
  )

  $loginBody = @{
    userId = $UserId
    password = $effectivePassword
    expiresInMinutes = $ExpiresInMinutes
  } | ConvertTo-Json

  $login = Invoke-RestMethod -Uri "$($BaseApiUrl.TrimEnd('/'))/auth/login" -Method Post -ContentType "application/json" -Body $loginBody
  if ($null -eq $login.accessToken -or [string]::IsNullOrWhiteSpace([string]$login.accessToken)) {
    throw "Smoke auth login did not return accessToken."
  }

  return @{
    Authorization = "Bearer $($login.accessToken)"
  }
}

function Enable-SmokeAuthDefaults {
  param(
    [Parameter(Mandatory = $true)]
    [string]$BaseApiUrl
  )
  $headers = Get-SmokeAuthHeaders -BaseApiUrl $BaseApiUrl
  $PSDefaultParameterValues["Invoke-RestMethod:Headers"] = $headers
}

function Disable-SmokeAuthDefaults {
  if ($PSDefaultParameterValues.ContainsKey("Invoke-RestMethod:Headers")) {
    $PSDefaultParameterValues.Remove("Invoke-RestMethod:Headers") | Out-Null
  }
}
