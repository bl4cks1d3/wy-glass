<#
.SYNOPSIS
  Instalador do Planner Life para Windows. Pode ser rodado de novo sem problema.

.DESCRIPTION
  Verifica Node.js e pnpm, instala as dependencias, cria o .env, compila o
  pacote compartilhado e, opcionalmente, baixa a voz local (Piper) e cria o
  atalho na area de trabalho. Linux/macOS/Raspberry Pi: use scripts/install.sh.

.PARAMETER CheckOnly
  So verifica os pre-requisitos, sem instalar nada.
.PARAMETER WithVoice
  Baixa o Piper e a voz pt-BR (~85 MB) para o TTS local.
.PARAMETER NoDesktop
  Nao instala o app Electron (pula o download de ~100 MB).
.PARAMETER Shortcut
  Cria o atalho "Planner Life" na area de trabalho (abre o app sem console).
.PARAMETER Yes
  Nao faz perguntas (usa os padroes; nao pede chave de IA).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\install.ps1
  powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -WithVoice -Shortcut
#>
[CmdletBinding()]
param(
  [switch]$CheckOnly,
  [switch]$WithVoice,
  [switch]$NoDesktop,
  [switch]$Shortcut,
  [switch]$Yes
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest fica muito lento com a barra de progresso

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$MinNodeMajor = 22
$MinNodeMinor = 5
$PiperRelease = '2023.11.14-2'

function Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "  [ok] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "  [aviso] $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "  [erro] $msg" -ForegroundColor Red; exit 1 }

$Interactive = (-not $Yes) -and [Environment]::UserInteractive -and (-not [Console]::IsInputRedirected)

function Test-Command($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }

# native commands nao respeitam $ErrorActionPreference: checa o codigo de saida.
function Invoke-Native {
  param([string]$File, [string[]]$Arguments)
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) { Fail "'$File $($Arguments -join ' ')' falhou (codigo $LASTEXITCODE)." }
}

function Read-EnvLines { return @(Get-Content -LiteralPath (Join-Path $Root '.env') -Encoding UTF8) }

# Troca (ou acrescenta) KEY=valor no .env sem interpretar o valor como regex/escape.
function Set-EnvValue([string]$Key, [string]$Value) {
  $path = Join-Path $Root '.env'
  $lines = New-Object System.Collections.Generic.List[string]
  $found = $false
  foreach ($line in (Read-EnvLines)) {
    if ($line.StartsWith("$Key=")) { $lines.Add("$Key=$Value"); $found = $true } else { $lines.Add($line) }
  }
  if (-not $found) { $lines.Add("$Key=$Value") }
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllLines($path, $lines.ToArray(), $utf8NoBom)
}

function Get-EnvValue([string]$Key) {
  foreach ($line in (Read-EnvLines)) {
    if ($line.StartsWith("$Key=")) { return $line.Substring($Key.Length + 1).Trim() }
  }
  return ''
}

function Read-Secret([string]$Prompt) {
  $secure = Read-Host -Prompt $Prompt -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# ---------------------------------------------------------------- pre-requisitos
Step 'Verificando pre-requisitos'

if (-not (Test-Command 'node')) {
  Fail "Node.js nao encontrado. Instale a versao $MinNodeMajor.$MinNodeMinor+ (https://nodejs.org ou 'winget install OpenJS.NodeJS') e rode de novo."
}
$nodeVersion = (& node -v).TrimStart('v')
$nodeParts = $nodeVersion.Split('.')
$nodeMajor = [int]$nodeParts[0]
$nodeMinor = [int]$nodeParts[1]
if (($nodeMajor -lt $MinNodeMajor) -or (($nodeMajor -eq $MinNodeMajor) -and ($nodeMinor -lt $MinNodeMinor))) {
  Fail "Node.js $nodeVersion e antigo demais: o Core usa node:sqlite e exige $MinNodeMajor.$MinNodeMinor+."
}
Ok "Node.js $nodeVersion"

if (-not (Test-Command 'pnpm')) {
  if ($CheckOnly) {
    Warn 'pnpm nao encontrado (o instalador tentaria ativar via corepack)'
  } else {
    Warn 'pnpm nao encontrado, ativando via corepack...'
    if (Test-Command 'corepack') {
      try { & corepack enable 2>$null | Out-Null } catch { }
      try { & corepack prepare pnpm@latest --activate 2>$null | Out-Null } catch { }
    }
    if (-not (Test-Command 'pnpm') -and (Test-Command 'npm')) {
      Warn "corepack nao ativou o pnpm; tentando 'npm install -g pnpm'..."
      try { & npm install -g pnpm 2>$null | Out-Null } catch { }
    }
    if (-not (Test-Command 'pnpm')) {
      Fail "Nao consegui instalar o pnpm. Rode 'npm install -g pnpm' (pode exigir PowerShell como administrador), abra um novo terminal e rode de novo."
    }
  }
}
if (Test-Command 'pnpm') { Ok "pnpm $((& pnpm -v).Trim())" }

if (Test-Command 'git') { Ok "git $((& git --version) -replace 'git version ','')" } else { Warn 'git nao encontrado (so necessario para atualizar o projeto)' }

if (Test-Command 'claude') {
  Ok 'Claude Code CLI encontrado (Terminal e Pesquisa vao funcionar)'
} elseif (Test-Path (Join-Path $env:APPDATA 'Claude\claude-code')) {
  Ok 'Claude Code (app desktop) encontrado (Terminal e Pesquisa vao funcionar)'
} else {
  Warn "Claude Code nao encontrado: a aba Terminal e a pesquisa por tema precisam dele (https://claude.com/claude-code). O resto funciona sem."
}

if ($CheckOnly) {
  Step 'Modo -CheckOnly: nada foi instalado.'
  exit 0
}

# ---------------------------------------------------------------- dependencias
Step 'Instalando dependencias (pnpm install)'
if ($NoDesktop) {
  Invoke-Native 'pnpm' @('install', '--filter', '!@planner-life/desktop')
} else {
  Invoke-Native 'pnpm' @('install')
}
Ok 'dependencias instaladas'

# ---------------------------------------------------------------- .env
Step 'Configurando o .env'
$envPath = Join-Path $Root '.env'
if (Test-Path -LiteralPath $envPath) {
  Ok '.env ja existe, mantido como esta'
} else {
  Copy-Item -LiteralPath (Join-Path $Root '.env.example') -Destination $envPath
  Ok '.env criado a partir do .env.example'

  if ($Interactive) {
    Write-Host ''
    Write-Host '  O chat precisa de uma chave de IA. Groq e Gemini tem free tier.'
    Write-Host '  Groq:   https://console.groq.com/keys'
    Write-Host '  Gemini: https://aistudio.google.com/apikey'
    Write-Host '  (Enter pula; voce pode preencher depois na aba Configuracoes.)'
    $groq = Read-Secret '  Chave do Groq'
    if ($groq) {
      Set-EnvValue 'GROQ_API_KEY' $groq
      Ok 'GROQ_API_KEY gravada no .env'
    } else {
      $gemini = Read-Secret '  Chave do Gemini'
      if ($gemini) {
        Set-EnvValue 'GEMINI_API_KEY' $gemini
        Ok 'GEMINI_API_KEY gravada no .env'
      } else {
        Warn 'nenhuma chave informada: o chat so funciona depois de configurar uma.'
      }
    }
    $groq = $null; $gemini = $null
  } else {
    Warn 'modo sem perguntas: preencha uma chave de IA no .env ou na aba Configuracoes.'
  }
}

# ---------------------------------------------------------------- shared
Step 'Compilando o pacote compartilhado'
Invoke-Native 'pnpm' @('--filter', '@planner-life/shared', 'build')
Ok '@planner-life/shared compilado'

# ---------------------------------------------------------------- voz (opcional)
function Install-Voice {
  $vendor = Join-Path $Root 'packages\voice\vendor'
  New-Item -ItemType Directory -Force -Path (Join-Path $vendor 'models') | Out-Null

  $piperExe = Join-Path $vendor 'piper\piper.exe'
  if (-not (Test-Path -LiteralPath $piperExe)) {
    Write-Host '  baixando Piper (piper_windows_amd64.zip)...'
    $zip = Join-Path $vendor 'piper.zip'
    Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/rhasspy/piper/releases/download/$PiperRelease/piper_windows_amd64.zip" -OutFile $zip
    Expand-Archive -LiteralPath $zip -DestinationPath $vendor -Force
    Remove-Item -LiteralPath $zip -Force
  }
  $model = Join-Path $vendor 'models\pt_BR-faber-medium.onnx'
  if (-not (Test-Path -LiteralPath $model)) {
    Write-Host '  baixando a voz pt_BR-faber-medium...'
    $base = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/faber/medium/pt_BR-faber-medium'
    Invoke-WebRequest -UseBasicParsing -Uri "$base.onnx" -OutFile $model
    Invoke-WebRequest -UseBasicParsing -Uri "$base.onnx.json" -OutFile "$model.json"
  }
  if (-not (Test-Path -LiteralPath $piperExe)) { Fail "piper.exe nao encontrado em $piperExe apos a extracao." }
  Ok 'Piper e voz pt_BR-faber-medium instalados (os caminhos padrao do servico ja apontam para eles)'
}

if ($WithVoice) {
  Step 'Instalando a voz local (Piper)'
  Install-Voice
} elseif ($Interactive) {
  Write-Host ''
  $reply = Read-Host 'Baixar a voz local (Piper, ~85 MB) agora? [s/N]'
  if ($reply -match '^(s|S|y|Y)') {
    Step 'Instalando a voz local (Piper)'
    Install-Voice
  } else {
    Warn 'voz pulada (rode de novo com -WithVoice quando quiser)'
  }
}

# ---------------------------------------------------------------- atalho (opcional)
function New-DesktopShortcut {
  $vbs = Join-Path $Root 'apps\desktop\scripts\start-hidden.vbs'
  if (-not (Test-Path -LiteralPath $vbs)) { Warn "start-hidden.vbs nao encontrado em $vbs; atalho nao criado."; return }
  $desktop = [Environment]::GetFolderPath('Desktop')
  $lnk = Join-Path $desktop 'Planner Life.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $sc = $shell.CreateShortcut($lnk)
  $sc.TargetPath = $vbs
  $sc.WorkingDirectory = Split-Path -Parent $vbs
  $sc.Description = 'Planner Life'
  $sc.Save()
  Ok "atalho criado em $lnk"
}

if ($Shortcut) {
  Step 'Criando o atalho na area de trabalho'
  New-DesktopShortcut
} elseif ($Interactive -and -not $NoDesktop) {
  Write-Host ''
  $reply = Read-Host 'Criar atalho "Planner Life" na area de trabalho? [s/N]'
  if ($reply -match '^(s|S|y|Y)') { New-DesktopShortcut }
}

# ---------------------------------------------------------------- pasta de dados
New-Item -ItemType Directory -Force -Path (Join-Path $Root 'data') | Out-Null
Ok 'pasta data\ pronta (banco SQLite e vault local ficam aqui)'

# ---------------------------------------------------------------- fim
Write-Host ''
Write-Host 'Instalacao concluida.' -ForegroundColor Green
Write-Host ''
Write-Host 'Proximos passos:'
Write-Host '  pnpm dev            # core :4000, agent :4100, voice :4200, web :4300'
Write-Host '  pnpm dev:p2p        # (opcional) no P2P, em outro terminal'
Write-Host '  pnpm desktop        # (opcional) app em janela, sobe tudo sozinho'
Write-Host ''
Write-Host 'Abra http://localhost:4300'
Write-Host ''
Write-Host 'Pendencias:'
if (-not ((Get-EnvValue 'GROQ_API_KEY') -or (Get-EnvValue 'GEMINI_API_KEY') -or (Get-EnvValue 'ANTHROPIC_API_KEY'))) {
  Write-Host '  - configurar uma chave de IA (aba Configuracoes ou .env)'
}
if (-not (Get-EnvValue 'GOOGLE_CLIENT_ID')) {
  Write-Host '  - (opcional) Google: preencher GOOGLE_CLIENT_ID/SECRET, ver docs\CONFIGURATION.md secao 4'
}
Write-Host '  Documentacao: docs\README.md'
exit 0
