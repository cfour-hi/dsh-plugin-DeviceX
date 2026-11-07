# Device X - Windows network inventory (adapters, routes, Wi-Fi, proxy, ports).
#
# Emits exactly one JSON document on stdout (no other stdout text).
# Read-only: no admin rights, no network calls, no external modules. Wi-Fi data
# comes from local `netsh wlan show interfaces` output only.
$ErrorActionPreference = 'Stop'

$errors = @()

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

function Get-AdapterSpeedBps($adapter) {
  # Get-NetAdapter exposes `Speed` (UInt64 bits per second) and `LinkSpeed` (a
  # formatted string such as "1 Gbps"). Prefer the numeric property and parse
  # the string as a fallback; never report the formatted string as a number.
  $speed = To-LongOrNull $adapter.Speed
  if ($null -ne $speed -and $speed -gt 0) { return $speed }
  $text = [string]$adapter.LinkSpeed
  if ($text -match '^([\d.]+)\s*(bps|Kbps|Mbps|Gbps|Tbps)') {
    try { $value = [double]$matches[1] } catch { return $null }
    $unit = $matches[2]
    if ($unit -eq 'Kbps') { $value = $value * 1000 }
    elseif ($unit -eq 'Mbps') { $value = $value * 1000000 }
    elseif ($unit -eq 'Gbps') { $value = $value * 1000000000 }
    elseif ($unit -eq 'Tbps') { $value = $value * 1000000000000 }
    return [long][math]::Round($value)
  }
  return $null
}

# --------------------------------------------------------------- adapters --
$adapters = @()
try {
  $netAdapters = @(Get-NetAdapter -ErrorAction Stop)
  $loopbackAdapters = @()
  try {
    $hiddenAdapters = @(Get-NetAdapter -IncludeHidden -ErrorAction Stop)
    foreach ($hiddenAdapter in $hiddenAdapters) {
      if ([string]$hiddenAdapter.InterfaceDescription -match 'Loopback') { $loopbackAdapters += $hiddenAdapter }
    }
  } catch { $loopbackAdapters = @() }

  $ipv4Map = @{}
  $ipv6Map = @{}
  try {
    $addresses = @(Get-NetIPAddress -ErrorAction Stop)
    foreach ($address in $addresses) {
      $addressIndex = 0
      if ($null -ne $address.InterfaceIndex) { $addressIndex = [int]$address.InterfaceIndex }
      if ($addressIndex -le 0) { continue }
      if (-not $ipv4Map.ContainsKey($addressIndex)) { $ipv4Map[$addressIndex] = @() }
      if (-not $ipv6Map.ContainsKey($addressIndex)) { $ipv6Map[$addressIndex] = @() }
      $ip = [string]$address.IPAddress
      if (-not $ip) { continue }
      if ($ip -eq '127.0.0.1' -or $ip -eq '::1') { continue }
      if ($address.AddressFamily -eq 2) {
        $ipv4Map[$addressIndex] += $ip
      } elseif ($address.AddressFamily -eq 23) {
        $ipv6Map[$addressIndex] += $ip
      }
    }
  } catch { $errors += ('Get-NetIPAddress: ' + $_.Exception.Message) }

  $seenNames = @{}
  foreach ($adapter in @($netAdapters + $loopbackAdapters)) {
    $adapterName = [string]$adapter.Name
    if (-not $adapterName) { continue }
    if ($seenNames.ContainsKey($adapterName)) { continue }
    $seenNames[$adapterName] = $true
    $adapterIndex = 0
    if ($null -ne $adapter.ifIndex) { $adapterIndex = [int]$adapter.ifIndex }
    $ipv4 = @()
    if ($ipv4Map.ContainsKey($adapterIndex)) { $ipv4 = @($ipv4Map[$adapterIndex]) }
    $ipv6 = @()
    if ($ipv6Map.ContainsKey($adapterIndex)) { $ipv6 = @($ipv6Map[$adapterIndex]) }
    $mtu = $null
    if ($null -ne $adapter.MtuSize) { $mtu = [long]$adapter.MtuSize }
    $medium = $null
    if ($null -ne $adapter.NdisPhysicalMedium) { $medium = [int]$adapter.NdisPhysicalMedium }
    $adapters += [ordered]@{
      name = $adapterName
      description = [string]$adapter.InterfaceDescription
      status = [string]$adapter.Status
      mac = [string]$adapter.MacAddress
      mtu = $mtu
      ifIndex = $adapterIndex
      physical = [bool]$adapter.Physical
      virtual = [bool]$adapter.Virtual
      ndisMedium = $medium
      linkSpeedBps = Get-AdapterSpeedBps $adapter
      ipv4 = $ipv4
      ipv6 = $ipv6
    }
  }
} catch { $errors += ('Get-NetAdapter: ' + $_.Exception.Message) }

# --------------------------------------------------------- default route --
$defaultRoute = $null
try {
  # The effective Windows route metric is RouteMetric + InterfaceMetric; sort
  # by that numeric sum (not a lexicographic two-key sort) so the reported
  # default route is the real egress path when VPN / virtual adapters add
  # extra defaults.
  $routes = @(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction Stop | Sort-Object -Property @{Expression = { [long]$_.RouteMetric + [long]$_.InterfaceMetric }})
  if ($routes.Count -gt 0) {
    $route = $routes[0]
    $metric = $null
    if ($null -ne $route.RouteMetric) { $metric = [long]$route.RouteMetric }
    $routeIndex = $null
    if ($null -ne $route.ifIndex) { $routeIndex = [long]$route.ifIndex }
    $interfaceMetric = $null
    if ($null -ne $route.InterfaceMetric) { $interfaceMetric = [long]$route.InterfaceMetric }
    $defaultRoute = [ordered]@{
      gateway = [string]$route.NextHop
      interface = [string]$route.InterfaceAlias
      ifIndex = $routeIndex
      routeMetric = $metric
      interfaceMetric = $interfaceMetric
    }
  }
} catch { $errors += ('Get-NetRoute: ' + $_.Exception.Message) }

# -------------------------------------------------------------------- DNS --
$dnsServers = @()
try {
  $dnsAddresses = @(Get-DnsClientServerAddress -ErrorAction Stop)
  foreach ($dnsAddress in $dnsAddresses) {
    foreach ($server in @($dnsAddress.ServerAddresses)) {
      $serverText = [string]$server
      if (-not $serverText) { continue }
      if ($serverText -eq '::') { continue }
      if ($serverText -match '^fec0:0:0:ffff::') { continue }
      if ($dnsServers -notcontains $serverText) { $dnsServers += $serverText }
    }
  }
} catch { $errors += ('Get-DnsClientServerAddress: ' + $_.Exception.Message) }

$searchDomains = @()
try {
  $globalDns = Get-DnsClientGlobalSetting -ErrorAction Stop
  foreach ($suffix in @($globalDns.SuffixSearchList)) {
    $suffixText = [string]$suffix
    if ($suffixText -and $searchDomains -notcontains $suffixText) { $searchDomains += $suffixText }
  }
} catch {
  try {
    $dnsClients = @(Get-DnsClient -ErrorAction Stop)
    foreach ($dnsClient in $dnsClients) {
      $suffix = [string]$dnsClient.ConnectionSpecificSuffix
      if ($suffix -and $searchDomains -notcontains $suffix) { $searchDomains += $suffix }
    }
  } catch { }
}

# ------------------------------------------------------------------ proxy --
$proxy = $null
try {
  $internetSettings = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction Stop
  $proxyEnable = $false
  if ($null -ne $internetSettings.ProxyEnable) { $proxyEnable = ([int]$internetSettings.ProxyEnable -eq 1) }
  $proxy = [ordered]@{
    enable = $proxyEnable
    server = [string]$internetSettings.ProxyServer
    autoConfigUrl = [string]$internetSettings.AutoConfigURL
    bypass = [string]$internetSettings.ProxyOverride
  }
} catch { $errors += ('Internet Settings proxy: ' + $_.Exception.Message) }

# ------------------------------------------------------------------ Wi-Fi --
# netsh labels are localized; parse on the tokens Windows never translates
# ("SSID", "BSSID", "Mbps", "NN%") plus value-shape fallbacks.
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
    if ($values.Count -gt 0 -and -not $parsedWifi.name) { $parsedWifi.name = [string]$values[0].value }
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
    if ($parsedWifi.ssid -and [string]$parsedWifi.ssid -ne '') {
      if (-not $parsedWifi.state) { $parsedWifi.state = 'connected' }
      $wifi = $parsedWifi
    }
  }
} catch { $errors += ('netsh wlan show interfaces: ' + $_.Exception.Message) }

# ------------------------------------------------------- listening / sockets --
$processNames = @{}
try {
  $runningProcesses = @(Get-Process -ErrorAction SilentlyContinue)
  foreach ($process in $runningProcesses) {
    try { $processNames[[int]$process.Id] = [string]$process.ProcessName } catch { }
  }
} catch { $processNames = @{} }

$tcpListeners = @()
$establishedCount = 0
try {
  $connections = @(Get-NetTCPConnection -ErrorAction Stop)
  foreach ($connection in $connections) {
    $state = [string]$connection.State
    if ($state -eq 'Established') { $establishedCount += 1; continue }
    if ($state -ne 'Listen') { continue }
    $localPort = 0
    if ($null -ne $connection.LocalPort) { $localPort = [int]$connection.LocalPort }
    $ownerPid = 0
    if ($null -ne $connection.OwningProcess) { $ownerPid = [int]$connection.OwningProcess }
    $processName = $null
    if ($processNames.ContainsKey($ownerPid)) { $processName = $processNames[$ownerPid] }
    $tcpListeners += [ordered]@{
      address = [string]$connection.LocalAddress
      port = $localPort
      pid = $ownerPid
      process = $processName
    }
  }
} catch {
  $errors += ('Get-NetTCPConnection: ' + $_.Exception.Message)
  try {
    $listenConnections = @(Get-NetTCPConnection -State Listen -ErrorAction Stop)
    foreach ($connection in $listenConnections) {
      $localPort = 0
      if ($null -ne $connection.LocalPort) { $localPort = [int]$connection.LocalPort }
      $ownerPid = 0
      if ($null -ne $connection.OwningProcess) { $ownerPid = [int]$connection.OwningProcess }
      $processName = $null
      if ($processNames.ContainsKey($ownerPid)) { $processName = $processNames[$ownerPid] }
      $tcpListeners += [ordered]@{
        address = [string]$connection.LocalAddress
        port = $localPort
        pid = $ownerPid
        process = $processName
      }
    }
  } catch { }
}

$udpListeners = @()
try {
  $endpoints = @(Get-NetUDPEndpoint -ErrorAction Stop)
  foreach ($endpoint in $endpoints) {
    $localPort = 0
    if ($null -ne $endpoint.LocalPort) { $localPort = [int]$endpoint.LocalPort }
    if ($localPort -le 0) { continue }
    $ownerPid = 0
    if ($null -ne $endpoint.OwningProcess) { $ownerPid = [int]$endpoint.OwningProcess }
    $processName = $null
    if ($processNames.ContainsKey($ownerPid)) { $processName = $processNames[$ownerPid] }
    $udpListeners += [ordered]@{
      address = [string]$endpoint.LocalAddress
      port = $localPort
      pid = $ownerPid
      process = $processName
    }
  }
} catch { $errors += ('Get-NetUDPEndpoint: ' + $_.Exception.Message) }

# -------------------------------------------------------------------- emit --
$result = [ordered]@{
  generatedAt = ([DateTimeOffset]::UtcNow).ToUnixTimeMilliseconds()
  adapters = $adapters
  defaultRoute = $defaultRoute
  dns = [ordered]@{ servers = $dnsServers; searchDomains = $searchDomains }
  proxy = $proxy
  wifi = $wifi
  tcpListeners = $tcpListeners
  udpListeners = $udpListeners
  establishedCount = $establishedCount
  errors = $errors
}

$result | ConvertTo-Json -Depth 8 -Compress
