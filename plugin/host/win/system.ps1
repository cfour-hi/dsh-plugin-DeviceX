# Device X - Windows system inventory (OS, device, users, startup, locale).
#
# Emits exactly one JSON document on stdout (no other stdout text).
# Read-only: no admin rights, no network calls, no external modules.
$ErrorActionPreference = 'Stop'

$errors = @()

function To-EpochMs($value) {
  if ($null -eq $value) { return $null }
  try { return ([DateTimeOffset]$value).ToUnixTimeMilliseconds() } catch { return $null }
}

function To-LongOrNull($value) {
  if ($null -eq $value) { return $null }
  try { return [long]$value } catch { return $null }
}

$hostName = $env:COMPUTERNAME
if (-not $hostName) {
  try { $hostName = [System.Net.Dns]::GetHostName() } catch { $hostName = $null }
}

# ---------------------------------------------------------------------- OS --
$osInfo = $null
$bootInfo = $null
try {
  $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
  $displayVersion = $null
  try {
    $winVersionKey = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction Stop
    if ($winVersionKey.DisplayVersion) { $displayVersion = [string]$winVersionKey.DisplayVersion }
  } catch { $displayVersion = $null }
  $bootTimeMs = To-EpochMs $os.LastBootUpTime
  $uptimeSec = $null
  if ($null -ne $bootTimeMs -and $bootTimeMs -gt 0) {
    $nowMs = ([DateTimeOffset]::UtcNow).ToUnixTimeMilliseconds()
    $uptimeSec = [long][math]::Floor(($nowMs - $bootTimeMs) / 1000)
  }
  $osInfo = [ordered]@{
    caption = [string]$os.Caption
    displayVersion = $displayVersion
    version = [string]$os.Version
    build = [string]$os.BuildNumber
    installDateMs = To-EpochMs $os.InstallDate
    lastBootUpTimeMs = $bootTimeMs
    osArchitecture = [string]$os.OSArchitecture
    processorArchitecture = $env:PROCESSOR_ARCHITECTURE
  }
  $bootInfo = [ordered]@{ bootTimeMs = $bootTimeMs; uptimeSec = $uptimeSec }
} catch { $errors += ('Win32_OperatingSystem: ' + $_.Exception.Message) }

# ------------------------------------------------------------ OS/device facts --
$processorName = $null
try {
  $processors = @(Get-CimInstance -ClassName Win32_Processor -ErrorAction Stop)
  if ($processors.Count -gt 0) { $processorName = [string]$processors[0].Name }
} catch { $processorName = $null }

$device = $null
try {
  $computerSystem = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop
  $bios = Get-CimInstance -ClassName Win32_BIOS -ErrorAction Stop
  $product = Get-CimInstance -ClassName Win32_ComputerSystemProduct -ErrorAction Stop
  $modelId = $null
  if ($computerSystem.SystemSKUNumber) { $modelId = [string]$computerSystem.SystemSKUNumber }
  elseif ($product.Version) { $modelId = [string]$product.Version }
  $device = [ordered]@{
    hostname = $hostName
    computerName = [string]$computerSystem.Name
    localHostname = $hostName
    manufacturer = [string]$computerSystem.Manufacturer
    model = [string]$computerSystem.Model
    modelId = $modelId
    chip = $processorName
    serial = [string]$bios.SerialNumber
    hardwareUuid = [string]$product.UUID
  }
} catch { $errors += ('Win32_ComputerSystem/BIOS: ' + $_.Exception.Message) }

# -------------------------------------------------------------------- users --
$profiles = @{}
try {
  $profileKeys = @(Get-ChildItem -Path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList' -ErrorAction Stop)
  foreach ($profileKey in $profileKeys) {
    $sid = [string]$profileKey.PSChildName
    try {
      $profileProperties = Get-ItemProperty -Path $profileKey.PSPath -Name 'ProfileImagePath' -ErrorAction Stop
      if ($profileProperties.ProfileImagePath) { $profiles[$sid] = [string]$profileProperties.ProfileImagePath }
    } catch { }
  }
} catch { $profiles = @{} }

$localUsers = @()
try {
  $accounts = @(Get-LocalUser -ErrorAction Stop)
  foreach ($account in $accounts) {
    $sid = $null
    if ($account.SID) { $sid = [string]$account.SID.Value }
    $homePath = $null
    if ($sid -and $profiles.ContainsKey($sid)) { $homePath = $profiles[$sid] }
    $localUsers += [ordered]@{
      name = [string]$account.Name
      fullName = [string]$account.FullName
      enabled = [bool]$account.Enabled
      sid = $sid
      home = $homePath
    }
  }
} catch {
  $errors += ('Get-LocalUser: ' + $_.Exception.Message)
  try {
    $fallbackAccounts = @(Get-CimInstance -ClassName Win32_UserAccount -Filter 'LocalAccount = True' -ErrorAction Stop)
    foreach ($account in $fallbackAccounts) {
      $sid = [string]$account.SID
      $homePath = $null
      if ($sid -and $profiles.ContainsKey($sid)) { $homePath = $profiles[$sid] }
      $localUsers += [ordered]@{
        name = [string]$account.Name
        fullName = [string]$account.FullName
        enabled = (-not [bool]$account.Disabled)
        sid = $sid
        home = $homePath
      }
    }
  } catch { $errors += ('Win32_UserAccount: ' + $_.Exception.Message) }
}

$admins = @()
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
  foreach ($member in $members) {
    $memberName = [string]$member.Name
    if ($memberName -match '\\') {
      $parts = $memberName -split '\\'
      $memberName = [string]$parts[$parts.Count - 1]
    }
    if ($memberName) { $admins += $memberName }
  }
} catch { $errors += ('local administrators: ' + $_.Exception.Message) }

$currentUser = $null
if ($env:USERNAME) {
  $currentFullName = $null
  foreach ($account in $localUsers) {
    if ([string]$account.name -ieq [string]$env:USERNAME) { $currentFullName = [string]$account.fullName; break }
  }
  $isAdmin = $false
  foreach ($adminName in $admins) {
    if ([string]$adminName -ieq [string]$env:USERNAME) { $isAdmin = $true; break }
  }
  $currentUser = [ordered]@{
    name = [string]$env:USERNAME
    fullName = $currentFullName
    home = [string]$env:USERPROFILE
    admin = $isAdmin
  }
}

# ---------------------------------------------------------------- startup --
$startup = @()
$runKeys = @(
  [pscustomobject]@{ hive = 'HKCU'; path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' },
  [pscustomobject]@{ hive = 'HKLM'; path = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run' },
  # The 32-bit registry view needs its own pseudo-hive so the action engine
  # (system.launchAgent) can re-enable the entry in the same key it came from;
  # disabling startup:HKLM:<name> would otherwise target the 64-bit Run key.
  [pscustomobject]@{ hive = 'HKLM32'; path = 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run' }
)
foreach ($runKey in $runKeys) {
  try {
    $properties = Get-ItemProperty -Path $runKey.path -ErrorAction Stop
    $scope = 'system'
    if ($runKey.hive -eq 'HKCU') { $scope = 'user' }
    # HKLM and HKLM32 are both machine scope; only the pseudo-path differs.
    foreach ($property in $properties.PSObject.Properties) {
      $valueName = [string]$property.Name
      if ($valueName -like 'PS*') { continue }
      $startup += [ordered]@{
        label = $valueName
        path = ('startup:' + $runKey.hive + ':' + $valueName)
        scope = $scope
        loaded = $true
        program = [string]$property.Value
        hive = $runKey.hive
        location = 'Software\Microsoft\Windows\CurrentVersion\Run'
        source = 'registry'
      }
    }
  } catch {
    $message = $_.Exception.Message
    if ($message -notmatch 'Cannot find path' -and $message -notmatch 'does not exist') {
      $errors += ('registry ' + $runKey.path + ': ' + $message)
    }
  }
}

# Entries disabled by the DeviceX action engine (see system.launchAgent). The
# action side stores one subkey per hive under
# `HKCU:\Software\DeviceX\DisabledStartup\<HIVE>`, value name -> command.
foreach ($disabledHive in @('HKCU', 'HKLM', 'HKLM32')) {
  $disabledKeyPath = 'HKCU:\Software\DeviceX\DisabledStartup\' + $disabledHive
  try {
    $disabledProperties = Get-ItemProperty -Path $disabledKeyPath -ErrorAction Stop
    if ($null -eq $disabledProperties) { continue }
    $disabledScope = 'system'
    if ($disabledHive -eq 'HKCU') { $disabledScope = 'user' }
    foreach ($property in $disabledProperties.PSObject.Properties) {
      $valueName = [string]$property.Name
      if ($valueName -like 'PS*' -or -not $valueName) { continue }
      $startup += [ordered]@{
        label = $valueName
        path = ('startup:' + $disabledHive + ':' + $valueName)
        scope = $disabledScope
        loaded = $false
        program = [string]$property.Value
        hive = $disabledHive
        location = 'Software\Microsoft\Windows\CurrentVersion\Run'
        source = 'registry'
      }
    }
  } catch { }
}

$loginItems = @()
try {
  $startupCommands = @(Get-CimInstance -ClassName Win32_StartupCommand -ErrorAction Stop)
  foreach ($startupCommand in $startupCommands) {
    $location = [string]$startupCommand.Location
    if ($location -match '^(HKCU|HKLM)') { continue }
    $loginItems += [ordered]@{
      name = [string]$startupCommand.Name
      command = [string]$startupCommand.Command
    }
  }
} catch { $errors += ('Win32_StartupCommand: ' + $_.Exception.Message) }

# ------------------------------------------------------ environment/locale --
$environment = [ordered]@{
  PATH = [string]$env:Path
  SHELL = $null
  HOME = [string]$env:USERPROFILE
  USER = [string]$env:USERNAME
  LANG = $env:LANG
  TERM = $env:TERM
}

$locale = [ordered]@{ timezone = $null; locale = $null; language = $null }
try { $locale.timezone = [string](Get-TimeZone).Id } catch { $locale.timezone = $null }
try { $locale.locale = [string](Get-Culture).Name } catch { $locale.locale = $null }
try { $locale.language = [string](Get-UICulture).Name } catch { $locale.language = $null }

# -------------------------------------------------------------------- emit --
$result = [ordered]@{
  generatedAt = ([DateTimeOffset]::UtcNow).ToUnixTimeMilliseconds()
  os = $osInfo
  device = $device
  boot = $bootInfo
  users = [ordered]@{
    current = $currentUser
    localUsers = $localUsers
    admins = $admins
  }
  startup = $startup
  loginItems = $loginItems
  environment = $environment
  locale = $locale
  errors = $errors
}

$result | ConvertTo-Json -Depth 8 -Compress
