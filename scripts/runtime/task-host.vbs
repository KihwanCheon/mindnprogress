Option Explicit
Dim Shell, Files, NodePath, LauncherPath, Command, Result
Set Shell = CreateObject("WScript.Shell")
Set Files = CreateObject("Scripting.FileSystemObject")
If WScript.Arguments.Count <> 2 Then WScript.Quit 1
NodePath = WScript.Arguments(0)
LauncherPath = WScript.Arguments(1)
If Not Files.FileExists(NodePath) Then WScript.Quit 1
If Not Files.FileExists(LauncherPath) Then WScript.Quit 1
Shell.CurrentDirectory = Files.GetParentFolderName(LauncherPath)
Command = """" & NodePath & """ """ & LauncherPath & """"
' The GUI host sets the initial child window style, before Node starts.
' Wait for the long-lived launcher: the scheduled task must own its lifetime.
On Error Resume Next
Result = Shell.Run(Command, 0, True)
If Err.Number <> 0 Then WScript.Quit 1
On Error GoTo 0
WScript.Quit Result
