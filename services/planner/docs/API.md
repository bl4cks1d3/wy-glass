# Referência da API HTTP

Todos os serviços falam JSON sobre HTTP, com CORS aberto e **sem
autenticação** (ver [SPEC.md §8, L1](SPEC.md)). Bases padrão:

| Serviço                 | Base                                                |
| ----------------------- | --------------------------------------------------- |
| Core                    | `http://localhost:4000`                             |
| Agent                   | `http://localhost:4100`                             |
| Voice                   | `http://localhost:4200`                             |
| Ponte P2P (só loopback) | `http://127.0.0.1:4401`                             |
| Terminal (só loopback)  | `http://127.0.0.1:4500` · `ws://127.0.0.1:4500/pty` |

**Erros:** o NestJS devolve `{ "statusCode": 400, "message": "...", "error": "Bad Request" }`.
Validações de campos obrigatórios respondem `400`; recurso inexistente `404`;
falhas de integração (Google, chave ausente) `500` com a mensagem explicativa.

Convenção nas tabelas: **obr.** = obrigatório.

---

## 1. Core (`:4000`)

### Saúde

| Método | Rota      | Resposta                                    |
| ------ | --------- | ------------------------------------------- |
| GET    | `/health` | `{ "ok": true, "service": "planner-core" }` |

### Tarefas — `/tasks`

| Método | Rota                | Corpo / query                                            | Notas                    |
| ------ | ------------------- | -------------------------------------------------------- | ------------------------ |
| GET    | `/tasks`            | `?status=&projectId=`                                    | Lista, filtros opcionais |
| POST   | `/tasks`            | `title` (obr.), `projectId`, `dueAt`, `notes`            | 400 sem `title`          |
| PATCH  | `/tasks/:id/status` | `status` ∈ `pending\|in_progress\|done\|cancelled`       | 400 se inválido          |
| PATCH  | `/tasks/:id`        | `title`, `projectId\|null`, `dueAt\|null`, `notes\|null` | `null` limpa o campo     |
| DELETE | `/tasks/:id`        | —                                                        |                          |

### Projetos — `/projects`

| Método | Rota                     | Corpo                      | Notas                               |
| ------ | ------------------------ | -------------------------- | ----------------------------------- |
| GET    | `/projects`              | —                          |                                     |
| POST   | `/projects`              | `name` (obr.), `goal`      |                                     |
| PATCH  | `/projects/:id/progress` | `progress` (0–100)         |                                     |
| PATCH  | `/projects/:id`          | `name`, `goal`, `progress` |                                     |
| DELETE | `/projects/:id`          | —                          | Exclui também as tarefas do projeto |

### Memória — `/memory`

| Método | Rota          | Corpo / query                                  |
| ------ | ------------- | ---------------------------------------------- |
| GET    | `/memory`     | `?limit=` (padrão 100, mais recentes primeiro) |
| POST   | `/memory`     | `content` (obr.), `tags[]`, `source`           |
| DELETE | `/memory/:id` | —                                              |

### Eventos — `/events`

| Método | Rota      | Query                 |
| ------ | --------- | --------------------- |
| GET    | `/events` | `?limit=` (padrão 50) |

### CRM — `/clients`

| Método | Rota           | Corpo                                                                                             |
| ------ | -------------- | ------------------------------------------------------------------------------------------------- |
| GET    | `/clients`     | —                                                                                                 |
| POST   | `/clients`     | `name` (obr.), `stage` ∈ `lead\|contact\|proposal\|closed`, `value`, `nextAction`, `nextActionAt` |
| PATCH  | `/clients/:id` | `stage`, `value`, `nextAction`, `nextActionAt`                                                    |
| DELETE | `/clients/:id` | —                                                                                                 |

`stage` inválido → 400 (criação e edição).

### Disciplinas — `/subjects`

| Método | Rota            | Corpo                                                          |
| ------ | --------------- | -------------------------------------------------------------- |
| GET    | `/subjects`     | —                                                              |
| POST   | `/subjects`     | `name` (obr.), `note`, `examDate`                              |
| PATCH  | `/subjects/:id` | `progress`, `note`, `examDate`                                 |
| DELETE | `/subjects/:id` | Exclui tópicos e cronograma da disciplina (sessões permanecem) |

### Estudo — `/study`

| Método | Rota                  | Corpo / query                                                                 | Notas                                     |
| ------ | --------------------- | ----------------------------------------------------------------------------- | ----------------------------------------- |
| GET    | `/study/topics`       | `?subjectId=`                                                                 |                                           |
| POST   | `/study/topics`       | `subjectId`, `title` (obr.), `dueAt`                                          | `dueAt` faz do tópico uma entrega/leitura |
| PATCH  | `/study/topics/:id`   | `done` (booleano, obr.)                                                       | 400 se não for booleano                   |
| DELETE | `/study/topics/:id`   | —                                                                             |                                           |
| GET    | `/study/schedule`     | —                                                                             | Todos os blocos semanais                  |
| POST   | `/study/schedule`     | `subjectId`, `dayOfWeek` (0–6), `startTime`, `endTime` (`HH:MM`) — todos obr. | 400 se `dayOfWeek` fora de 0–6            |
| DELETE | `/study/schedule/:id` | —                                                                             |                                           |
| GET    | `/study/sessions`     | `?days=`                                                                      | Sessões dos últimos N dias                |
| POST   | `/study/sessions`     | `durationMinutes`, `startedAt`, `endedAt` (obr.), `subjectId`                 |                                           |
| DELETE | `/study/sessions/:id` | —                                                                             |                                           |

### Pesquisa — `/research`

| Método | Rota                          | Corpo / query                                                    | Notas                                      |
| ------ | ----------------------------- | ---------------------------------------------------------------- | ------------------------------------------ |
| GET    | `/research/lines`             | —                                                                |                                            |
| POST   | `/research/lines`             | `name` (obr.), `stage`, `nextStep`                               |                                            |
| PATCH  | `/research/lines/:id`         | `stage`, `nextStep`                                              |                                            |
| DELETE | `/research/lines/:id`         | —                                                                | Artigos ficam sem linha                    |
| GET    | `/research/papers`            | `?researchLineId=`                                               |                                            |
| POST   | `/research/papers`            | `title` (obr.), `source`, `researchLineId`, `status`, `notePath` | `status` ∈ `na_fila\|em_leitura\|resumido` |
| PATCH  | `/research/papers/:id/status` | `status`                                                         |                                            |
| PATCH  | `/research/papers/:id/note`   | `notePath` (obr.)                                                |                                            |
| DELETE | `/research/papers/:id`        | —                                                                | **Apaga também a nota do vault** vinculada |

### Inbox — `/messages`

| Método | Rota                    | Corpo                                                                       |
| ------ | ----------------------- | --------------------------------------------------------------------------- |
| GET    | `/messages`             | —                                                                           |
| POST   | `/messages`             | `from`, `subject` (obr.), `snippet`, `tag`, `action`, `receivedAt` (upsert) |
| PATCH  | `/messages/:id/handled` | `handled` (booleano, obr.)                                                  |
| DELETE | `/messages/:id`         | Só a cópia local                                                            |
| DELETE | `/messages`             | Limpa todo o inbox local                                                    |

### Hábitos — `/habits`

| Método | Rota          | Corpo                           |
| ------ | ------------- | ------------------------------- |
| GET    | `/habits`     | —                               |
| POST   | `/habits`     | `name` (obr.), `unit`, `target` |
| PATCH  | `/habits/:id` | `current`, `target`             |
| DELETE | `/habits/:id` | —                               |

### Notas (vault) — `/vault`

| Método | Rota            | Corpo / query     | Resposta                                                   |
| ------ | --------------- | ----------------- | ---------------------------------------------------------- |
| GET    | `/vault/notes`  | —                 | `[{path,title,updatedAt,excerpt}]`, mais recentes primeiro |
| GET    | `/vault/note`   | `?path=`          | `{path,title,updatedAt,content}`; 404 se não existir       |
| POST   | `/vault/note`   | `path`, `content` | Cria/sobrescreve; acrescenta `.md`; cria pastas            |
| DELETE | `/vault/note`   | `?path=`          |                                                            |
| GET    | `/vault/search` | `?q=`             | Título, trecho e conteúdo                                  |

`path` que escape do vault → **400** `caminho fora do vault`.

### Configurações — `/settings`

| Método | Rota        | Corpo                     | Resposta                                                                                  |
| ------ | ----------- | ------------------------- | ----------------------------------------------------------------------------------------- |
| GET    | `/settings` | —                         | `[{key,value,isSecret,hasValue}]` das 17 chaves editáveis. Segredos vêm com `value: null` |
| PATCH  | `/settings` | objeto `{CHAVE: "valor"}` | `{ok:true}`. Chave fora da lista → 400; corpo vazio → 400                                 |

Escreve no `.env` preservando comentários. Ver [CONFIGURATION.md](CONFIGURATION.md).

### Google — `/integrations/google`

| Método | Rota                   | Corpo / query                                                           | Notas                                                                                                                |
| ------ | ---------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| GET    | `/status`              | —                                                                       | `{connected, accounts:[{email,connectedAt}]}`                                                                        |
| GET    | `/auth`                | —                                                                       | Redireciona ao consentimento Google (seletor de conta)                                                               |
| GET    | `/callback`            | `?code=&error=`                                                         | Troca o código, sincroniza o Gmail e redireciona para `WEB_APP_URL/?google=connected&account=…` (ou `?google=error`) |
| DELETE | `/accounts/:email`     | —                                                                       | Desconecta a conta                                                                                                   |
| POST   | `/sync-gmail`          | `?limit=&account=`                                                      | `{synced, accounts}`                                                                                                 |
| GET    | `/gmail/:id/body`      | —                                                                       | `{from,subject,text,html}`; 404 se o id não for `gmail-…`                                                            |
| GET    | `/calendar`            | `?limit=`                                                               | Próximos eventos de todas as agendas: `{id,title,start,end?,location?,account,calendarName}`                         |
| POST   | `/calendar/events`     | `title`, `start`, `end` (obr.), `description`, `account`                |                                                                                                                      |
| PATCH  | `/calendar/events/:id` | `title`, `start`, `end`, `description`, `account`                       | `:id` = `calendarId:eventId` (URL-encode)                                                                            |
| DELETE | `/calendar/events/:id` | `?account=`                                                             |                                                                                                                      |
| GET    | `/tasks`               | `?account=`                                                             | Google Tasks ao vivo: `{id,title,notes?,due?,status,account}`                                                        |
| POST   | `/tasks`               | `title` (obr.), `notes`, `due`, `account`                               |                                                                                                                      |
| PATCH  | `/tasks/:id`           | `title`, `notes`, `due`, `status` ∈ `needsAction\|completed`, `account` |                                                                                                                      |
| DELETE | `/tasks/:id`           | `?account=`                                                             |                                                                                                                      |

### Construtor — `/builder`

| Método | Rota                                | Corpo                                                                                                                                                                         | Notas                                                                                                                                                                                        |
| ------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/builder/blocks`                   | —                                                                                                                                                                             | Embutidos primeiro                                                                                                                                                                           |
| GET    | `/builder/blocks/:id`               | —                                                                                                                                                                             |                                                                                                                                                                                              |
| POST   | `/builder/blocks`                   | `name` (obr., ≤ 80), `description`, `html`, `css`, `js` (≤ 100 000 c. cada), `permissions {read[],write[],tools[]}`, `refreshSeconds`, `source` (`user`\|`agent`), `approved` | Nasce **não aprovado** se `approved` não for `true`. 400 em validação                                                                                                                        |
| PATCH  | `/builder/blocks/:id`               | mesmos campos, opcionais                                                                                                                                                      | Mudar código/permissões/refresh **revoga** a aprovação (a menos que venha `approved:true`); mudar só nome/descrição mantém. **403** em bloco embutido                                        |
| POST   | `/builder/blocks/:id/duplicate`     | —                                                                                                                                                                             | Cópia `user`, herda `approved`                                                                                                                                                               |
| DELETE | `/builder/blocks/:id`               | —                                                                                                                                                                             | Remove também dos painéis. 403 se embutido                                                                                                                                                   |
| GET    | `/builder/dashboards` · `/:id`      | —                                                                                                                                                                             |                                                                                                                                                                                              |
| POST   | `/builder/dashboards`               | `name` (obr.), `mode` (`grid`\|`canvas`), `items[]`                                                                                                                           | Item: `{id?, blockId, grid?{x,y,w,h}, canvas?{x,y,w,h}}`; falta um lado → derivado do outro; falta os dois → posição padrão; valores fora dos limites são ajustados; bloco inexistente → 400 |
| PATCH  | `/builder/dashboards/:id`           | `name`, `mode`, `items`                                                                                                                                                       | 403 se embutido (`builtin-basico`)                                                                                                                                                           |
| POST   | `/builder/dashboards/:id/duplicate` | —                                                                                                                                                                             | Novos ids de item; nunca embutido                                                                                                                                                            |
| DELETE | `/builder/dashboards/:id`           | —                                                                                                                                                                             | 403 se embutido                                                                                                                                                                              |

### Banco sob medida — `/data/collections`

| Método | Rota                                  | Corpo / query                                                                   | Notas                                                                                                                      |
| ------ | ------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/data/collections`                   | —                                                                               | `[{id,name,label,description?,fields[],records}]`                                                                          |
| POST   | `/data/collections`                   | `name` (`a-z0-9_`, 2–40), `label`, `description`, `fields[]`                    | `fields[]`: `{name, label?, type: text\|longtext\|number\|date\|boolean\|select, required?, options?[]}`. 409 se já existe |
| GET    | `/data/collections/:name`             | —                                                                               | 404 se não existir                                                                                                         |
| PATCH  | `/data/collections/:name`             | `label`, `description`, `fields`                                                | Não apaga dados                                                                                                            |
| DELETE | `/data/collections/:name`             | —                                                                               | Apaga os registros também                                                                                                  |
| GET    | `/data/collections/:name/records`     | `q`, `sort`, `order`, `limit` (≤ 1000, padrão 500), `offset`, `<campo>=<valor>` | Registro: `{...campos, id, createdAt, updatedAt}`                                                                          |
| POST   | `/data/collections/:name/records`     | `{campo: valor}`                                                                | Valida tipos/obrigatórios; campo desconhecido → 400                                                                        |
| PATCH  | `/data/collections/:name/records/:id` | `{campo: valor}`                                                                | Mescla; `null` limpa o campo                                                                                               |
| DELETE | `/data/collections/:name/records/:id` | —                                                                               |                                                                                                                            |

### Workspaces (canvas) — `/workspaces`

| Método | Rota              | Corpo                                                 | Notas                                                                                                                                                                                                                                                                          |
| ------ | ----------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/workspaces`     | —                                                     | Mais antigos primeiro. Na primeira execução já existe o workspace **Início**                                                                                                                                                                                                   |
| GET    | `/workspaces/:id` | —                                                     | 404 se não existir                                                                                                                                                                                                                                                             |
| POST   | `/workspaces`     | `name` (obr., ≤ 60), `nodes[]`, `viewport {x,y,zoom}` | 201. Item: `{id?, type: terminal\|block\|note, x, y, w, h, z, data}`; `data` é `{sessionId, profile: claude\|agent\|shell, title?}`, `{blockId}` ou `{text ≤ 20 000}`; campos extras são descartados, perfil desconhecido vira `shell`, tipo inválido → 400, > 200 itens → 400 |
| PATCH  | `/workspaces/:id` | `name`, `nodes`, `viewport`, `baseUpdatedAt?`         | `nodes` **substitui** a lista. Coordenadas ±200 000, tamanho 160–6000 × 100–6000, zoom 0,2–2,5 (ajustados, não rejeitados). Com `baseUpdatedAt` diferente da versão atual → **409** (outra janela gravou antes). Só `nodes`/`viewport` mudam `updatedAt`; renomear não muda    |
| DELETE | `/workspaces/:id` | —                                                     | Não encerra sessões de terminal (o dashboard faz isso antes)                                                                                                                                                                                                                   |

Eventos: `workspace.created`, `workspace.updated` (só renomear) e `workspace.deleted`. Salvar layout **não** gera evento.

---

## 2. Agent (`:4100`)

| Método | Rota                       | Corpo                  | Resposta                                                                                                                                                                            |
| ------ | -------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/health`                  | —                      | `{ok:true, service:"planner-agent"}`                                                                                                                                                |
| GET    | `/tools`                   | —                      | `[{name, description, inputSchema}]` — só de **loopback** e `Origin` permitida (`TOOLS_ALLOWED_ORIGINS`); omite `run_claude_code` e `use_skill`                                     |
| POST   | `/tools/call`              | `name` (obr.), `args`  | `{result}` — executa a ferramenta **sem passar pelo LLM** (inclusive as de servidores MCP). Mesma restrição; `run_claude_code`/`use_skill` → 403; ferramenta inexistente/erro → 400 |
| POST   | `/chat`                    |                        | POST                                                                                                                                                                                | `/chat` | `message` (obr.) | `{reply}` — 400 sem `message`; 500 se nenhuma chave de IA estiver configurada |
| GET    | `/claude-code/pending`     | —                      | Pedidos com `status:"pending"`, mais antigos primeiro                                                                                                                               |
| POST   | `/claude-code/:id/confirm` | —                      | Executa o pedido; devolve a ação (`status` `done` ou `error`, `output`/`error`). 404 se o id não existir                                                                            |
| POST   | `/claude-code/:id/reject`  | —                      | Marca `rejected`                                                                                                                                                                    |
| POST   | `/claude-code/run`         | `prompt` (obr.), `cwd` | **Executa na hora**, sem fila (usado pela aba Terminal)                                                                                                                             |
| POST   | `/research/request`        | `theme` (obr.)         | Cria pedido pendente `kind:"research"`                                                                                                                                              |
| GET    | `/notifications/pending`   | —                      | `[{id,title,body,createdAt,seen}]` não vistas                                                                                                                                       |
| POST   | `/notifications/:id/ack`   | —                      | `{ok:true}`                                                                                                                                                                         |

### Objeto de ação do Claude Code

```json
{
  "id": "uuid",
  "prompt": "…",
  "cwd": "C:\\projetos\\x",
  "status": "pending | running | done | error | rejected",
  "createdAt": "2026-09-18T13:10:00.000Z",
  "output": "…",
  "error": "…",
  "kind": "research",
  "meta": { "theme": "…" }
}
```

`kind: "research"` só aparece em pedidos de pesquisa; ao confirmar com
sucesso o Agent grava a nota no vault e cria o artigo em Pesquisa.

### Exemplos

```bash
# Conversar com o agente
curl -X POST http://localhost:4100/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"o que está atrasado?"}'

# Pedir uma pesquisa (fica pendente até confirmar)
curl -X POST http://localhost:4100/research/request \
  -H "Content-Type: application/json" \
  -d '{"theme":"consolidação de memória durante o sono"}'
curl -X POST http://localhost:4100/claude-code/<id>/confirm

# Ver avisos pendentes
curl http://localhost:4100/notifications/pending
```

> Em `curl` no Windows/Git Bash, corpos com acentos passados inline podem ser
> corrompidos. Grave o JSON em arquivo e use `--data-binary @arquivo.json`.

---

## 3. Voice (`:4200`)

| Método | Rota      | Corpo            | Resposta                                                                                                        |
| ------ | --------- | ---------------- | --------------------------------------------------------------------------------------------------------------- |
| GET    | `/health` | —                | `{ok:true, service:"planner-voice"}`                                                                            |
| POST   | `/speak`  | `text` (obr.)    | `200 audio/wav`. 500 se o binário/modelo do Piper não existir                                                   |
| WS     | `/live`   | mensagens abaixo | Chamada de voz (Gemini Live). Só loopback, `Host` `localhost/127.0.0.1:4200`, `Origin` do dashboard (senão 403) |

**WebSocket `/live`** — cliente → serviço: quadros **binários** = PCM 16-bit 16 kHz mono (blocos de ~100 ms); JSON `{type:"text", text}` (texto no lugar de voz) e `{type:"end"}`. Serviço → cliente: quadros **binários** = PCM 16-bit 24 kHz (resposta falada); JSON `{type}` = `ready {model}` · `input_text {text}` · `output_text {text}` · `turn_complete` · `interrupted` · `tool {name, status: running|ok|error, message?}` · `notice {message}` · `error {message}` · `closed {reason}`. Sem `GEMINI_LIVE_API_KEY` → `error` e fecha. Uma chamada por vez.

---

## 3.1 Automações (Core, `:4000`)

Motor nativo de automações (grafo de nós). Detalhes e nós em [AUTOMATIONS.md](AUTOMATIONS.md).

| Método              | Rota                                                | Uso                                                                          |
| ------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------- |
| GET                 | `/automations`                                      | Lista as automações (nós, fios, estado, última execução)                     |
| GET                 | `/automations/catalog`                              | Tipos de nó, ferramentas do Agent e eventos disponíveis                      |
| POST / PUT / DELETE | `/automations`, `/automations/:id`                  | CRUD; `PUT` aceita `baseUpdatedAt` (409 em conflito)                         |
| PATCH               | `/automations/:id/active`                           | `{active}` — ativar/desativar (ação do usuário; o MCP não tem)               |
| POST                | `/automations/:id/run`                              | `{mode: "live"\|"dry", payload?}` — executa; `dry` simula escritas e agentes |
| GET                 | `/automations/:id/runs`, `/automations/runs/:runId` | Histórico e execução com dados por nó                                        |
| GET / POST          | `/automations/reminders`                            | Lembretes/temporizadores (automação `trigger.once` + `action.notify`)        |
| POST                | `/notifications` (Agent `:4100`)                    | Aviso imediato ao usuário                                                    |

---

## 4. Ponte P2P (`127.0.0.1:4401`)

| Método | Rota       | Corpo             | Resposta                                                                         |
| ------ | ---------- | ----------------- | -------------------------------------------------------------------------------- |
| GET    | `/health`  | —                 | `{ok:true, service:"planner-p2p-node", peerId}`                                  |
| POST   | `/publish` | `{type, payload}` | `{ok:true}` ou `{ok:false, reason}` (ex.: nenhum par inscrito) — sempre HTTP 200 |

Chamada pelo Core a cada evento de domínio. Não use fora da máquina local.

---

## 5. Terminal (`127.0.0.1:4500`)

Só loopback. Todas as rotas, exceto `/health`, exigem `Origin` permitida (`http://localhost:4300` por padrão) e `Host` de loopback com a porta `4500`; caso contrário respondem **403** (também no upgrade do WebSocket). O CORS só devolve `Access-Control-Allow-Origin` para origens permitidas.

| Método | Rota            | Corpo                                                      | Resposta                                                                                                                                                         |
| ------ | --------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/health`       | —                                                          | `{ok:true, service:"planner-terminal", sessions:N}`                                                                                                              |
| GET    | `/claude`       | —                                                          | `{installed, version?, path?}` — detecta o Claude Code (`claude --version`, cache 60 s)                                                                          |
| GET    | `/sessions`     | —                                                          | Lista de sessões                                                                                                                                                 |
| POST   | `/sessions`     | `profile` (`claude` \| `agent` \| `shell`), `cols`, `rows` | **201** com a sessão. `400` perfil inválido; `429` limite de 8 sessões; `500` se o programa não puder ser iniciado. Campos extras (ex.: `command`) são ignorados |
| DELETE | `/sessions/:id` | —                                                          | `{ok:true}` e o processo é encerrado; `404` se não existir                                                                                                       |

Objeto de sessão: `{id, profile, title, cwd, createdAt, exited, exitCode?, clients}`.

**Perfis** (definidos no servidor):

| Perfil   | Executa                                                                                                  | Pasta                                |
| -------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `claude` | Claude Code interativo (`claude.exe` da instalação mais recente no Windows; `claude` do PATH nos demais) | `CLAUDE_CODE_CWD` ou raiz do projeto |
| `agent`  | `pnpm cli` (conversa com o Personal Agent)                                                               | raiz do projeto                      |
| `shell`  | PowerShell (Windows) ou `$SHELL`/`bash`                                                                  | raiz do projeto                      |

### WebSocket `/pty?session=<id>&cols=<n>&rows=<n>`

Anexa a uma sessão existente (`404` se o id não existir). Vários clientes podem anexar à mesma sessão.

| Direção            | Mensagem (JSON, texto)                    | Significado                                                                             |
| ------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------- |
| servidor → cliente | `{"type":"ready","id","profile","title"}` | Conectado                                                                               |
| servidor → cliente | `{"type":"output","data":"…"}`            | Saída do terminal. A primeira `output` após `ready` é o histórico guardado (até 256 KB) |
| servidor → cliente | `{"type":"exit","code":N}`                | O processo terminou (a sessão continua listada, com `exited:true`, até ser removida)    |
| cliente → servidor | `{"type":"input","data":"…"}`             | Teclas digitadas (até 64 KB por mensagem)                                               |
| cliente → servidor | `{"type":"resize","cols":N,"rows":N}`     | Novo tamanho (1–500 × 1–200)                                                            |

Mensagens inválidas (JSON quebrado, tipos errados) são ignoradas sem derrubar a sessão. Fechar o WebSocket **não** encerra o processo.
