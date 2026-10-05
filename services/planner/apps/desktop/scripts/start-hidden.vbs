' Roda start.bat sem mostrar nenhuma janela de console -- e o que o
' atalho da area de trabalho executa. O 0 esconde a janela, o False
' faz o VBScript nao esperar o programa terminar.
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
batPath = fso.BuildPath(scriptDir, "start.bat")

Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """" & batPath & """", 0, False
