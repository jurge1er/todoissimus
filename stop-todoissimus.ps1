# Stops the Todoissimus Node server by port (default 5173)
param(
  [int]$Port = 5173
)

Write-Host "Looking for process listening on port" $Port

try {
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
  if ($null -eq $conn) {
    Write-Host "No process is listening on port" $Port
    exit 0
  }
  $pid = $conn.OwningProcess
  $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
  if ($null -eq $proc) {
    Write-Host "Process with PID" $pid "not found."
    exit 0
  }
  if ($proc.ProcessName -ne 'node' -and $proc.ProcessName -ne 'node64') {
    Write-Warning "Process on port $Port is not Node (it's $($proc.ProcessName)). Aborting for safety."
    exit 1
  }
  Write-Host "Stopping Node process PID" $pid "..."
  Stop-Process -Id $pid -Force
  Write-Host "Stopped."
} catch {
  Write-Warning $_
  Write-Warning "If Get-NetTCPConnection is unavailable, try: netstat -ano | findstr :$Port"
}

