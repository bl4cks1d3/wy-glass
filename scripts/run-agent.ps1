<#
  Runs My Current Brain tasks headless with Claude Code — billed to your Claude subscription
  (Pro/Max), not to the API. Each phase runs as its own subagent with its own MCP roles, so it
  only loads the tools it needs.

  Usage:
    powershell -File scripts/run-agent.ps1 -Task daily        # 5 phases in sequence
    powershell -File scripts/run-agent.ps1 -Task weekly
    powershell -File scripts/run-agent.ps1 -Task catchup
    powershell -File scripts/run-agent.ps1 -Task lesson
    powershell -File scripts/run-agent.ps1 -Task plan
    powershell -File scripts/run-agent.ps1 -Task "research: agent memory"   # generalist agent
    powershell -File scripts/run-agent.ps1 -Task daily -Legacy              # old single agent, all tools (baseline)

  Schedule it (Windows Task Scheduler) with scripts/schedule-agent.ps1.
  Every phase appends a line to logs/runs.jsonl (duration, turns, errors) — see /agent in the app.
#>
param(
  [string]$Task = "daily",
  [string]$Model = "",
  [switch]$Legacy,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# Claude Code prefers ANTHROPIC_API_KEY over your claude.ai login when it is set.
# Clear it for this process so the run always uses the subscription.
Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:ANTHROPIC_AUTH_TOKEN -ErrorAction SilentlyContinue

$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force $logDir | Out-Null
$stamp = Get-Date -Format "yyyy-MM-dd_HHmm"

# Task → phases (agent, MCP roles, prompt). Roles mirror the `roles:` frontmatter of each agent.
$phases = switch -Regex ($Task) {
  "^daily$" {
    if ($Legacy) { @(@{ Agent = "brain-curator"; Roles = "all"; Prompt = "Execute a tarefa ``daily`` do My Current Brain seguindo suas instrucoes." }) }
    else {
      @(
        @{ Agent = "brain-collector"; Roles = "ingest,people"; Prompt = "Execute a fase de coleta do ciclo diario." },
        @{ Agent = "brain-triage"; Roles = "triage"; Prompt = "Execute a fase de triagem do ciclo diario." },
        @{ Agent = "brain-lesson"; Roles = "learn"; Prompt = "Escreva as aulas sem conteudo e revise as respostas de exercicios pendentes." },
        @{ Agent = "brain-planner"; Roles = "learn,build"; Prompt = "Planeje as metas com status new. Sugira 3 projetos so se nao houver sugestao pendente." },
        @{ Agent = "brain-briefer"; Roles = "brief"; Prompt = "Publique o Daily Brief de hoje." }
      )
    }
  }
  "^weekly$" { @(@{ Agent = "brain-weekly"; Roles = "triage,learn,people,brief"; Prompt = "Execute o Weekly Brain." }) }
  "^catchup" { @(@{ Agent = "brain-catchup"; Roles = "catchup"; Prompt = "Execute o catch-up: $($Task -replace '^catchup:?\s*', '')" }) }
  "^lesson" { @(@{ Agent = "brain-lesson"; Roles = "learn"; Prompt = "Escreva as aulas: $($Task -replace '^lesson:?\s*', '')" }) }
  "^plan" { @(@{ Agent = "brain-planner"; Roles = "learn,build"; Prompt = "Planeje: $($Task -replace '^plan:?\s*', '')" }) }
  "^projects" { @(@{ Agent = "brain-planner"; Roles = "learn,build"; Prompt = "Sugira 3 projetos: $($Task -replace '^projects:?\s*', '')" }) }
  default { @(@{ Agent = "brain-curator"; Roles = "all"; Prompt = "Execute a tarefa ``$Task`` do My Current Brain seguindo suas instrucoes." }) }
}

$utf8 = New-Object System.Text.UTF8Encoding($false)  # no BOM: JSON readers choke on it
$failed = 0
foreach ($ph in $phases) {
  $agent = $ph.Agent
  $log = Join-Path $logDir "$stamp-$agent.log"

  # Per-phase MCP config: same server name (tool names stay mcp__current-brain__*), scoped roles.
  $mcpEnv = @{ MCB_ROLES = $ph.Roles; MCB_AGENT = $agent }
  if ($Env:MCB_DB_PATH) { $mcpEnv.MCB_DB_PATH = $Env:MCB_DB_PATH }
  $mcpFile = Join-Path $logDir "mcp-$agent.json"
  $mcpConfig = @{ mcpServers = @{ "current-brain" = @{ type = "stdio"; command = "node"; args = @("--no-warnings", "--import", "tsx", "apps/mcp/src/index.ts"); env = $mcpEnv } } }
  [IO.File]::WriteAllText($mcpFile, ($mcpConfig | ConvertTo-Json -Depth 6), $utf8)

  $claudeArgs = @(
    "-p", "$($ph.Prompt) Termine com um resumo de 3 linhas.",
    "--agent", $agent,
    "--mcp-config", $mcpFile,
    "--strict-mcp-config",
    "--allowedTools", "mcp__current-brain", "WebFetch", "WebSearch", "Skill",
    "--output-format", "json"
  )
  if ($Model) { $claudeArgs += @("--model", $Model) }

  if ($DryRun) { "claude $($claudeArgs -join " ")"; Get-Content $mcpFile; continue }
  "[$(Get-Date -Format o)] $agent roles=$($ph.Roles)" | Tee-Object -FilePath $log
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $out = & claude @claudeArgs 2>&1 | Out-String
  $code = $LASTEXITCODE
  $sw.Stop()
  [IO.File]::AppendAllText($log, $out, $utf8)

  # Structured record for the metrics page.
  $result = $null
  try { $result = ($out.Substring($out.IndexOf("{")) | ConvertFrom-Json) } catch {}
  $rec = [ordered]@{
    at = (Get-Date).ToUniversalTime().ToString("o"); task = $Task; agent = $agent; roles = $ph.Roles; legacy = [bool]$Legacy
    seconds = [math]::Round($sw.Elapsed.TotalSeconds, 1); exit = $code
    turns = $result.num_turns; isError = if ($result) { [bool]$result.is_error } else { $code -ne 0 }
    durationMs = $result.duration_ms; summary = if ($result.result) { ($result.result -split "`n")[0] } else { $null }
  }
  [IO.File]::AppendAllText((Join-Path $logDir "runs.jsonl"), ($rec | ConvertTo-Json -Compress) + "`n", $utf8)
  "[$(Get-Date -Format o)] $agent exit=$code $([math]::Round($sw.Elapsed.TotalSeconds))s" | Tee-Object -FilePath $log -Append
  if ($code -ne 0) { $failed++ }  # keep going: the next phases still have work to do
}
exit $failed
