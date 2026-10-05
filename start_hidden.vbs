Set objShell = CreateObject("WScript.Shell")
objShell.Run "cmd.exe /c cd /d """ & CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & """ && C:\Users\bl4cks1d3\AppData\Local\Python\pythoncore-3.14-64\pythonw.exe server.py > vbs_run.log 2>&1", 0, False
