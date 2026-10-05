# Personal Agent

O `@planner-life/agent` é o "Jarvis": um runtime de IA que conversa em
português, chama ferramentas que operam o Core, carrega Skills, conecta em
servidores MCP, delega tarefas de código ao Claude Code e dispara avisos
proativos. Ele **não acessa o banco** — só conversa com o Core por HTTP.

## 1. Providers de IA

| Provider | Chave | Modelo padrão (`*_MODEL`) | SDK | Observações |
| --- | --- | --- | --- | --- |
| `groq` | `GROQ_API_KEY` | `openai/gpt-oss-120b` | `openai` com `baseURL` do Groq | Free tier; API compatível com OpenAI |
| `gemini` | `GEMINI_API_KEY` | `gemini-2.0-flash` | `@google/generative-ai` | Free tier (AI Studio) |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-5` | `@anthropic-ai/sdk` | Pago; `max_tokens` = 1024 por resposta |

**Seleção** (`providers/index.ts`): `AGENT_PROVIDER` (`groq|gemini|anthropic`)
se definido; senão a primeira chave existente na ordem Groq → Gemini →
Anthropic; se nenhuma, assume Groq e falha na primeira mensagem com uma
mensagem orientando a configurar uma chave. O provider é criado na **primeira
mensagem** (não no boot), então `/health` responde mesmo sem chaves.

Os catálogos de modelos gratuitos mudam com frequência — ajuste `*_MODEL`.

### Laço de tool-use

Todos os providers fazem o mesmo laço: envia histórico + ferramentas → se o
modelo pedir ferramentas, executa cada uma via `ToolRegistry.call` → devolve
os resultados → repete até haver resposta em texto. Erros de ferramenta
viram `{"error": "..."}` para o modelo, sem derrubar a conversa.

**Estado:** o histórico é uma lista **em memória, única e global** por
processo (sem truncamento; some ao reiniciar). O resumo da manhã e o comando
rápido usam o mesmo histórico do chat. Ver [SPEC.md §8 (L2, L3)](SPEC.md).

## 2. Comportamento (system prompt)

Definido em `packages/agent/src/tools.ts` (`SYSTEM_PROMPT`). Regras que
importam:

1. Responder sempre em português, direto e útil; **não inventar dados** — usar ferramenta.
2. **Pesquisa:** para "pesquisar/resumir/escrever sobre" usar **sempre** `create_research_note` (nota + artigo vinculado), nunca `create_note` sozinho (deixaria a nota órfã, invisível no dashboard). `create_note` é só para anotações soltas.
3. **Código/terminal:** usar `run_claude_code`, que **não executa** — cria um pedido pendente; o agente deve avisar o usuário disso.
4. **Formato:** texto simples — sem tabelas, sem `#`, sem blocos de código; listas com `-`.

O catálogo de Skills é anexado ao prompt (`ToolRegistry.systemPrompt()`).

## 3. Catálogo de ferramentas nativas (65)

Todas chamam o Core (exceto `run_claude_code` e `use_skill`, tratadas no
`ToolRegistry`). Parâmetros obrigatórios em **negrito**.

### Tarefas (5)
| Ferramenta | Parâmetros |
| --- | --- |
| `create_task` | **title**, projectId, dueAt, notes |
| `list_tasks` | status, projectId |
| `complete_task` | **taskId** |
| `update_task` | **taskId**, title, projectId, dueAt, notes |
| `delete_task` | **taskId** |

### Projetos (4)
`create_project` (**name**, goal) · `list_projects` · `update_project` (**projectId**, name, goal, progress) · `delete_project` (**projectId**; apaga as tarefas)

### Memória (3)
`save_memory` (**content**, tags) · `list_memory` · `delete_memory` (**memoryId**)

### CRM (4)
`create_client` (**name**, stage, value, nextAction, nextActionAt) · `list_clients` · `update_client` (**clientId**, stage, value, nextAction, nextActionAt) · `delete_client` (**clientId**)

### Estudos (14)
| Grupo | Ferramentas |
| --- | --- |
| Disciplinas | `create_subject` (**name**, note, examDate) · `list_subjects` · `update_subject` (**subjectId**, progress, note, examDate) · `delete_subject` (**subjectId**) |
| Tópicos e entregas | `create_study_topic` (**subjectId**, **title**, dueAt) · `list_study_topics` (subjectId) · `set_study_topic_done` (**topicId**, **done**) · `delete_study_topic` (**topicId**) |
| Cronograma | `create_schedule_block` (**subjectId**, **dayOfWeek**, **startTime**, **endTime**) · `list_schedule` · `delete_schedule_block` (**blockId**) |
| Sessões | `list_study_sessions` (days, padrão 30) · `delete_study_session` (**sessionId**) · `log_study_session` (**durationMinutes**, subjectId) |

`log_study_session` calcula `startedAt = agora − duração` e `endedAt = agora`.
`create_study_topic` com `dueAt` cria uma entrega/leitura.

### Pesquisa (9)
`create_research_line` (**name**, stage, nextStep) · `list_research_lines` · `update_research_line` (**lineId**, stage, nextStep) · `delete_research_line` (**lineId**) · `create_paper` (**title**, source, researchLineId) · `list_papers` (researchLineId) · `update_paper_status` (**paperId**, **status**) · `delete_paper` (**paperId**) · **`create_research_note`** (**title**, **content**, researchLineId)

`create_research_note` grava `Pesquisas/<slug>-<timestamp>.md` no vault e cria
o artigo com `status: "resumido"` e `notePath`.

### Hábitos (4)
`create_habit` (**name**, unit, target) · `list_habits` · `update_habit` (**habitId**, current, target) · `delete_habit` (**habitId**)

### Inbox (5)
`list_messages` · `read_email` (**messageId**; devolve só o texto, sem HTML) · `mark_message_handled` (**messageId**, **handled**) · `delete_message` (**messageId**; só local) · `clear_inbox` (só quando o usuário pedir explicitamente)

### Google Tasks (4)
`list_google_tasks` · `create_google_task` (**title**, notes, due, account) · `update_google_task` (**taskId**, title, notes, due, status, account) · `delete_google_task` (**taskId**, account)

### Google Calendar (4) e conta (3)
`list_calendar_events` (limit) · `create_calendar_event` (**title**, **start**, **end**, description, account) · `update_calendar_event` (**eventId**, title, start, end, description, account) · `delete_calendar_event` (**eventId**, account)
`check_google_status` · `sync_gmail` (limit, account) · `disconnect_google_account` (**email**)

### Notas / vault (5)
`list_notes` · `read_note` (**path**) · `search_notes` (**query**) · `create_note` (**path**, **content**) · `delete_note` (**path**)

### Claude Code (1)
`run_claude_code` (**prompt**, cwd) → devolve `{status: "aguardando_confirmacao", actionId, aviso}`. **Nada é executado.**

### Ferramentas dinâmicas
- `use_skill` (**name**) — só existe se houver Skills carregadas.
- `mcp__<servidor>__<ferramenta>` — uma por ferramenta de cada servidor MCP conectado.

## 4. Skills

Uma Skill é um pacote de instruções carregado **sob demanda**:

```
packages/agent/skills/<nome>/SKILL.md
```

```markdown
---
name: revisao-semanal
description: Faz uma revisão semanal das tarefas e projetos…
---

Ao executar esta skill:
1. Use `list_tasks` …
```

- O **catálogo** (`- nome: descrição`) fica sempre no system prompt.
- O **corpo** só entra no contexto quando o modelo chama `use_skill`.
- O frontmatter é parseado de forma simples (`chave: valor` por linha). Sem `name`, vale o nome da pasta.
- Carregadas no boot; para criar/editar uma skill é preciso reiniciar o Agent.

Skill incluída: `revisao-semanal` (concluído × atrasado × próxima semana; usada pelo atalho "Faz minha revisão semanal").

## 5. MCP (Model Context Protocol)

Servidores externos em `.mcp.json` na raiz (mesmo formato do Claude Code):

```json
{
  "mcpServers": {
    "everything": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-everything"],
      "env": { "CHAVE": "valor" }
    }
  }
}
```

- Conexão por **stdio** no boot; cada ferramenta vira `mcp__<servidor>__<ferramenta>`.
- Falha ao conectar um servidor gera só um aviso no log.
- A resposta de `callTool` é o texto concatenado das partes `text` (ou o resultado bruto).
- Hoje o arquivo está com `"mcpServers": {}` (nenhum servidor).
- `.mcp.json` executa comandos na sua máquina: só adicione servidores em que confia.

## 6. Claude Code

`ClaudeCodeService` — estado em memória (`Map` de ações).

| Fluxo | Início | Confirmação | Resultado |
| --- | --- | --- | --- |
| Pedido do agente | `run_claude_code` → `createPending` | Usuário confirma no cartão | `output` no cartão |
| Pesquisa | `POST /research/request` → `createResearchRequest` | Usuário confirma | Nota + artigo em Pesquisa |
| Terminal | `POST /claude-code/run` → `runNow` | Implícita (o humano digitou) | Saída na aba Terminal |

**Prompt de pesquisa:** pede um resumo completo e estruturado, começando com
`# <tema>` e seções `##`, devolvendo **somente** o markdown (sem saudação nem
comentários), para poder ser salvo direto como nota.

**Execução:** `execFile(claude, ["-p", prompt], {cwd, timeout: 5 min, maxBuffer: 10 MB, windowsHide: true})`.
Sem shell (ver [ARCHITECTURE.md §6.2](ARCHITECTURE.md)). Pré-requisito: o
Claude Code instalado e autenticado na máquina.

**`cwd`:** parâmetro → `CLAUDE_CODE_CWD` → diretório do processo.

## 7. Rotinas proativas e notificações

`SchedulerService` (`@nestjs/schedule`) + `NotificationsService`.

| Método | Cron | O que faz |
| --- | --- | --- |
| `morningBriefing` | `*/10 * * * *` | Se `MORNING_BRIEFING_ENABLED != "false"` e a hora local = `MORNING_BRIEFING_HOUR` e ainda não rodou hoje: pede ao próprio `/chat` um resumo de até 4 frases e enfileira "Bom dia" |
| `upcomingEvents` | `*/5 * * * *` | Eventos do Calendar que começam em `(0, EVENT_REMINDER_MINUTES]`; avisa **uma vez** por evento ("Compromisso em breve") |
| `googleTasksReminders` | `*/10 * * * *` | Tarefas do Google `needsAction` com prazo ≤ hoje: "Tarefa atrasada" (prazo < hoje) ou "Tarefa vence hoje". **Repete a cada 1 h** por tarefa enquanto continuar aberta |

Detalhes:

- Cada tick busca `GET /settings` no Core (timeout 5 s); se o Core estiver fora, usa `{}` e cai nos padrões (ligado; 8 h; 15 min).
- Só desliga com o valor exato `"false"`.
- Google Tasks: controle em `Map<taskId, timestampÚltimoAviso>`; dispara quando `agora − último ≥ 3 600 000 ms`. Tarefas sem `due` são ignoradas. A comparação usa a data UTC de hoje (ver L4).
- A fila guarda no máximo **50** notificações (mais novas primeiro). `GET /notifications/pending` devolve as não vistas; `POST /notifications/:id/ack` marca como vista.
- Consumidores: **desktop** (polling 30 s → notificação nativa → `ack` imediato) e **toast do dashboard** (polling 30 s, som via Web Audio, `ack` ao dispensar).
- O resumo da manhã chama `http://localhost:${AGENT_PORT}/chat` (não injeta `AgentService` por DI porque ele vive no `AppModule` raiz e não é exportado — o mesmo padrão usado para falar com o Core).

## 8. CLI

Conversar sem a web:

```bash
pnpm --filter @planner-life/agent cli
```

Digite `sair`, `exit` ou `quit` para encerrar. Usa o mesmo `AgentService`, com as mesmas ferramentas.

## 9. Como adicionar uma ferramenta

1. Adicione o schema em `AGENT_TOOLS` (`tools.ts`): `name`, `description`, `parameters` (JSON Schema).
2. Adicione o `case` correspondente em `runTool` chamando o endpoint do Core. Se a ferramenta não for uma chamada ao Core, trate-a em `ToolRegistry.call`.
3. Se o comportamento exigir orientação ao modelo, ajuste `SYSTEM_PROMPT`.
4. Se a ferramenta usar uma rota nova, implemente-a antes no Core.

Não é preciso mexer em nenhum provider: o schema neutro é adaptado por cada um.
