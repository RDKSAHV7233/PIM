<#
.SYNOPSIS
  Patches the Windows hosts file so that browsers (Chrome, Edge, Firefox) can
  resolve Railway public domain names that may not resolve via the default OS
  DNS on some Windows local dev machines.

.DESCRIPTION
  The staging scripts (scripts/staging-fetch-via-curl.cjs) already work around
  this DNS gap by routing Node.js fetch calls through curl with an explicit
  --resolve flag.  However, that shim only covers Node.js processes.  Browsers
  use the OS resolver and are therefore blocked when the Railway domain is not
  reachable via the default DNS.

  This script adds (or removes) one hosts-file entry per discovered Railway
  hostname so that the browser resolves them to the correct IP without any
  extra configuration.

  Run once per machine whenever the staging hostname or IP changes.
  Requires an elevated (Administrator) PowerShell session.

.PARAMETER Domains
  One or more Railway hostnames to pin, e.g.
    "pim1api-staging.up.railway.app","pim1web-staging.up.railway.app"
  If omitted, the script attempts to parse hostnames from the STAGING_BASE_URL
  and STAGING_WEB_URL environment variables (or the .env file in the repo root).

.PARAMETER Ip
  The IP address to map the domains to.
  Defaults to the value of the STAGING_RESOLVE_IP environment variable, then
  falls back to the same default used by staging-fetch-via-curl.cjs (66.33.22.1).

.PARAMETER Remove
  When specified, existing hosts-file entries written by this script are
  removed rather than added.

.EXAMPLE
  # Add entries for staging domains (run as Administrator):
  tools\dev\patch-browser-dns.ps1 `
    -Domains "pim1api-staging.up.railway.app","pim1web-staging.up.railway.app" `
    -Ip "66.33.22.1"

.EXAMPLE
  # Let the script discover hostnames from STAGING_BASE_URL / STAGING_WEB_URL:
  $env:STAGING_BASE_URL = "https://pim1api-staging.up.railway.app/api/v1"
  $env:STAGING_WEB_URL  = "https://pim1web-staging.up.railway.app"
  $env:STAGING_RESOLVE_IP = "66.33.22.1"
  tools\dev\patch-browser-dns.ps1

.EXAMPLE
  # Remove previously added entries:
  tools\dev\patch-browser-dns.ps1 -Remove
#>

[CmdletBinding(SupportsShouldProcess)]
param(
  [string[]]$Domains = @(),
  [string]$Ip = "",
  [switch]$Remove
)

$ErrorActionPreference = "Stop"

# ── Helpers ──────────────────────────────────────────────────────────────────

function Test-IsAdmin {
  $identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal] $identity
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Read-EnvFile {
  param([string]$Path)
  $vars = @{}
  if (-not (Test-Path $Path)) { return $vars }
  foreach ($line in (Get-Content $Path)) {
    if ($line -match "^\s*#" -or $line -match "^\s*$") { continue }
    $idx = $line.IndexOf("=")
    if ($idx -lt 1) { continue }
    $key   = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1).Trim().Trim('"').Trim("'")
    $vars[$key] = $value
  }
  return $vars
}

function Get-HostnameFromUrl {
  param([string]$Url)
  if ([string]::IsNullOrWhiteSpace($Url)) { return $null }
  try {
    return ([uri]$Url.Trim()).Host
  } catch {
    return $null
  }
}

# ── Resolve repo root and load .env ──────────────────────────────────────────

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$envPath  = Join-Path $repoRoot ".env"
$fileVars = Read-EnvFile -Path $envPath

function Resolve-Var {
  param([string]$Name)
  $fromProcess = [System.Environment]::GetEnvironmentVariable($Name, "Process")
  if (-not [string]::IsNullOrWhiteSpace($fromProcess)) { return $fromProcess }
  if ($fileVars.ContainsKey($Name)) { return $fileVars[$Name] }
  return ""
}

# ── Resolve IP ───────────────────────────────────────────────────────────────

if ([string]::IsNullOrWhiteSpace($Ip)) {
  $Ip = Resolve-Var "STAGING_RESOLVE_IP"
}
if ([string]::IsNullOrWhiteSpace($Ip)) {
  # Same fallback as scripts/staging-fetch-via-curl.cjs
  $Ip = "66.33.22.1"
}

# ── Resolve domains ──────────────────────────────────────────────────────────

if ($Domains.Count -eq 0 -and -not $Remove) {
  $candidates = @(
    (Get-HostnameFromUrl (Resolve-Var "STAGING_BASE_URL")),
    (Get-HostnameFromUrl (Resolve-Var "STAGING_WEB_URL"))
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique

  if ($candidates.Count -eq 0) {
    Write-Error @"
No Railway domains could be discovered automatically.

Provide them explicitly:
  tools\dev\patch-browser-dns.ps1 -Domains "pim1-api.up.railway.app","pim1-web.up.railway.app"

Or set STAGING_BASE_URL and STAGING_WEB_URL in your environment or .env file before running.
"@
    exit 1
  }

  $Domains = $candidates
}

# ── Marker used to identify entries written by this script ───────────────────

$marker = "# pim1-browser-dns"

# ── Hosts file path ──────────────────────────────────────────────────────────

$hostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"

# ── Guard: must run as admin ──────────────────────────────────────────────────

if (-not (Test-IsAdmin)) {
  Write-Error @"
This script must be run as Administrator because it modifies:
  $hostsPath

Re-open PowerShell with 'Run as administrator' and try again.
"@
  exit 1
}

# ── Read existing hosts file ──────────────────────────────────────────────────

$existing = Get-Content -Path $hostsPath -Encoding UTF8 -ErrorAction SilentlyContinue
if ($null -eq $existing) { $existing = @() }

# ── Remove any lines previously written by this script ───────────────────────

$cleaned = $existing | Where-Object { $_ -notmatch [regex]::Escape($marker) }

if ($Remove) {
  if ($PSCmdlet.ShouldProcess($hostsPath, "Remove pim1-browser-dns entries")) {
    Set-Content -Path $hostsPath -Value $cleaned -Encoding UTF8
    Write-Host "Removed pim1-browser-dns entries from $hostsPath"
  }
  exit 0
}

# ── Build new entry lines ─────────────────────────────────────────────────────

$newLines = foreach ($domain in $Domains) {
  "$Ip`t$domain`t$marker"
}

# ── Append new entries ────────────────────────────────────────────────────────

$updated = $cleaned + $newLines

if ($PSCmdlet.ShouldProcess($hostsPath, "Add/update pim1-browser-dns entries")) {
  Set-Content -Path $hostsPath -Value $updated -Encoding UTF8

  Write-Host ""
  Write-Host "hosts file updated: $hostsPath"
  Write-Host ""
  Write-Host "Added entries:"
  foreach ($line in $newLines) {
    Write-Host "  $line"
  }
  Write-Host ""
  Write-Host "Chrome (and all browsers) will now resolve these domains to $Ip."
  Write-Host "Flush the DNS cache if entries are not picked up immediately:"
  Write-Host "  ipconfig /flushdns"
  Write-Host ""
  Write-Host "To remove these entries later:"
  Write-Host "  tools\dev\patch-browser-dns.ps1 -Remove"
}
