# Stops the Todoissimus Node server by port (default 5173)
param(
  [int]$Port = 5173
)

Write-Host "Looking for process listening on port" $Port

function Stop-ByPid([int]$TargetPid) {
  if ($TargetPid -le 0) { return }
  $p = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
  if ($null -eq $p) {
    Write-Host "Process with PID" $TargetPid "not found."
    return
  }
  if ($p.ProcessName -ne 'node' -and $p.ProcessName -ne 'node64') {
    Write-Warning "Process on port $Port is not Node (it's $($p.ProcessName)). Aborting for safety."
    return
  }
  Write-Host "Stopping Node process PID" $TargetPid "..."
  Stop-Process -Id $TargetPid -Force
  Write-Host "Stopped."
}

try {
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
  if ($null -ne $conn) {
    $owningPid = [int]$conn.OwningProcess
    Stop-ByPid -TargetPid $owningPid
    exit 0
  }
  Write-Host "No process is listening on port" $Port
  exit 0
} catch {
  Write-Warning $_
  Write-Warning "Falling back to netstat parsing..."
  try {
    $line = (netstat -ano | Select-String ":$Port" | Select-Object -First 1)
    if ($null -ne $line) {
      $parts = ($line.ToString() -replace "\s+"," ").Trim().Split(' ')
      $last = $parts[$parts.Length-1]
      $parsed = 0
      if ([int]::TryParse($last, [ref]$parsed)) {
        Stop-ByPid -TargetPid $parsed
        exit 0
      }
    }
    Write-Host "No matching netstat entry for port" $Port
  } catch {
    Write-Warning $_
    Write-Warning "If Get-NetTCPConnection is unavailable, try: netstat -ano | findstr :$Port and taskkill /PID <pid> /F"
  }
}

