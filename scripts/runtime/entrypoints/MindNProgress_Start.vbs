Set WshShell = CreateObject("WScript.Shell")
Set FileSystem = CreateObject("Scripting.FileSystemObject")
RootDirectory = FileSystem.GetParentFolderName(WScript.ScriptFullName)
ControllerPath = FileSystem.BuildPath(RootDirectory, "MindNProgress\scripts\mnp-runtime.ps1")
PowerShellPath = WshShell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")
If Not FileSystem.FileExists(ControllerPath) Then
  MsgBox "MindNProgress runtime controller is missing: " & ControllerPath, vbCritical, "MindNProgress"
  WScript.Quit 1
End If
WshShell.CurrentDirectory = RootDirectory
' This user-facing entrypoint keeps its restart-and-open-browser behavior.
' AI operations use the same controller with an explicit start/stop/restart action.
Command = """" & PowerShellPath & """ -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & ControllerPath & """ -Action restart -AllowLegacyStop -OpenBrowser"
On Error Resume Next
Result = WshShell.Run(Command, 0, True)
If Err.Number <> 0 Then
  MsgBox Err.Description, vbCritical, "MindNProgress"
  WScript.Quit 1
End If
On Error GoTo 0
If Result <> 0 Then
  MsgBox "MindNProgress restart did not complete. Check .mindnprogress\runtime-operations.jsonl and dev.err.log. No unrelated processes were stopped.", vbExclamation, "MindNProgress"
End If
WScript.Quit Result
