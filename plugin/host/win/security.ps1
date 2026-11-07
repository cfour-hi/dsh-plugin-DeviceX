# Device X - Windows security posture (BitLocker, Secure Boot, Defender, firewall, UAC).
#
# Emits exactly one JSON document on stdout (no other stdout text).
# Read-only. Some sources (BitLocker, Secure Boot) can require elevation; a
# denied read is reported as null + a non-fatal errors[] entry, never faked.
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

# --------------------------------------------------------------- BitLocker --
$fileVault = [ordered]@{ enabled = $null; raw = $null }
$systemDrive = $env:SystemDrive
if (-not $systemDrive) { $systemDrive = 'C:' }
try {
  $bitLockerVolume = Get-BitLockerVolume -MountPoint $systemDrive -ErrorAction Stop
  $protectionEnabled = $null
  if ($null -ne $bitLockerVolume.ProtectionStatus) {
    $protectionValue = [int]$bitLockerVolume.ProtectionStatus
    if ($protectionValue -eq 1) { $protectionEnabled = $true }
    elseif ($protectionValue -eq 0) { $protectionEnabled = $false }
  }
  $volumeStatus = [string]$bitLockerVolume.VolumeStatus
  $rawText = 'ProtectionStatus=' + [string]$bitLockerVolume.ProtectionStatus
  if ($volumeStatus) { $rawText = $rawText + '; VolumeStatus=' + $volumeStatus }
  $fileVault = [ordered]@{ enabled = $protectionEnabled; raw = $rawText; volumeStatus = $volumeStatus }
} catch {
  $bitLockerError = $_.Exception.Message
  try {
    $manageBdeLines = @(Invoke-NativeOem { & manage-bde.exe -status $systemDrive 2>$null })
    $manageBdeText = ($manageBdeLines -join "`n")
    $manageBdeEnabled = $null
    if ($manageBdeText -match 'Protection On') { $manageBdeEnabled = $true }
    elseif ($manageBdeText -match 'Protection Off') { $manageBdeEnabled = $false }
    $rawLine = $null
    foreach ($line in $manageBdeLines) {
      if ([string]$line -match 'Protection Status') { $rawLine = ([string]$line).Trim(); break }
    }
    if ($rawLine) {
      if ($rawLine -match 'Protection On') { $manageBdeEnabled = $true }
      elseif ($rawLine -match 'Protection Off') { $manageBdeEnabled = $false }
    }
    $fileVault = [ordered]@{ enabled = $manageBdeEnabled; raw = $manageBdeText; volumeStatus = $null }
    $errors += ('Get-BitLockerVolume: ' + $bitLockerError)
  } catch {
    $errors += ('BitLocker: ' + $bitLockerError)
    $fileVault = [ordered]@{ enabled = $null; raw = $bitLockerError; volumeStatus = $null }
  }
}

# -------------------------------------------------------------- Secure Boot --
$sip = [ordered]@{ enabled = $null; raw = $null }
try {
  $secureBootEnabled = Confirm-SecureBootUEFI -ErrorAction Stop
  $sip = [ordered]@{ enabled = [bool]$secureBootEnabled; raw = 'Secure Boot: ' + [string]$secureBootEnabled }
} catch {
  $sip = [ordered]@{ enabled = $null; raw = $_.Exception.Message }
  $errors += ('Secure Boot: ' + $_.Exception.Message)
}

# ----------------------------------------------------------------- Defender --
$gatekeeper = [ordered]@{ enabled = $null; raw = $null }
try {
  $defenderStatus = Get-MpComputerStatus -ErrorAction Stop
  $realTimeEnabled = $null
  if ($null -ne $defenderStatus.RealTimeProtectionEnabled) {
    $realTimeEnabled = [bool]$defenderStatus.RealTimeProtectionEnabled
  }
  $rawText = 'RealTimeProtectionEnabled=' + [string]$defenderStatus.RealTimeProtectionEnabled
  if ($null -ne $defenderStatus.AntivirusEnabled) { $rawText = $rawText + '; AntivirusEnabled=' + [string]$defenderStatus.AntivirusEnabled }
  if ($defenderStatus.AntivirusSignatureVersion) { $rawText = $rawText + '; SignatureVersion=' + [string]$defenderStatus.AntivirusSignatureVersion }
  $gatekeeper = [ordered]@{ enabled = $realTimeEnabled; raw = $rawText }
} catch {
  $gatekeeper = [ordered]@{ enabled = $null; raw = $_.Exception.Message }
  $errors += ('Get-MpComputerStatus: ' + $_.Exception.Message)
}

# ---------------------------------------------------------------- Firewall --
$firewall = [ordered]@{ enabled = $null; raw = $null; stealthMode = $null }
try {
  $profiles = @(Get-NetFirewallProfile -ErrorAction Stop)
  $allEnabled = $null
  $parts = @()
  if ($profiles.Count -gt 0) {
    $allEnabled = $true
    foreach ($profile in $profiles) {
      $profileEnabled = [bool]$profile.Enabled
      if (-not $profileEnabled) { $allEnabled = $false }
      $parts += ([string]$profile.Name + '=' + [string]$profile.Enabled)
    }
  }
  $firewall = [ordered]@{
    enabled = $allEnabled
    raw = ($parts -join ', ')
    stealthMode = $null
  }
} catch {
  $firewall = [ordered]@{ enabled = $null; raw = $_.Exception.Message; stealthMode = $null }
  $errors += ('Get-NetFirewallProfile: ' + $_.Exception.Message)
}

# ------------------------------------------------------------------- users --
$userInfo = [ordered]@{ current = $env:USERNAME; admins = @(); total = $null }
try {
  $localUsers = @(Get-LocalUser -ErrorAction Stop)
  $userInfo.total = $localUsers.Count
} catch {
  try {
    $fallbackUsers = @(Get-CimInstance -ClassName Win32_UserAccount -Filter 'LocalAccount = True' -ErrorAction Stop)
    $userInfo.total = $fallbackUsers.Count
  } catch { $errors += ('local user count: ' + $_.Exception.Message) }
}
try {
  $adminGroup = $null
  try { $adminGroup = Get-LocalGroup -SID 'S-1-5-32-544' -ErrorAction Stop } catch { $adminGroup = $null }
  if ($null -eq $adminGroup) {
    # The group display name is localized; resolve it by the well-known
    # Administrators SID instead of the English name.
    $adminGroup = Get-LocalGroup -ErrorAction Stop | Where-Object { $_.SID.Value -eq 'S-1-5-32-544' } | Select-Object -First 1
  }
  if ($null -eq $adminGroup) { throw 'Could not resolve the local Administrators group (S-1-5-32-544).' }
  $members = @(Get-LocalGroupMember -Group $adminGroup -ErrorAction Stop)
  $admins = @()
  foreach ($member in $members) {
    $memberName = [string]$member.Name
    if ($memberName -match '\\') {
      $parts = $memberName -split '\\'
      $memberName = [string]$parts[$parts.Count - 1]
    }
    if ($memberName) { $admins += $memberName }
  }
  $userInfo.admins = $admins
} catch { $errors += ('local administrators: ' + $_.Exception.Message) }

# ------------------------------------------------------------ remote logon --
$remoteLogin = $null
try {
  $terminalServer = Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server' -Name 'fDenyTSConnections' -ErrorAction Stop
  if ($null -ne $terminalServer.fDenyTSConnections) {
    $remoteLogin = ([int]$terminalServer.fDenyTSConnections -eq 0)
  }
} catch { $errors += ('Remote Desktop setting: ' + $_.Exception.Message) }

# -------------------------------------------------------------- auto logon --
$autoLogin = $null
try {
  $winlogon = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -ErrorAction Stop
  $autoAdminLogon = [string]$winlogon.AutoAdminLogon
  $defaultUserName = [string]$winlogon.DefaultUserName
  if ($autoAdminLogon -eq '1' -and $defaultUserName) { $autoLogin = $defaultUserName }
} catch { $errors += ('Winlogon auto logon: ' + $_.Exception.Message) }

# UAC (collected for diagnostics; the frozen section shape has no UAC field yet).
$uac = [ordered]@{ enabled = $null; consentPromptBehaviorAdmin = $null; raw = $null }
try {
  $policies = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -ErrorAction Stop
  if ($null -ne $policies.EnableLUA) {
    $uac.enabled = ([int]$policies.EnableLUA -eq 1)
    $uac.raw = 'EnableLUA=' + [string]$policies.EnableLUA
  }
  if ($null -ne $policies.ConsentPromptBehaviorAdmin) {
    $uac.consentPromptBehaviorAdmin = [int]$policies.ConsentPromptBehaviorAdmin
    $uac.raw = ([string]$uac.raw + '; ConsentPromptBehaviorAdmin=' + [string]$policies.ConsentPromptBehaviorAdmin)
  }
} catch { $errors += ('UAC setting: ' + $_.Exception.Message) }

# -------------------------------------------------------------------- emit --
$result = [ordered]@{
  generatedAt = ([DateTimeOffset]::UtcNow).ToUnixTimeMilliseconds()
  fileVault = $fileVault
  sip = $sip
  gatekeeper = $gatekeeper
  firewall = $firewall
  users = $userInfo
  remoteLogin = $remoteLogin
  autoLogin = $autoLogin
  uac = $uac
  errors = $errors
}

$result | ConvertTo-Json -Depth 8 -Compress
