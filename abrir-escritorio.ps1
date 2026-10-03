# Abre uma aba do Windows Terminal por setor, cada uma rodando `claude` na pasta do setor.
# Uso: .\abrir-escritorio.ps1                 (todos os setores)
#      .\abrir-escritorio.ps1 agenda clientes  (só alguns)
param([string[]]$Setores)

$todos = [ordered]@{
  agenda    = 'Agenda'
  faculdade = 'Faculdade'
  pesquisa  = 'Pesquisa'
  projetos  = 'Projetos'
  clientes  = 'Clientes'
  pessoal   = 'Vida Pessoal'
}

if (-not $Setores) { $Setores = @($todos.Keys) }

$desconhecidos = $Setores | Where-Object { -not $todos.Contains($_) }
if ($desconhecidos) {
  Write-Error "Setor desconhecido: $($desconhecidos -join ', '). Use: $($todos.Keys -join ', ')"
  exit 1
}

if (-not (Get-Command wt -ErrorAction SilentlyContinue)) {
  Write-Error 'Windows Terminal (wt) não encontrado.'
  exit 1
}

foreach ($setor in $Setores) {
  $pasta = Join-Path $PSScriptRoot $setor
  # "-w brain-office" reaproveita a mesma janela para todas as abas.
  wt -w brain-office new-tab --title $todos[$setor] -d $pasta claude
  Start-Sleep -Milliseconds 400
}

Write-Host "Escritório: http://localhost:3456"
