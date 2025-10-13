' Start Todoissimus without a console window (hidden)
' Behavior:
' - If the server is already running, just open the browser.
' - Otherwise, start the server hidden via npm.

Dim shell, fso, repo, cmd, port, shApp
Set shell = CreateObject("WScript.Shell")
Set shApp = CreateObject("Shell.Application")
Set fso = CreateObject("Scripting.FileSystemObject")
repo = fso.GetParentFolderName(WScript.ScriptFullName)
port = 5173

' Try to read PORT from .env (simple parsing)
If fso.FileExists(repo & "\.env") Then
  On Error Resume Next
  Dim ts, line, eqPos, key, val
  Set ts = fso.OpenTextFile(repo & "\.env", 1)
  If Err.Number = 0 Then
    Do Until ts.AtEndOfStream
      line = Trim(ts.ReadLine)
      If line <> "" Then
        If Left(line,1) <> "#" And InStr(1, line, "=", vbTextCompare) > 0 Then
          eqPos = InStr(1, line, "=", vbTextCompare)
          key = LCase(Trim(Left(line, eqPos - 1)))
          val = Trim(Mid(line, eqPos + 1))
          If key = "port" And IsNumeric(val) Then
            port = CInt(val)
            Exit Do
          End If
        End If
      End If
    Loop
    ts.Close
  End If
  On Error GoTo 0
End If

' Check if server is up by attempting a quick HTTP request
Function IsUp(url)
  On Error Resume Next
  Dim x: Set x = CreateObject("MSXML2.XMLHTTP")
  x.open "GET", url, False
  x.setRequestHeader "Cache-Control", "no-cache"
  x.send
  IsUp = (x.readyState = 4 And x.status >= 200 And x.status < 400)
  On Error GoTo 0
End Function

Dim url
url = "http://localhost:" & port & "/"

If IsUp(url) Then
  ' Open default browser to the running server
  shApp.ShellExecute url, "", "", "open", 1
  Notify "Todoissimus läuft", url
Else
  ' Start the server hidden (call node directly to avoid npm issues)
  Dim nodePath
  nodePath = FindNode()
  cmd = "cmd /c cd /d """ & repo & """ && """ & nodePath & """ server.js"
  shell.Run cmd, 0, False
  ' Wait up to ~10s for the server to come up, then open browser
  Dim i
  For i = 1 To 40
    WScript.Sleep 250
    If IsUp(url) Then
      shApp.ShellExecute url, "", "", "open", 1
      Notify "Todoissimus gestartet", url
      Exit For
    End If
  Next
End If

Sub Notify(title, body)
  On Error Resume Next
  ' Simple info popup for ~3 seconds
  shell.Popup body, 3, title, 64
  On Error GoTo 0
End Sub

Function FindNode()
  On Error Resume Next
  Dim execObj, out, line
  Set execObj = shell.Exec("cmd /c where node")
  out = ""
  Do Until execObj.StdOut.AtEndOfStream
    line = Trim(execObj.StdOut.ReadLine)
    If line <> "" Then
      FindNode = line
      Exit Function
    End If
  Loop
  ' Fallback to common install path
  Dim pf
  pf = shell.ExpandEnvironmentStrings("%ProgramFiles%")
  If fso.FileExists(pf & "\nodejs\node.exe") Then
    FindNode = pf & "\nodejs\node.exe"
  Else
    ' Last resort: hope PATH works when cmd resolves it
    FindNode = "node"
  End If
  On Error GoTo 0
End Function
