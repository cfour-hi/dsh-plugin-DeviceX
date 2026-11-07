# Device X - Windows hardware inventory (CIM/PnP).
#
# Emits exactly one JSON document on stdout (no other stdout text).
# Read-only: no admin rights, no network calls, no external modules.
$ErrorActionPreference = 'Stop'

$errors = @()

function To-LongOrNull($value) {
  if ($null -eq $value) { return $null }
  try { return [long]$value } catch { return $null }
}

function ConvertFrom-IdList($value) {
  # WmiMonitorID string fields are arrays of ASCII code units ended by 0.
  if ($null -eq $value) { return $null }
  try {
    $characters = @()
    foreach ($item in @($value)) {
      $code = [int]$item
      if ($code -le 0) { break }
      $characters += [char]$code
    }
    $text = (-join $characters).Trim()
    if ($text.Length -gt 0) { return $text }
    return $null
  } catch { return $null }
}

function Get-GpuRegistryMemoryBytes {
  # Win32_VideoController.AdapterRAM is UInt32 and wraps/zeroes for cards with
  # more than 4 GB. The display class registry keys store the exact byte size in
  # `HardwareInformation.qwMemorySize` (QWORD), keyed by DriverDesc (which is
  # normally identical to Win32_VideoController.Name).
  $memoryByName = @{}
  $classRoot = 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}'
  try {
    $classKeys = @(Get-ChildItem -Path $classRoot -ErrorAction Stop)
  } catch {
    return $memoryByName
  }
  foreach ($classKey in $classKeys) {
    if ([string]$classKey.PSChildName -notmatch '^\d{4}$') { continue }
    try {
      $properties = Get-ItemProperty -Path $classKey.PSPath -ErrorAction Stop
      $memory = To-LongOrNull $properties.'HardwareInformation.qwMemorySize'
      if ($null -eq $memory -or $memory -le 0) { continue }
      $description = [string]$properties.DriverDesc
      if ($description) { $memoryByName[$description] = $memory }
    } catch { }
  }
  return $memoryByName
}

# --------------------------------------------------------------------- CPU --
$cpu = $null
try {
  $processors = @(Get-CimInstance -ClassName Win32_Processor -ErrorAction Stop)
  if ($processors.Count -gt 0) {
    $first = $processors[0]
    $physicalCores = 0
    $logicalCores = 0
    $l2CacheKB = 0
    $l3CacheKB = 0
    foreach ($processor in $processors) {
      if ($null -ne $processor.NumberOfCores) { $physicalCores += [int]$processor.NumberOfCores }
      if ($null -ne $processor.NumberOfLogicalProcessors) { $logicalCores += [int]$processor.NumberOfLogicalProcessors }
      if ($null -ne $processor.L2CacheSize) { $l2CacheKB += [long]$processor.L2CacheSize }
      if ($null -ne $processor.L3CacheSize) { $l3CacheKB += [long]$processor.L3CacheSize }
    }
    $cpu = [ordered]@{
      name = [string]$first.Name
      manufacturer = [string]$first.Manufacturer
      physicalCores = $physicalCores
      logicalCores = $logicalCores
      maxClockSpeedMHz = To-LongOrNull $first.MaxClockSpeed
      architecture = To-LongOrNull $first.Architecture
      l2CacheKB = $l2CacheKB
      l3CacheKB = $l3CacheKB
    }
  }
} catch { $errors += ('Win32_Processor: ' + $_.Exception.Message) }

# ------------------------------------------------------------------ memory --
$modules = @()
$totalMemoryBytes = $null
try {
  $physicalModules = @(Get-CimInstance -ClassName Win32_PhysicalMemory -ErrorAction Stop)
  foreach ($module in $physicalModules) {
    $modules += [ordered]@{
      capacityBytes = To-LongOrNull $module.Capacity
      speedMHz = To-LongOrNull $module.Speed
      configuredSpeedMHz = To-LongOrNull $module.ConfiguredClockSpeed
      manufacturer = [string]$module.Manufacturer
      partNumber = [string]$module.PartNumber
      deviceLocator = [string]$module.DeviceLocator
      smbiosType = To-LongOrNull $module.SMBIOSMemoryType
    }
  }
} catch { $errors += ('Win32_PhysicalMemory: ' + $_.Exception.Message) }

$arrayMaxCapacityBytes = $null
try {
  $memoryArrays = @(Get-CimInstance -ClassName Win32_PhysicalMemoryArray -ErrorAction Stop)
  if ($memoryArrays.Count -gt 0 -and $null -ne $memoryArrays[0].MaxCapacityEx) {
    $maxKb = To-LongOrNull $memoryArrays[0].MaxCapacityEx
    if ($null -ne $maxKb) { $arrayMaxCapacityBytes = $maxKb * 1024 }
  }
} catch { $arrayMaxCapacityBytes = $null }

try {
  $computerSystem = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop
  $totalMemoryBytes = To-LongOrNull $computerSystem.TotalPhysicalMemory
} catch { $errors += ('Win32_ComputerSystem: ' + $_.Exception.Message) }

if ($null -eq $totalMemoryBytes -and $modules.Count -gt 0) {
  $sum = [long]0
  $anyModule = $false
  foreach ($module in $modules) {
    if ($null -ne $module.capacityBytes) { $sum += [long]$module.capacityBytes; $anyModule = $true }
  }
  if ($anyModule) { $totalMemoryBytes = $sum }
}

$memory = [ordered]@{
  totalBytes = $totalMemoryBytes
  arrayMaxCapacityBytes = $arrayMaxCapacityBytes
  modules = $modules
}

# ------------------------------------------------------- GPU and displays --
$gpuMemoryByName = Get-GpuRegistryMemoryBytes
$videoControllers = @()
try {
  $adapters = @(Get-CimInstance -ClassName Win32_VideoController -ErrorAction Stop)
  foreach ($adapter in $adapters) {
    $adapterName = [string]$adapter.Name
    $adapterRamBytes = To-LongOrNull $adapter.AdapterRAM
    $adapterRamSource = $null
    if ($null -ne $adapterRamBytes) { $adapterRamSource = 'cim' }
    $registryMemory = $null
    if ($adapterName -and $gpuMemoryByName.ContainsKey($adapterName)) {
      $registryMemory = $gpuMemoryByName[$adapterName]
    }
    if ($null -ne $registryMemory -and $registryMemory -gt 0) {
      $adapterRamBytes = $registryMemory
      $adapterRamSource = 'registry'
    } elseif ($null -ne $adapterRamBytes -and $adapterRamBytes -ge 4000000000) {
      # UInt32 AdapterRAM saturates at 4 GB; do not report a bogus number.
      $adapterRamBytes = $null
      $adapterRamSource = 'cim-capped'
      $errors += ('GPU memory for "' + $adapterName + '" is truncated at 4 GB (Win32_VideoController AdapterRAM); registry qwMemorySize unavailable')
    }
    $videoControllers += [ordered]@{
      name = $adapterName
      adapterRamBytes = $adapterRamBytes
      adapterRamSource = $adapterRamSource
      driverVersion = [string]$adapter.DriverVersion
      videoProcessor = [string]$adapter.VideoProcessor
      currentWidth = To-LongOrNull $adapter.CurrentHorizontalResolution
      currentHeight = To-LongOrNull $adapter.CurrentVerticalResolution
      currentRefreshHz = To-LongOrNull $adapter.CurrentRefreshRate
      status = [string]$adapter.Status
    }
  }
} catch { $errors += ('Win32_VideoController: ' + $_.Exception.Message) }

$monitors = @()
try {
  $monitorIds = @(Get-CimInstance -Namespace 'root/wmi' -ClassName WmiMonitorID -ErrorAction Stop)
  foreach ($monitor in $monitorIds) {
    $monitors += [ordered]@{
      name = ConvertFrom-IdList $monitor.UserFriendlyName
      manufacturer = ConvertFrom-IdList $monitor.ManufacturerName
      serial = ConvertFrom-IdList $monitor.SerialNumberID
      active = [bool]$monitor.Active
    }
  }
} catch { $errors += ('WmiMonitorID: ' + $_.Exception.Message); $monitors = @() }

# ---------------------------------------------------------------- storage --
$physicalDisks = @()
try {
  $storageDisks = @(Get-PhysicalDisk -ErrorAction Stop)
  foreach ($disk in $storageDisks) {
    $mediaType = [string]$disk.MediaType
    $physicalDisks += [ordered]@{
      name = [string]$disk.FriendlyName
      model = [string]$disk.Model
      sizeBytes = To-LongOrNull $disk.Size
      mediaType = $mediaType
      smartStatus = [string]$disk.HealthStatus
      serial = [string]$disk.SerialNumber
      interfaceType = [string]$disk.BusType
    }
  }
} catch { $errors += ('Get-PhysicalDisk: ' + $_.Exception.Message); $physicalDisks = @() }

$diskDrives = @()
try {
  $drives = @(Get-CimInstance -ClassName Win32_DiskDrive -ErrorAction Stop)
  foreach ($drive in $drives) {
    $diskDrives += [ordered]@{
      model = [string]$drive.Model
      sizeBytes = To-LongOrNull $drive.Size
      mediaType = [string]$drive.MediaType
      interfaceType = [string]$drive.InterfaceType
      serialNumber = [string]$drive.SerialNumber
    }
  }
} catch { $errors += ('Win32_DiskDrive: ' + $_.Exception.Message) }

$volumes = @()
try {
  $logicalDisks = @(Get-CimInstance -ClassName Win32_LogicalDisk -ErrorAction Stop)
  foreach ($logicalDisk in $logicalDisks) {
    $driveType = 0
    if ($null -ne $logicalDisk.DriveType) { $driveType = [int]$logicalDisk.DriveType }
    if ($driveType -ne 2 -and $driveType -ne 3) { continue }
    $volumes += [ordered]@{
      deviceId = [string]$logicalDisk.DeviceID
      name = [string]$logicalDisk.VolumeName
      fs = [string]$logicalDisk.FileSystem
      totalBytes = To-LongOrNull $logicalDisk.Size
      freeBytes = To-LongOrNull $logicalDisk.FreeSpace
      driveType = $driveType
    }
  }
} catch { $errors += ('Win32_LogicalDisk: ' + $_.Exception.Message) }

# ---------------------------------------------------------------- battery --
$battery = $null
try {
  $batteries = @(Get-CimInstance -ClassName Win32_Battery -ErrorAction Stop)
  if ($batteries.Count -gt 0) {
    $batteryDevice = $batteries[0]
    $percent = $null
    if ($null -ne $batteryDevice.EstimatedChargeRemaining) { $percent = [int]$batteryDevice.EstimatedChargeRemaining }
    $condition = $null
    if ($batteryDevice.Status) {
      $condition = [string]$batteryDevice.Status
      if ($condition -eq 'OK') { $condition = 'Normal' }
    }
    $designMwh = To-LongOrNull $batteryDevice.DesignCapacity
    $fullMwh = To-LongOrNull $batteryDevice.FullChargeCapacity
    $voltageMv = To-LongOrNull $batteryDevice.DesignVoltage
    if ($null -eq $designMwh -or $null -eq $fullMwh) {
      try {
        $staticBattery = @(Get-CimInstance -Namespace 'root/wmi' -ClassName BatteryStaticData -ErrorAction Stop)
        if ($staticBattery.Count -gt 0) {
          if ($null -eq $designMwh -and $null -ne $staticBattery[0].DesignedCapacity) {
            $designMwh = [double]$staticBattery[0].DesignedCapacity
          }
          if ($null -eq $voltageMv -and $null -ne $staticBattery[0].DesignedVoltage) {
            $voltageMv = [double]$staticBattery[0].DesignedVoltage
          }
        }
        $fullBattery = @(Get-CimInstance -Namespace 'root/wmi' -ClassName BatteryFullChargedCapacity -ErrorAction Stop)
        if ($fullBattery.Count -gt 0 -and $null -eq $fullMwh -and $null -ne $fullBattery[0].BatteryFullChargedCapacity) {
          $fullMwh = [double]$fullBattery[0].BatteryFullChargedCapacity
        }
      } catch { }
    }
    $designCapacityMah = $null
    $maxCapacityMah = $null
    $healthPercent = $null
    if ($null -ne $designMwh -and $null -ne $voltageMv -and $voltageMv -gt 0) {
      $designCapacityMah = [int][math]::Round(([double]$designMwh * 1000.0) / [double]$voltageMv)
    }
    if ($null -ne $fullMwh -and $null -ne $voltageMv -and $voltageMv -gt 0) {
      $maxCapacityMah = [int][math]::Round(([double]$fullMwh * 1000.0) / [double]$voltageMv)
    }
    if ($null -ne $designMwh -and $null -ne $fullMwh -and $designMwh -gt 0) {
      $healthPercent = [int][math]::Round(([double]$fullMwh / [double]$designMwh) * 100.0)
    }
    $temperatureC = $null
    try {
      $wmib = Get-CimInstance -Namespace 'root/wmi' -ClassName BatteryStatus -ErrorAction Stop
      if ($wmib -and $null -ne $wmib.Temperature) {
        $temperatureC = [math]::Round(([double]$wmib.Temperature / 10.0) - 273.15, 1)
      }
    } catch { $temperatureC = $null }
    $cycleCount = $null
    try {
      $cycleData = Get-CimInstance -Namespace 'root/wmi' -ClassName BatteryCycleCount -ErrorAction Stop
      if ($cycleData -and $null -ne $cycleData.CycleCount) { $cycleCount = [int]$cycleData.CycleCount }
    } catch { $cycleCount = $null }
    $battery = [ordered]@{
      present = $true
      percent = $percent
      condition = $condition
      cycleCount = $cycleCount
      designCapacityMah = $designCapacityMah
      maxCapacityMah = $maxCapacityMah
      temperatureC = $temperatureC
      healthPercent = $healthPercent
    }
  }
} catch { $errors += ('Win32_Battery: ' + $_.Exception.Message) }

# -------------------------------------------------------------------- USB --
$usb = @()
try {
  $usbDevices = @(Get-PnpDevice -Class USB -PresentOnly -ErrorAction Stop)
  foreach ($device in $usbDevices) {
    $instanceId = [string]$device.InstanceId
    if ($instanceId -notmatch 'VID_([0-9A-Fa-f]{4})&PID_([0-9A-Fa-f]{4})') { continue }
    $vendorId = $matches[1].ToUpperInvariant()
    $productId = $matches[2].ToUpperInvariant()
    $serial = $null
    if ($instanceId -match '^[^\\]+\\[^\\]+\\([^\\]+)$') {
      if ($matches[1] -notmatch '&') { $serial = $matches[1] }
    }
    $usb += [ordered]@{
      name = [string]$device.FriendlyName
      vendor = $vendorId
      productId = $productId
      serial = $serial
      speed = $null
      bus = $null
    }
  }
} catch { $errors += ('Get-PnpDevice USB: ' + $_.Exception.Message) }

# -------------------------------------------------------------- Bluetooth --
$bluetoothControllers = @()
$bluetoothDevices = @()
try {
  $bluetoothPnp = @(Get-PnpDevice -Class Bluetooth -PresentOnly -ErrorAction Stop)
  foreach ($device in $bluetoothPnp) {
    $instanceId = [string]$device.InstanceId
    $friendlyName = [string]$device.FriendlyName
    $deviceStatus = [string]$device.Status
    if ($instanceId -match '^(BTHENUM|BTHLE)\\') {
      $address = $null
      if ($instanceId -match 'Dev_([0-9A-Fa-f]{12})') {
        $hex = $matches[1].ToUpperInvariant()
        $pairs = @()
        $index = 0
        while ($index -lt 12) {
          $pairs += $hex.Substring($index, 2)
          $index += 2
        }
        $address = ($pairs -join ':')
      }
      $deviceType = $null
      if ($friendlyName -match '(?i)headphone|headset|speaker|audio|earbud') { $deviceType = 'audio' }
      elseif ($friendlyName -match '(?i)keyboard|mouse|trackpad|gamepad|controller') { $deviceType = 'input' }
      $bluetoothDevices += [ordered]@{
        name = $friendlyName
        address = $address
        connected = ($deviceStatus -eq 'OK')
        batteryPercent = $null
        type = $deviceType
      }
    } else {
      $state = 'off'
      if ($deviceStatus -eq 'OK') { $state = 'on' }
      $bluetoothControllers += [ordered]@{
        name = $friendlyName
        address = $null
        chipset = $friendlyName
        firmware = $null
        state = $state
      }
    }
  }
} catch { $errors += ('Get-PnpDevice Bluetooth: ' + $_.Exception.Message) }

# ------------------------------------------------------------------ audio --
$audio = @()
try {
  $audioEndpoints = @(Get-PnpDevice -Class AudioEndpoint -PresentOnly -ErrorAction Stop)
  foreach ($endpoint in $audioEndpoints) {
    $instanceId = [string]$endpoint.InstanceId
    $friendlyName = [string]$endpoint.FriendlyName
    $kind = $null
    if ($instanceId -match '\{[0-9A-Fa-f-]{36}\}') {
      $guid = $matches[0]
      if (Test-Path -LiteralPath ('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render\' + $guid)) {
        $kind = 'output'
      } elseif (Test-Path -LiteralPath ('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Capture\' + $guid)) {
        $kind = 'input'
      }
    }
    if (-not $kind) {
      if ($friendlyName -match '(?i)microphone|mic\b|capture|input') { $kind = 'input' } else { $kind = 'output' }
    }
    $audio += [ordered]@{
      name = $friendlyName
      kind = $kind
      manufacturer = $null
      default = $null
    }
  }
} catch { $errors += ('Get-PnpDevice AudioEndpoint: ' + $_.Exception.Message) }

if ($audio.Count -eq 0) {
  try {
    $soundDevices = @(Get-CimInstance -ClassName Win32_SoundDevice -ErrorAction Stop)
    foreach ($soundDevice in $soundDevices) {
      $audio += [ordered]@{
        name = [string]$soundDevice.Name
        kind = 'output'
        manufacturer = [string]$soundDevice.Manufacturer
        default = $null
      }
    }
  } catch { $errors += ('Win32_SoundDevice: ' + $_.Exception.Message) }
}

# ---------------------------------------------------------------- cameras --
$cameras = @()
try {
  $cameraDevices = @(Get-PnpDevice -Class Camera,Image -PresentOnly -ErrorAction Stop)
  foreach ($camera in $cameraDevices) {
    $cameras += [ordered]@{
      name = [string]$camera.FriendlyName
      modelId = $null
      uniqueId = [string]$camera.InstanceId
    }
  }
} catch { $errors += ('Get-PnpDevice Camera/Image: ' + $_.Exception.Message) }

# -------------------------------------------------------------------- emit --
$result = [ordered]@{
  generatedAt = ([DateTimeOffset]::UtcNow).ToUnixTimeMilliseconds()
  cpu = $cpu
  memory = $memory
  videoControllers = $videoControllers
  monitors = $monitors
  physicalDisks = $physicalDisks
  diskDrives = $diskDrives
  volumes = $volumes
  battery = $battery
  usb = $usb
  bluetoothControllers = $bluetoothControllers
  bluetoothDevices = $bluetoothDevices
  audio = $audio
  cameras = $cameras
  errors = $errors
}

$result | ConvertTo-Json -Depth 8 -Compress
