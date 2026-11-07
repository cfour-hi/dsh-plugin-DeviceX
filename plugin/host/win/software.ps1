# Device X - Windows installed-software inventory (registry Uninstall keys).
#
# Emits exactly one JSON document on stdout (no other stdout text).
# Read-only: no admin rights, no network calls, no external modules.
# `winget --version` only runs when the executable is present (no install, no
# source agreement prompt) and never touches the network.
$ErrorActionPreference = 'Stop'

$errors = @()

function Invoke-NativeOem([scriptblock]$action) {
  # Native console tools (netsh/tasklist/manage-bde/winget) write OEM/ANSI bytes
  # on a non-English Windows. The bridge sets the console to UTF-8 for the JSON
  # document; temporarily decode native output with the OEM code page so SSIDs,
  # user names and device names are not mojibake, then restore in finally.
  $originalEncoding = [Console]::OutputEncoding
  $oemCodePage = 437
  try {
    $cultureCodePage = [System.Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage
    if ($cultureCodePage -gt 0) { $oemCodePage = $cultureCodePage }
    [Console]::OutputEncoding = [System.Text.Encoding]::GetEncoding($oemCodePage)
    return & $action
  } finally {
    [Console]::OutputEncoding = $originalEncoding
  }
}

$uninstallRoots = @(
  [pscustomobject]@{ hive = 'HKLM'; path = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall'; arch = 'x64' },
  [pscustomobject]@{ hive = 'HKLM'; path = 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'; arch = 'x86' },
  [pscustomobject]@{ hive = 'HKCU'; path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'; arch = 'x64' }
)

$applications = @()
foreach ($root in $uninstallRoots) {
  try {
    $uninstallKeys = @(Get-ChildItem -Path $root.path -ErrorAction Stop)
  } catch {
    $message = $_.Exception.Message
    if ($message -notmatch 'Cannot find path' -and $message -notmatch 'does not exist') {
      $errors += ('registry ' + $root.path + ': ' + $message)
    }
    continue
  }
  $relativeRoot = $root.path -replace '^(HKLM|HKCU):\\', ''
  foreach ($uninstallKey in $uninstallKeys) {
    $keyName = [string]$uninstallKey.PSChildName
    $keyPath = $relativeRoot + '\' + $keyName
    $properties = $null
    try {
      $properties = Get-ItemProperty -Path $uninstallKey.PSPath -ErrorAction Stop
    } catch {
      continue
    }
    if ($null -eq $properties) { continue }
    $displayName = [string]$properties.DisplayName
    if (-not $displayName.Trim()) { continue }
    if ($null -ne $properties.SystemComponent -and [int]$properties.SystemComponent -eq 1) { continue }
    if ($null -ne $properties.ParentKeyName -and [string]$properties.ParentKeyName) { continue }
    $estimatedSizeKb = $null
    if ($null -ne $properties.EstimatedSize) {
      try { $estimatedSizeKb = [long]$properties.EstimatedSize } catch { $estimatedSizeKb = $null }
    }
    $applications += [ordered]@{
      displayName = $displayName.Trim()
      version = [string]$properties.DisplayVersion
      publisher = [string]$properties.Publisher
      installLocation = [string]$properties.InstallLocation
      estimatedSizeKB = $estimatedSizeKb
      keyName = $keyName
      keyPath = $keyPath
      hive = $root.hive
      arch = $root.arch
      uninstallString = [string]$properties.UninstallString
      quietUninstallString = [string]$properties.QuietUninstallString
    }
  }
}

# ---------------------------------------------------------- winget presence --
$winget = [ordered]@{ available = $false; version = $null }
$wingetExe = $null
try {
  $resolved = Get-Command -Name 'winget.exe' -CommandType Application -ErrorAction SilentlyContinue
  if ($null -ne $resolved) { $wingetExe = [string]$resolved.Source }
} catch { $wingetExe = $null }
if (-not $wingetExe) {
  try {
    $resolved = Get-Command -Name 'winget' -CommandType Application -ErrorAction SilentlyContinue
    if ($null -ne $resolved) { $wingetExe = [string]$resolved.Source }
  } catch { $wingetExe = $null }
}
if ($wingetExe) {
  try {
    $versionLines = @(Invoke-NativeOem { & $wingetExe --version 2>$null })
    $versionText = $null
    foreach ($line in $versionLines) {
      $text = [string]$line
      if ($text.Trim()) {
        if ($text -match '(\d+\.\d+[0-9A-Za-z.\-]*)') { $versionText = $matches[1]; break }
      }
    }
    $winget.available = $true
    if ($versionText) { $winget.version = $versionText }
  } catch {
    $winget.available = $true
    $errors += ('winget --version: ' + $_.Exception.Message)
  }
}

# -------------------------------------------------------------------- emit --
$result = [ordered]@{
  generatedAt = ([DateTimeOffset]::UtcNow).ToUnixTimeMilliseconds()
  applications = $applications
  winget = $winget
  errors = $errors
}

$result | ConvertTo-Json -Depth 8 -Compress
