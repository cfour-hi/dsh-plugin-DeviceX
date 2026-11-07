# Device X - Windows fast metrics snapshot.
#
# Emits exactly one JSON document on stdout (no other stdout text).
# Read-only: no admin rights, no network calls, no external modules.
# CPU usage percent is intentionally NOT computed here: the Node mapper derives
# it from successive os.cpus() snapshots (same algorithm as the macOS collector).
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

# ---------------------------------------------------------------- host / OS --
$hostName = $env:COMPUTERNAME
if (-not $hostName) {
  try { $hostName = [System.Net.Dns]::GetHostName() } catch { $hostName = $null }
}

$osInfo = $null
$memoryInfo = $null
try {
  $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
  $bootMs = To-EpochMs $os.LastBootUpTime
  $displayVersion = $null
  try {
    $winVersionKey = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction Stop
    if ($winVersionKey.DisplayVersion) { $displayVersion = [string]$winVersionKey.DisplayVersion }
  } catch { $displayVersion = $null }
  $osInfo = [ordered]@{
    caption = [string]$os.Caption
    displayVersion = $displayVersion
    version = [string]$os.Version
    build = [string]$os.BuildNumber
    lastBootUpTimeMs = $bootMs
    osArchitecture = [string]$os.OSArchitecture
  }

  $totalBytes = $null
  $freeBytes = $null
  if ($null -ne $os.TotalVisibleMemorySize) { $totalBytes = To-LongOrNull ([long]$os.TotalVisibleMemorySize * 1024) }
  if ($null -ne $os.FreePhysicalMemory) { $freeBytes = To-LongOrNull ([long]$os.FreePhysicalMemory * 1024) }

  $cacheBytes = $null
  $availableBytes = $null
  $committedBytes = $null
  $commitLimitBytes = $null
  $poolPagedBytes = $null
  $poolNonPagedBytes = $null
  try {
    $memoryPerf = Get-CimInstance -ClassName Win32_PerfFormattedData_PerfOS_Memory -ErrorAction Stop
    if ($memoryPerf) {
      $cacheBytes = To-LongOrNull $memoryPerf.CacheBytes
      $availableBytes = To-LongOrNull $memoryPerf.AvailableBytes
      $committedBytes = To-LongOrNull $memoryPerf.CommittedBytes
      $commitLimitBytes = To-LongOrNull $memoryPerf.CommitLimit
      $poolPagedBytes = To-LongOrNull $memoryPerf.PoolPagedBytes
      $poolNonPagedBytes = To-LongOrNull $memoryPerf.PoolNonPagedBytes
    }
  } catch { $errors += ('Win32_PerfFormattedData_PerfOS_Memory: ' + $_.Exception.Message) }

  $pageTotalBytes = $null
  $pageUsedBytes = $null
  try {
    $pageFiles = @(Get-CimInstance -ClassName Win32_PageFileUsage -ErrorAction Stop)
    $allocatedMb = 0
    $usedMb = 0
    $pageFileSeen = $false
    foreach ($pageFile in $pageFiles) {
      if ($null -ne $pageFile.AllocatedBaseSize) { $allocatedMb += [double]$pageFile.AllocatedBaseSize; $pageFileSeen = $true }
      if ($null -ne $pageFile.CurrentUsage) { $usedMb += [double]$pageFile.CurrentUsage }
    }
    if ($pageFileSeen) {
      $pageTotalBytes = [long][math]::Round($allocatedMb * 1MB)
      $pageUsedBytes = [long][math]::Round($usedMb * 1MB)
    }
  } catch { $errors += ('Win32_PageFileUsage: ' + $_.Exception.Message) }

  $memoryInfo = [ordered]@{
    totalBytes = $totalBytes
    freeBytes = $freeBytes
    cacheBytes = $cacheBytes
    availableBytes = $availableBytes
    committedBytes = $committedBytes
    commitLimitBytes = $commitLimitBytes
    poolPagedBytes = $poolPagedBytes
    poolNonPagedBytes = $poolNonPagedBytes
    pageFileTotalBytes = $pageTotalBytes
    pageFileUsedBytes = $pageUsedBytes
  }
} catch {
  $errors += ('Win32_OperatingSystem: ' + $_.Exception.Message)
}

# --------------------------------------------------------------------- CPU --
$cpuInfo = $null
try {
  $processors = @(Get-CimInstance -ClassName Win32_Processor -ErrorAction Stop)
  if ($processors.Count -gt 0) {
    $first = $processors[0]
    $physicalCores = 0
    $logicalCores = 0
    foreach ($processor in $processors) {
      if ($null -ne $processor.NumberOfCores) { $physicalCores += [int]$processor.NumberOfCores }
      if ($null -ne $processor.NumberOfLogicalProcessors) { $logicalCores += [int]$processor.NumberOfLogicalProcessors }
    }
    $cpuInfo = [ordered]@{
      name = [string]$first.Name
      manufacturer = [string]$first.Manufacturer
      physicalCores = $physicalCores
      logicalCores = $logicalCores
      maxClockSpeedMHz = To-LongOrNull $first.MaxClockSpeed
      architecture = To-LongOrNull $first.Architecture
    }
  }
} catch { $errors += ('Win32_Processor: ' + $_.Exception.Message) }

# -------------------------------------------------------------------- disk --
$diskInfo = $null
try {
  $drives = @(Get-CimInstance -ClassName Win32_LogicalDisk -Filter 'DriveType=3' -ErrorAction Stop)
  $totalDisk = [long]0
  $freeDisk = [long]0
  $diskSeen = $false
  foreach ($drive in $drives) {
    if ($null -ne $drive.Size) { $totalDisk += [long]$drive.Size; $diskSeen = $true }
    if ($null -ne $drive.FreeSpace) { $freeDisk += [long]$drive.FreeSpace }
  }
  if ($diskSeen) {
    $diskInfo = [ordered]@{
      totalBytes = $totalDisk
      freeBytes = $freeDisk
      usedBytes = [math]::Max([long]0, $totalDisk - $freeDisk)
    }
  }
} catch { $errors += ('Win32_LogicalDisk: ' + $_.Exception.Message) }

# Cumulative disk byte counters: the Node side turns these into per-second rates.
$diskIo = $null
try {
  $diskPerf = @(Get-CimInstance -ClassName Win32_PerfRawData_PerfDisk_PhysicalDisk -ErrorAction Stop)
  $readBytes = [long]0
  $writeBytes = [long]0
  $perfSeen = $false
  $totalRow = $null
  foreach ($row in $diskPerf) {
    if ([string]$row.Name -eq '_Total') { $totalRow = $row; break }
  }
  if ($null -ne $totalRow) {
    $readBytes = To-LongOrNull $totalRow.DiskReadBytesPersec
    $writeBytes = To-LongOrNull $totalRow.DiskWriteBytesPersec
    if ($null -ne $readBytes) { $perfSeen = $true }
  } else {
    foreach ($row in $diskPerf) {
      $readValue = To-LongOrNull $row.DiskReadBytesPersec
      $writeValue = To-LongOrNull $row.DiskWriteBytesPersec
      if ($null -ne $readValue) { $readBytes += $readValue; $perfSeen = $true }
      if ($null -ne $writeValue) { $writeBytes += $writeValue }
    }
  }
  if ($perfSeen) {
    $diskIo = [ordered]@{ read = $readBytes; write = $writeBytes }
  }
} catch { $errors += ('Win32_PerfRawData_PerfDisk_PhysicalDisk: ' + $_.Exception.Message) }

# ----------------------------------------------------------------- network --
$networkInfo = $null
try {
  $defaultInterface = $null
  $defaultGateway = $null
  try {
    # The effective Windows route metric is RouteMetric + InterfaceMetric (a
    # two-key Sort-Object compares lexicographically, not by the sum), so sort
    # by the numeric sum to report the real egress adapter (network.setDns uses
    # this alias).
    $routes = @(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction Stop | Sort-Object -Property @{Expression = { [long]$_.RouteMetric + [long]$_.InterfaceMetric }})
    if ($routes.Count -gt 0) {
      $defaultInterface = [string]$routes[0].InterfaceAlias
      $defaultGateway = [string]$routes[0].NextHop
    }
  } catch { $errors += ('Get-NetRoute: ' + $_.Exception.Message) }

  $primaryIpv4 = @()
  if ($defaultInterface) {
    try {
      $addresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop)
      foreach ($address in $addresses) {
        if ([string]$address.InterfaceAlias -eq $defaultInterface -and [string]$address.IPAddress -ne '127.0.0.1') {
          $primaryIpv4 += [string]$address.IPAddress
        }
      }
    } catch { $errors += ('Get-NetIPAddress: ' + $_.Exception.Message) }
  }

  # Cumulative adapter byte counters (loopback excluded) for delta-based rates.
  $counters = $null
  try {
    $statistics = @(Get-NetAdapterStatistics -ErrorAction Stop)
    $receivedBytes = [long]0
    $sentBytes = [long]0
    $counterSeen = $false
    foreach ($statistic in $statistics) {
      $name = [string]$statistic.Name
      if ($name -match 'Loopback') { continue }
      $received = To-LongOrNull $statistic.ReceivedBytes
      $sent = To-LongOrNull $statistic.SentBytes
      if ($null -ne $received) { $receivedBytes += $received; $counterSeen = $true }
      if ($null -ne $sent) { $sentBytes += $sent }
    }
    if ($counterSeen) {
      $counters = [ordered]@{ read = $receivedBytes; write = $sentBytes }
    }
  } catch { $errors += ('Get-NetAdapterStatistics: ' + $_.Exception.Message) }

  # Wi-Fi via netsh. Field labels are localized by Windows, so the parser keys
  # off the untranslated tokens that netsh always prints ("SSID", "BSSID",
  # "Mbps", "...%") and falls back to positional/value heuristics.
  $wifi = $null
  try {
    $wlanLines = @(Invoke-NativeOem { & netsh wlan show interfaces 2>$null })
    if ($wlanLines.Count -gt 0) {
      $parsedWifi = [ordered]@{}
      $macValues = @()
      $values = @()
      foreach ($line in $wlanLines) {
        $text = [string]$line
        if ($text -match '^\s*([^:]+?)\s*:\s*(.*?)\s*$') {
          $label = $matches[1]
          $value = $matches[2]
          $values += [pscustomobject]@{ label = $label; value = $value }
          if ($value -match '^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$') { $macValues += $value }
        }
      }
      $firstValue = $null
      if ($values.Count -gt 0) { $firstValue = [string]$values[0].value }
      if ($firstValue -and -not $parsedWifi.name) { $parsedWifi.name = $firstValue }
      foreach ($entry in $values) {
        $label = [string]$entry.label
        $value = [string]$entry.value
        if ($label -eq 'SSID') { $parsedWifi.ssid = $value; continue }
        if ($label -eq 'BSSID' -or $label -eq 'AP BSSID') { $parsedWifi.bssid = $value; continue }
        if ($label -eq 'Name') { $parsedWifi.name = $value; continue }
        if ($label -eq 'State') { $parsedWifi.state = $value; continue }
        if ($label -eq 'Authentication') { $parsedWifi.authentication = $value; continue }
        if ($label -eq 'Radio type') { $parsedWifi.radioType = $value; continue }
        if ($value -match '^(\d{1,3})%$') { $parsedWifi.signalPercent = [int]$matches[1]; continue }
        if ($label -match 'Mbps') {
          if (-not $parsedWifi.receiveRateMbps) { $parsedWifi.receiveRateMbps = [double]$value }
          else { $parsedWifi.transmitRateMbps = [double]$value }
          continue
        }
        if ($value -match '^\d{1,3}$') {
          $number = [int]$value
          if ($number -ge 1 -and $number -le 233 -and -not $parsedWifi.channel) { $parsedWifi.channel = $number }
        }
      }
      if (-not $parsedWifi.bssid -and $macValues.Count -gt 1) { $parsedWifi.bssid = [string]$macValues[$macValues.Count - 1] }
      if ($parsedWifi.ssid -and $parsedWifi.ssid.Length -gt 0) {
        if (-not $parsedWifi.state) { $parsedWifi.state = 'connected' }
        $wifi = $parsedWifi
      }
    }
  } catch { $errors += ('netsh wlan show interfaces: ' + $_.Exception.Message) }

  $networkInfo = [ordered]@{
    defaultInterface = $defaultInterface
    defaultGateway = $defaultGateway
    primaryIpv4 = $primaryIpv4
    counters = $counters
    wifi = $wifi
  }
} catch { $errors += ('network metrics: ' + $_.Exception.Message) }

# ----------------------------------------------------------------- battery --
$battery = $null
try {
  $batteries = @(Get-CimInstance -ClassName Win32_Battery -ErrorAction Stop)
  if ($batteries.Count -gt 0) {
    $batteryDevice = $batteries[0]
    $percent = $null
    if ($null -ne $batteryDevice.EstimatedChargeRemaining) { $percent = [int]$batteryDevice.EstimatedChargeRemaining }
    $status = $null
    if ($null -ne $batteryDevice.BatteryStatus) { $status = [int]$batteryDevice.BatteryStatus }
    $powerOnline = $null
    if ($null -ne $batteryDevice.PowerOnline) { $powerOnline = [bool]$batteryDevice.PowerOnline }
    $charging = $false
    if ($status -eq 6 -or $status -eq 7 -or $status -eq 8 -or $status -eq 9) { $charging = $true }
    $plugged = $false
    if ($powerOnline -eq $true) { $plugged = $true }
    if ($status -eq 3 -or $charging) { $plugged = $true }
    $powerSource = 'Battery Power'
    if ($plugged) { $powerSource = 'AC Power' }
    $remaining = $null
    if (-not $plugged -and $null -ne $batteryDevice.EstimatedRunTime) {
      $runTime = [int]$batteryDevice.EstimatedRunTime
      if ($runTime -gt 0 -and $runTime -lt 6000) { $remaining = $runTime }
    }
    $temperatureC = $null
    try {
      $wmib = Get-CimInstance -Namespace 'root/wmi' -ClassName BatteryStatus -ErrorAction Stop
      if ($wmib -and $null -ne $wmib.Temperature) {
        $temperatureC = [math]::Round(([double]$wmib.Temperature / 10.0) - 273.15, 1)
      }
    } catch { $temperatureC = $null }
    $designCapacityMah = $null
    $maxCapacityMah = $null
    $healthPercent = $null
    $designMwh = To-LongOrNull $batteryDevice.DesignCapacity
    $fullMwh = To-LongOrNull $batteryDevice.FullChargeCapacity
    $voltageMv = To-LongOrNull $batteryDevice.DesignVoltage
    # Win32_Battery usually exposes both capacities; fall back to the root/wmi
    # battery classes when a driver only publishes them there (both in mWh).
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
    if ($null -ne $designMwh -and $null -ne $voltageMv -and $voltageMv -gt 0) {
      $designCapacityMah = [int][math]::Round(([double]$designMwh * 1000.0) / [double]$voltageMv)
    }
    if ($null -ne $fullMwh -and $null -ne $voltageMv -and $voltageMv -gt 0) {
      $maxCapacityMah = [int][math]::Round(([double]$fullMwh * 1000.0) / [double]$voltageMv)
    }
    if ($null -ne $designMwh -and $null -ne $fullMwh -and $designMwh -gt 0) {
      $healthPercent = [int][math]::Round(([double]$fullMwh / [double]$designMwh) * 100.0)
    }
    $battery = [ordered]@{
      present = $true
      percent = $percent
      charging = $charging
      plugged = $plugged
      powerSource = $powerSource
      timeRemainingMin = $remaining
      temperatureC = $temperatureC
      cycleCount = $null
      healthPercent = $healthPercent
      designCapacityMah = $designCapacityMah
      maxCapacityMah = $maxCapacityMah
      status = $status
    }
  }
} catch { $errors += ('Win32_Battery: ' + $_.Exception.Message) }

# --------------------------------------------------------------- processes --
$processInfo = $null
try {
  $processNames = @{}
  $processCount = 0
  try {
    $running = @(Get-Process -ErrorAction SilentlyContinue)
    $processCount = $running.Count
    foreach ($runningProcess in $running) {
      try { $processNames[[int]$runningProcess.Id] = [string]$runningProcess.ProcessName } catch { }
    }
  } catch { $processCount = 0 }

  $candidates = @()
  try {
    $processPerf = @(Get-CimInstance -ClassName Win32_PerfFormattedData_PerfProc_Process -ErrorAction Stop)
    foreach ($row in $processPerf) {
      $rawName = [string]$row.Name
      if (-not $rawName) { continue }
      if ($rawName -eq '_Total' -or $rawName -eq 'Idle') { continue }
      $processId = 0
      if ($null -ne $row.IDProcess) { $processId = [int]$row.IDProcess }
      if ($processId -le 0) { continue }
      $cpuPercent = 0.0
      if ($null -ne $row.PercentProcessorTime) { $cpuPercent = [double]$row.PercentProcessorTime }
      $workingSet = $null
      if ($null -ne $row.WorkingSetPrivate) { $workingSet = To-LongOrNull $row.WorkingSetPrivate }
      if ($null -eq $workingSet -and $null -ne $row.WorkingSet) { $workingSet = To-LongOrNull $row.WorkingSet }
      $name = $rawName -replace '#\d+$', ''
      if ($processNames.ContainsKey($processId)) { $name = $processNames[$processId] }
      $candidates += [pscustomobject]@{
        pid = $processId
        name = $name
        cpuPercent = $cpuPercent
        workingSetBytes = $workingSet
      }
    }
  } catch { $errors += ('Win32_PerfFormattedData_PerfProc_Process: ' + $_.Exception.Message) }

  # The mapper only consumes metrics.processes.top[0..4]; asking for five rows
  # avoids five unnecessary Win32_Process GetOwner round-trips per poll.
  $top = @($candidates | Sort-Object -Property cpuPercent -Descending | Select-Object -First 5)
  $topList = @()
  foreach ($entry in $top) {
    $userName = $null
    try {
      $ownerProcess = Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId = ' + [string]$entry.pid) -ErrorAction Stop
      if ($ownerProcess) {
        $owner = Invoke-CimMethod -InputObject $ownerProcess -MethodName GetOwner -ErrorAction Stop
        if ($owner -and $owner.User) {
          if ($owner.Domain) { $userName = [string]$owner.Domain + '\' + [string]$owner.User }
          else { $userName = [string]$owner.User }
        }
      }
    } catch { $userName = $null }
    $topList += [ordered]@{
      pid = $entry.pid
      name = $entry.name
      cpuPercent = $entry.cpuPercent
      workingSetBytes = $entry.workingSetBytes
      user = $userName
    }
  }
  $processInfo = [ordered]@{
    total = $processCount
    top = $topList
  }
} catch { $errors += ('process metrics: ' + $_.Exception.Message) }

# -------------------------------------------------------------------- emit --
$result = [ordered]@{
  generatedAt = ([DateTimeOffset]::UtcNow).ToUnixTimeMilliseconds()
  hostname = $hostName
  os = $osInfo
  cpu = $cpuInfo
  memory = $memoryInfo
  disk = $diskInfo
  diskIo = $diskIo
  network = $networkInfo
  battery = $battery
  processes = $processInfo
  errors = $errors
}

$result | ConvertTo-Json -Depth 8 -Compress
