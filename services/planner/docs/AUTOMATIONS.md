# Automações (motor nativo no canvas)

O Planner Life tem um **motor de automações próprio** (no Core, `packages/core/src/automations`) desenhado como um grafo de nós ligados por fios (estilo n8n), com editor visual em **React Flow** dentro do canvas. Você descreve **em linguagem natural** a um Claude Code (com o MCP `planner-life`) e a automação aparece desenhada como **rascunho** para você revisar e ativar.

## 1. Usar

1. `pnpm dev` e, uma vez, `pnpm mcp:install` (registra o MCP no Claude Code — ver [MCP.md](MCP.md)).
2. No workspace: menu **Automações** → _Automação com Claude_ (terminal Claude Code orientado a automações + editor lado a lado), ou o módulo **Automações** (lista + editor em tela cheia), ou um nó _Automação_ no canvas.
3. Peça, por exemplo: _"toda segunda às 9h cria a tarefa Planejar a semana"_ ou _"me lembre de beber água a cada 2 horas"_.
4. O Claude consulta os nós (`automation_nodes`), monta o grafo (`save_automation`), **simula** (`run_automation`) e explica o que fez.
5. Revise o desenho, veja os dados por nó na simulação e clique **Ativar**. Só então os gatilhos passam a disparar.

## 2. Modelo de segurança: rascunho até você ativar

- Tudo que o Claude salva fica **inativo** (`source: "agent"`); editar uma automação ativa a **desativa**.
- O MCP **não tem** ferramenta para ativar nem para executar de verdade: só simulação (`run_automation` em modo dry: leituras rodam, escritas e agentes são simulados). Ativar/executar é ação da interface (`PATCH /automations/:id/active`, `POST /automations/:id/run`).
- Ferramentas chamadas por `action.tool` passam pela mesma proteção local do Agent (`local-guard`): só a própria máquina.
- Como em [SPEC.md](SPEC.md) L10, é proteção de interface, não controle de acesso.

## 3. Modelo

Cada nó recebe **itens** (objetos JSON) e entrega itens por uma porta (`main`; `true`/`false` no `logic.if`). A execução parte de um gatilho e segue em ordem topológica; cada nó registra entrada/saída de amostra, tempo e erro. Expressões `{{json.campo}}`, `{{index}}`, `{{input}}`, `{{nodes.<id>.items[0].campo}}`, `{{now.iso}}` usam um interpretador seguro (`expr.ts`, sem `eval`).

| Nó                               | Função                                                                |
| -------------------------------- | --------------------------------------------------------------------- |
| `trigger.manual`                 | Início manual (dados de exemplo em JSON)                              |
| `trigger.schedule`               | Cron (`0 9 * * 1`, `*/15 * * * *`, dias úteis…)                       |
| `trigger.once`                   | Uma vez, em data e hora                                               |
| `trigger.event`                  | Evento do Core (`task.created`, `record.created`…) com filtro `where` |
| `action.tool`                    | Chama uma ferramenta do Agent (`create_task`, `create_note`…)         |
| `action.notify`                  | **Aviso** personalizado (título/mensagem)                             |
| `action.agent`                   | Pergunta ao assistente (LLM) e passa o texto adiante                  |
| `action.record` / `data.records` | Grava / lê registros de coleções                                      |
| `logic.if` / `logic.set`         | Condição (verdadeiro/falso) e definição de campos                     |
| `note`                           | Comentário no desenho                                                 |

Automações agendadas são disparadas pelo runner do Core (`automations.runner.ts`); há concorrência otimista (`baseUpdatedAt` → 409) ao salvar.

## 4. Avisos e temporizadores

O Agent tem as ferramentas `create_reminder`, `list_reminders`, `cancel_reminder` (aviso único em data/hora ou daqui a N minutos) e `notify` (aviso imediato, `POST /notifications`). Lembretes aparecem em `GET/POST /automations/reminders` e são automações `trigger.once` + `action.notify`. Ver [VOICE-CALL.md](VOICE-CALL.md): por voz valem essas ferramentas simples.

## 5. API

`GET /automations`, `GET /automations/catalog`, `GET/POST /automations/reminders`, `GET /automations/runs/:runId`, `GET/PUT/DELETE /automations/:id`, `POST /automations`, `PATCH /automations/:id/active`, `POST /automations/:id/run`, `GET /automations/:id/runs`.

## 6. MCP

`automation_nodes`, `list_automations`, `get_automation`, `save_automation` (rascunho, validado contra o catálogo e as ferramentas reais do Agent), `run_automation` (simulação), `automation_runs`, `delete_automation`; prompt `construir-automacao`.
