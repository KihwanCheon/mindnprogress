' AI MAINTENANCE: This is only the hidden wrapper for MindNProgress_Start.bat --hidden.
' Edit shared startup behavior and controller options in that BAT, not in this VBS.
' Runtime lifecycle logic belongs in MindNProgress\scripts\mnp-runtime.ps1.
' When changing the hidden option or exit-code contract, update BOTH BAT and VBS.
' Preserve UI differences: default BAT shows output and pauses; VBS runs hidden with error dialogs.
' Keep BOTH installation-root files synchronized with their respective repository templates
' under scripts/runtime/entrypoints/ (same filenames).
Set WshShell = CreateObject("WScript.Shell")
Set FileSystem = CreateObject("Scripting.FileSystemObject")
RootDirectory = FileSystem.GetParentFolderName(WScript.ScriptFullName)
BatchPath = FileSystem.BuildPath(RootDirectory, "MindNProgress_Start.bat")
CommandProcessorPath = WshShell.ExpandEnvironmentStrings("%SystemRoot%\System32\cmd.exe")
' In WSH //B mode, MsgBox terminates the script with code 0; guard dialogs to preserve failures.
If Not FileSystem.FileExists(BatchPath) Then
  If WScript.Interactive Then MsgBox "MindNProgress startup batch is missing: " & BatchPath, vbCritical, "MindNProgress"
  WScript.Quit 1
End If
WshShell.CurrentDirectory = RootDirectory
' Keep this wait synchronous so completion and the shared exit code reach the user.
Command = """" & CommandProcessorPath & """ /d /s /c """"" & BatchPath & """ --hidden"""
On Error Resume Next
Result = WshShell.Run(Command, 0, True)
If Err.Number <> 0 Then
  If WScript.Interactive Then MsgBox Err.Description, vbCritical, "MindNProgress"
  WScript.Quit 1
End If
On Error GoTo 0
If Result <> 0 Then
  If WScript.Interactive Then MsgBox "MindNProgress restart did not complete. Check .mindnprogress\runtime-operations.jsonl and dev.err.log. No unrelated processes were stopped.", vbExclamation, "MindNProgress"
End If
WScript.Quit Result
