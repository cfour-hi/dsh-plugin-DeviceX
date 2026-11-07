# Device X - Windows process inventory (perf counters + CIM + tasklist owners).
#
# Emits exactly one JSON document on stdout (no other stdout text).
# Read-only: no admin rights, no network calls, no external modules.
# CPU percent is reported in Task-Manager scale (raw perf counter divided by the
# logical processor count); the Node mapper normalizes and rounds again.
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

$logicalCores = 0
try { $logicalCores = [int]$env:NUMBER_OF_PROCESSORS } catch { $logicalCores = 0 }
if ($logicalCores -le 0) { $logicalCores = 0 }

$totalMemoryBytes = $null
try {
  $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
  if ($null -ne $os.TotalVisibleMemorySize) { $totalMemoryBytes = To-LongOrNull ([long]$os.TotalVisibleMemorySize * 1024) }
} catch { $errors += ('Win32_OperatingSystem: ' + $_.Exception.Message) }

# --- perf counters: instantaneous CPU percent + private working set ----------
$perfMap = @{}
try {
  $processPerf = @(Get-CimInstance -ClassName Win32_PerfFormattedData_PerfProc_Process -ErrorAction Stop)
  foreach ($row in $processPerf) {
    $processId = 0
    if ($null -ne $row.IDProcess) { $processId = [int]$row.IDProcess }
    if ($processId -le 0) { continue }
    $rawName = [string]$row.Name
    if ($rawName -eq '_Total' -or $rawName -eq 'Idle') { continue }
    $perfMap[$processId] = [pscustomobject]@{
      name = ($rawName -replace '#\d+$', '')
      percentProcessorTime = To-LongOrNull $row.PercentProcessorTime
      workingSetPrivate = To-LongOrNull $row.WorkingSetPrivate
      workingSet = To-LongOrNull $row.WorkingSet
    }
  }
} catch { $errors += ('Win32_PerfFormattedData_PerfProc_Process: ' + $_.Exception.Message) }

# --- CIM: identity, parent, command line, creation date ---------------------
$cimProcesses = @()
try {
  $cimProcesses = @(Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,Name,CommandLine,CreationDate,WorkingSetSize,ExecutablePath -ErrorAction Stop)
} catch { $errors += ('Win32_Process: ' + $_.Exception.Message) }

# --- tasklist: per-process user names (no elevation required) ---------------
$userMap = @{}
try {
  $taskLines = @(Invoke-NativeOem { & tasklist.exe /fo csv /v /nh 2>$null })
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
      $userName = [string]$taskRow.UserName
      if ($userName -and $userName -ne 'N/A') { $userMap[$taskPid] = $userName }
    }
  }
} catch { $errors += ('tasklist: ' + $_.Exception.Message) }

# --- Get-Process: responsiveness + total count ------------------------------
$respondsMap = @{}
$getProcessCount = 0
try {
  $allProcesses = @(Get-Process -ErrorAction SilentlyContinue)
  $getProcessCount = $allProcesses.Count
  foreach ($process in $allProcesses) {
    $processId = [int]$process.Id
    try {
      $respondsMap[$processId] = [bool]$process.Responding
    } catch { }
  }
} catch { $respondsMap = @{} }

# --- merge ------------------------------------------------------------------
$rows = @()
$nowMs = ([DateTimeOffset]::UtcNow).ToUnixTimeMilliseconds()
foreach ($process in $cimProcesses) {
  $processId = 0
  if ($null -ne $process.ProcessId) { $processId = [int]$process.ProcessId }
  if ($processId -le 0) { continue }
  $name = [string]$process.Name
  if (-not $name) {
    if ($perfMap.ContainsKey($processId)) { $name = [string]$perfMap[$processId].name }
  }
  if (-not $name) { $name = 'unknown' }
  $cpuPercent = 0.0
  $workingSetBytes = $null
  if ($perfMap.ContainsKey($processId)) {
    $perfRow = $perfMap[$processId]
    if ($null -ne $perfRow.percentProcessorTime) { $cpuPercent = [double]$perfRow.percentProcessorTime }
    if ($null -ne $perfRow.workingSetPrivate) { $workingSetBytes = To-LongOrNull $perfRow.workingSetPrivate }
    if ($null -eq $workingSetBytes -and $null -ne $perfRow.workingSet) { $workingSetBytes = To-LongOrNull $perfRow.workingSet }
  }
  if ($null -eq $workingSetBytes) { $workingSetBytes = To-LongOrNull $process.WorkingSetSize }
  $user = $null
  if ($userMap.ContainsKey($processId)) { $user = $userMap[$processId] }
  $state = 'running'
  if ($respondsMap.ContainsKey($processId) -and $respondsMap[$processId] -eq $false) { $state = 'not responding' }
  $command = [string]$process.CommandLine
  if (-not $command) { $command = [string]$process.ExecutablePath }
  if (-not $command) { $command = $name }
  $creationMs = To-EpochMs $process.CreationDate
  $elapsed = $null
  if ($null -ne $creationMs -and $nowMs -gt $creationMs) {
    $elapsed = [long][math]::Floor(($nowMs - $creationMs) / 1000)
  }
  $parentId = $null
  if ($null -ne $process.ParentProcessId) { $parentId = [int]$process.ParentProcessId }
  $rows += [ordered]@{
    pid = $processId
    ppid = $parentId
    name = $name
    command = $command
    cpuPercent = $cpuPercent
    workingSetBytes = $workingSetBytes
    user = $user
    state = $state
    creationDateMs = $creationMs
    elapsed = $elapsed
  }
}

$total = $getProcessCount
if ($rows.Count -gt $total) { $total = $rows.Count }

# -------------------------------------------------------------------- emit --
$result = [ordered]@{
  generatedAt = ([DateTimeOffset]::UtcNow).ToUnixTimeMilliseconds()
  totalMemoryBytes = $totalMemoryBytes
  logicalCores = $logicalCores
  total = $total
  processes = $rows
  errors = $errors
}

$result | ConvertTo-Json -Depth 8 -Compress
