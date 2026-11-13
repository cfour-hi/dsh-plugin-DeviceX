# Device X - Windows fast metrics snapshot.
#
# Emits exactly one JSON document on stdout (no other stdout text).
# Read-only: no admin rights, no network calls, no external modules.
# CPU usage percent is intentionally NOT computed here: the Node mapper derives
# it from successive os.cpus() snapshots (same algorithm as the macOS collector).
$ErrorActionPreference = 'Stop'

$errors = @()

# Two scopes, because a Windows CIM/cmdlet call costs ~1 s on real hardware and
# the UI polls every 2.5 s:
#   fast   - only what must be fresh (memory, disk, byte counters, thermal, top
#            processes). This is the poll path.
#   detail - facts that change slowly or cost seconds (CPU model, default
#            route, Wi-Fi, battery, per-process owners). Cached by the Node side
#            for DETAIL_TTL and merged into the fast document.
#   all    - both, used by tests and by callers that want one document.
$scope = [string]$env:DEVICEX_ARG_SCOPE
if ($scope -ne 'fast' -and $scope -ne 'detail') { $scope = 'all' }
$wantFast = $scope -ne 'detail'
$wantDetail = $scope -ne 'fast'
# CPU facts never change, so the Node side asks for them on the first fast poll
# only (DEVICEX_ARG_CPU_FACTS=1) and caches the answer for the process lifetime.
$wantCpuFacts = $wantDetail -or ([string]$env:DEVICEX_ARG_CPU_FACTS -eq '1')

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
if ($wantCpuFacts) {
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
}

# -------------------------------------------------------------------- disk --
$diskInfo = $null
if ($wantFast) {
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
}

# Cumulative disk byte counters: the Node side turns these into per-second rates.
$diskIo = $null
if ($wantFast) {
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
}

# ----------------------------------------------------------------- network --
$networkInfo = $null
try {
  $defaultInterface = $null
  $defaultGateway = $null
  $primaryIpv4 = @()
  $counters = $null
  $wifi = $null

  if ($wantDetail) {
    try {
      # Win32_IP4RouteTable (~0.2 s) instead of Get-NetRoute (~1 s): the cmdlet
      # alone was a third of the fast-poll budget on real hardware. The effective
      # metric is RouteMetric + InterfaceMetric, so both are summed here (the
      # table only carries the route metric).
      $adapterMetrics = @{}
      $adapterAliases = @{}
      foreach ($adapter in @(Get-NetAdapter -ErrorAction SilentlyContinue)) {
        $adapterMetrics[[int]$adapter.ifIndex] = [long]$adapter.InterfaceMetric
        $adapterAliases[[int]$adapter.ifIndex] = [string]$adapter.Name
      }
      $routes = @(Get-CimInstance -ClassName Win32_IP4RouteTable -Filter "Destination='0.0.0.0'" -ErrorAction Stop)
      $bestRoute = $null
      $bestMetric = [long]::MaxValue
      foreach ($route in $routes) {
        $index = [int]$route.InterfaceIndex
        $metric = [long]$route.Metric1
        if ($adapterMetrics.ContainsKey($index)) { $metric += $adapterMetrics[$index] }
        if ($metric -lt $bestMetric) {
          $bestMetric = $metric
          $bestRoute = $route
        }
      }
      if ($null -ne $bestRoute) {
        $defaultGateway = [string]$bestRoute.NextHop
        $bestIndex = [int]$bestRoute.InterfaceIndex
        if ($adapterAliases.ContainsKey($bestIndex)) { $defaultInterface = [string]$adapterAliases[$bestIndex] }
      }
    } catch { $errors += ('Win32_IP4RouteTable: ' + $_.Exception.Message) }

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

    # Wi-Fi via netsh. Field labels are localized by Windows, so the parser keys
    # off the untranslated tokens that netsh always prints ("SSID", "BSSID",
    # "Mbps", "...%") and falls back to positional/value heuristics.
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
  }

  # Cumulative adapter byte counters (loopback excluded) for delta-based rates.
  # Win32_PerfRawData_Tcpip_NetworkInterface (~30 ms) exposes the same raw
  # counters as Get-NetAdapterStatistics (~1.1 s on real hardware).
  if ($wantFast) {
    try {
      $statistics = @(Get-CimInstance -ClassName Win32_PerfRawData_Tcpip_NetworkInterface -ErrorAction Stop)
      $receivedBytes = [long]0
      $sentBytes = [long]0
      $counterSeen = $false
      foreach ($statistic in $statistics) {
        $name = [string]$statistic.Name
        if ($name -match 'Loopback|isatap') { continue }
        $received = To-LongOrNull $statistic.BytesReceivedPersec
        $sent = To-LongOrNull $statistic.BytesSentPersec
        if ($null -ne $received) { $receivedBytes += $received; $counterSeen = $true }
        if ($null -ne $sent) { $sentBytes += $sent }
      }
      if ($counterSeen) {
        $counters = [ordered]@{ read = $receivedBytes; write = $sentBytes }
      }
    } catch { $errors += ('Win32_PerfRawData_Tcpip_NetworkInterface: ' + $_.Exception.Message) }
  }

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
if ($wantDetail) {
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

}
# ----------------------------------------------------------------- thermal --
# Windows exposes ACPI thermal zones through root/wmi MSAcpi_ThermalZoneTemperature
# (tenths of Kelvin). Many desktops/VMs simply do not publish any zone, which is
# reported as a null cpuCelsius plus the note 'wmi-unsupported' - never guessed.
# nvidia-smi is optional: absent/again-failing tooling just leaves gpuCelsius
# null. The Node mapper mirrors batteryCelsius from the battery block above.
$thermal = $null
try {
  $thermalSources = @()
  $thermalZones = @()
  $cpuCelsius = $null
  try {
    $rawZones = @(Get-CimInstance -Namespace 'root/wmi' -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop)
    foreach ($zone in $rawZones) {
      if ($null -eq $zone.CurrentTemperature) { continue }
      $zoneCelsius = [math]::Round(([double]$zone.CurrentTemperature / 10.0) - 273.15, 1)
      if ($zoneCelsius -lt 0 -or $zoneCelsius -gt 120) { continue }
      $thermalZones += [ordered]@{
        name = [string]$zone.InstanceName
        celsius = $zoneCelsius
      }
      if ($null -eq $cpuCelsius -or $zoneCelsius -gt $cpuCelsius) { $cpuCelsius = $zoneCelsius }
    }
    if ($null -ne $cpuCelsius) { $thermalSources += 'wmi-thermal-zone' }
  } catch {
    # Expected on many desktops/VMs: no ACPI thermal zone provider. The note
    # below says so; this is not an error worth surfacing in the UI.
    $cpuCelsius = $null
  }

  $gpuCelsius = $null
  $thermalFans = @()
  # nvidia-smi costs ~1 s per call, so only the detail probe runs it.
  if ($wantDetail) {
    try {
      $nvidiaSmi = Get-Command -Name 'nvidia-smi' -ErrorAction SilentlyContinue
      if ($null -ne $nvidiaSmi -and $nvidiaSmi.Source) {
        $nvidiaSmiPath = [string]$nvidiaSmi.Source
        $gpuRows = @(& $nvidiaSmiPath '--query-gpu=temperature.gpu,fan.speed' '--format=csv,noheader,nounits' 2>$null)
        if ($gpuRows.Count -gt 0) {
          $gpuFields = [string]$gpuRows[0] -split ','
          $gpuTemp = $null
          if ($gpuFields.Count -ge 1) {
            $parsedTemp = 0.0
            if ([double]::TryParse($gpuFields[0].Trim(), [ref]$parsedTemp)) {
              if ($parsedTemp -ge -20 -and $parsedTemp -le 150) { $gpuTemp = [math]::Round($parsedTemp, 1) }
            }
          }
          $fanPercent = $null
          if ($gpuFields.Count -ge 2) {
            $parsedFan = 0.0
            if ([double]::TryParse($gpuFields[1].Trim(), [ref]$parsedFan)) { $fanPercent = [int][math]::Round($parsedFan) }
          }
          if ($null -ne $gpuTemp) {
            $gpuCelsius = $gpuTemp
            # nvidia-smi reports fan speed as a percentage; RPM is not available,
            # so the mapper keeps name/rpm and drops the percent detail.
            $thermalFans += [ordered]@{ name = 'GPU'; rpm = $null; percent = $fanPercent }
            $thermalSources += 'nvidia-smi'
          }
        }
      }
    } catch { $errors += ('nvidia-smi: ' + $_.Exception.Message) }
  }

  $thermalNote = $null
  if ($null -eq $cpuCelsius) { $thermalNote = 'wmi-unsupported' }
  $thermal = [ordered]@{
    zones = $thermalZones
    cpuCelsius = $cpuCelsius
    gpuCelsius = $gpuCelsius
    fans = $thermalFans
    sources = $thermalSources
    note = $thermalNote
  }
} catch { $errors += ('thermal metrics: ' + $_.Exception.Message) }

# --------------------------------------------------------------- processes --
$processInfo = $null
$owners = @{}
if ($wantFast) {
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
    # keeps the payload small. Owners are filled in by the detail probe: one
    # session-scoped tasklist costs ~2.5 s on a busy host and would triple the
    # fast poll.
    $top = @($candidates | Sort-Object -Property cpuPercent -Descending | Select-Object -First 5)
    $topList = @()
    foreach ($entry in $top) {
      $topList += [ordered]@{
        pid = $entry.pid
        name = $entry.name
        cpuPercent = $entry.cpuPercent
        workingSetBytes = $entry.workingSetBytes
        user = $null
      }
    }
    $processInfo = [ordered]@{
      total = $processCount
      top = $topList
    }
  } catch { $errors += ('process metrics: ' + $_.Exception.Message) }
}

# Owner names for the fast poll's top processes (detail scope only).
if ($wantDetail) {
  try {
    $sessionId = -1
    try { $sessionId = [int](Get-Process -Id $PID -ErrorAction Stop).SessionId } catch { $sessionId = -1 }
    if ($sessionId -ge 0) {
      $taskLines = @(Invoke-NativeOem { & tasklist.exe /fo csv /v /nh /fi "SESSION eq $sessionId" 2>$null })
    } else {
      $taskLines = @(Invoke-NativeOem { & tasklist.exe /fo csv /v /nh 2>$null })
    }
    $csvLines = @()
    foreach ($line in $taskLines) {
      if ([string]$line -match '^"') { $csvLines += [string]$line }
    }
    if ($csvLines.Count -gt 0) {
      $taskRows = @($csvLines | ConvertFrom-Csv -Header 'ImageName','ProcessId','SessionName','SessionNumber','MemUsage','Status','UserName','CpuTime','WindowTitle')
      foreach ($taskRow in $taskRows) {
        $taskPid = 0
        try { $taskPid = [int]$taskRow.ProcessId } catch { $taskPid = 0 }
        if ($taskPid -le 0) { continue }
        # Only real DOMAIN\User values: tasklist localizes the "no access"
        # placeholder ("N/A" on English Windows, a translated token elsewhere).
        $owner = [string]$taskRow.UserName
        if ($owner -and $owner -match '\\') { $owners[[string]$taskPid] = $owner }
      }
    }
  } catch { $errors += ('tasklist: ' + $_.Exception.Message) }
}

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
  thermal = $thermal
  processes = $processInfo
  owners = $owners
  errors = $errors
}

$result | ConvertTo-Json -Depth 8 -Compress
