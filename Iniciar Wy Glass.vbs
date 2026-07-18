' Duplo-clique pra rodar tudo (servidor + dashboard) sem nenhuma janela de console — silencioso
' quando da certo. Se algo falhar, start_all.py mostra uma caixa de erro nativa do Windows
' explicando o motivo (nao fica mudo feito os atalhos WyGlass.exe/WyGlassDashboard.exe).
Set objShell = CreateObject("WScript.Shell")
objShell.Run "cmd.exe /c cd /d ""C:\Users\bl4cks1d3\Documents\repo\claude\projects\cerebro-oculos\wy-glass"" && C:\Users\bl4cks1d3\AppData\Local\Programs\Python\Python314\pythonw.exe start_all.py", 0, False
