# Creates a Desktop shortcut to start Todoissimus
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'Todoissimus.lnk'
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($shortcutPath)

# Launch hidden via Windows Script Host (no console window)
$vbsPath = Join-Path $repo 'start-todoissimus.vbs'
$sc.TargetPath = "$env:WINDIR\System32\wscript.exe"
$sc.Arguments = '"' + $vbsPath + '"'
$sc.WorkingDirectory = $repo

# Optional: set an icon if you have one (e.g., icon.ico in repo)
# $sc.IconLocation = (Join-Path $repo 'icon.ico') + ",0"

$sc.Save()
Write-Host "Shortcut created:" $shortcutPath
