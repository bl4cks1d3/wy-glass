# Referência da API HTTP

Todos os serviços falam JSON sobre HTTP, com CORS aberto e **sem
autenticação** (ver [SPEC.md §8, L1](SPEC.md)). Bases padrão:

| Serviço | Base |
| --- | --- |
| Core | `http://localhost:4000` |
| Agent | `http://localhost:4100` |
| Voice | `http://localhost:4200` |
| Ponte P2P (só loopback) | `http://127.0.0.1:4401` |

**Erros:** o NestJS devolve `{ "statusCode": 400, "message": "...", "error": "Bad Request" }`.
Validações de campos obrigatórios respondem `400`; recurso inexistente `404`;
falhas de integração (Google, chave ausente) `500` com a mensagem explicativa.

Convenção nas tabelas: **obr.** = obrigatório.

---

## 1. Core (`:4000`)

### Saúde
| Método | Rota | Resposta |
| --- | --- | --- |
| GET | `/health` | `{ "ok": true, "service": "planner-core" }` |

### Tarefas — `/tasks`
| Método | Rota | Corpo / query | Notas |
| --- | --- | --- | --- |
| GET | `/tasks` | `?status=&projectId=` | Lista, filtros opcionais |
| POST | `/tasks` | `title` (obr.), `projectId`, `dueAt`, `notes` | 400 sem `title` |
| PATCH | `/tasks/:id/status` | `status` ∈ `pending\|in_progress\|done\|cancelled` | 400 se inválido |
| PATCH | `/tasks/:id` | `title`, `projectId\|null`, `dueAt\|null`, `notes\|null` | `null` limpa o campo |
| DELETE | `/tasks/:id` | — | |

### Projetos — `/projects`
| Método | Rota | Corpo | Notas |
| --- | --- | --- | --- |
| GET | `/projects` | — | |
| POST | `/projects` | `name` (obr.), `goal` | |
| PATCH | `/projects/:id/progress` | `progress` (0–100) | |
| PATCH | `/projects/:id` | `name`, `goal`, `progress` | |
| DELETE | `/projects/:id` | — | Exclui também as tarefas do projeto |

### Memória — `/memory`
| Método | Rota | Corpo / query |
| --- | --- | --- |
| GET | `/memory` | `?limit=` (padrão 100, mais recentes primeiro) |
| POST | `/memory` | `content` (obr.), `tags[]`, `source` |
| DELETE | `/memory/:id` | — |

### Eventos — `/events`
| Método | Rota | Query |
| --- | --- | --- |
| GET | `/events` | `?limit=` (padrão 50) |

### CRM — `/clients`
| Método | Rota | Corpo |
| --- | --- | --- |
| GET | `/clients` | — |
| POST | `/clients` | `name` (obr.), `stage` ∈ `lead\|contact\|proposal\|closed`, `value`, `nextAction`, `nextActionAt` |
| PATCH | `/clients/:id` | `stage`, `value`, `nextAction`, `nextActionAt` |
| DELETE | `/clients/:id` | — |

`stage` inválido → 400 (criação e edição).

### Disciplinas — `/subjects`
| Método | Rota | Corpo |
| --- | --- | --- |
| GET | `/subjects` | — |
| POST | `/subjects` | `name` (obr.), `note`, `examDate` |
| PATCH | `/subjects/:id` | `progress`, `note`, `examDate` |
| DELETE | `/subjects/:id` | Exclui tópicos e cronograma da disciplina (sessões permanecem) |

### Estudo — `/study`
| Método | Rota | Corpo / query | Notas |
| --- | --- | --- | --- |
| GET | `/study/topics` | `?subjectId=` | |
| POST | `/study/topics` | `subjectId`, `title` (obr.), `dueAt` | `dueAt` faz do tópico uma entrega/leitura |
| PATCH | `/study/topics/:id` | `done` (booleano, obr.) | 400 se não for booleano |
| DELETE | `/study/topics/:id` | — | |
| GET | `/study/schedule` | — | Todos os blocos semanais |
| POST | `/study/schedule` | `subjectId`, `dayOfWeek` (0–6), `startTime`, `endTime` (`HH:MM`) — todos obr. | 400 se `dayOfWeek` fora de 0–6 |
| DELETE | `/study/schedule/:id` | — | |
| GET | `/study/sessions` | `?days=` | Sessões dos últimos N dias |
| POST | `/study/sessions` | `durationMinutes`, `startedAt`, `endedAt` (obr.), `subjectId` | |
| DELETE | `/study/sessions/:id` | — | |

### Pesquisa — `/research`
| Método | Rota | Corpo / query | Notas |
| --- | --- | --- | --- |
| GET | `/research/lines` | — | |
| POST | `/research/lines` | `name` (obr.), `stage`, `nextStep` | |
| PATCH | `/research/lines/:id` | `stage`, `nextStep` | |
| DELETE | `/research/lines/:id` | — | Artigos ficam sem linha |
| GET | `/research/papers` | `?researchLineId=` | |
| POST | `/research/papers` | `title` (obr.), `source`, `researchLineId`, `status`, `notePath` | `status` ∈ `na_fila\|em_leitura\|resumido` |
| PATCH | `/research/papers/:id/status` | `status` | |
| PATCH | `/research/papers/:id/note` | `notePath` (obr.) | |
| DELETE | `/research/papers/:id` | — | **Apaga também a nota do vault** vinculada |

### Inbox — `/messages`
| Método | Rota | Corpo |
| --- | --- | --- |
| GET | `/messages` | — |
| POST | `/messages` | `from`, `subject` (obr.), `snippet`, `tag`, `action`, `receivedAt` (upsert) |
| PATCH | `/messages/:id/handled` | `handled` (booleano, obr.) |
| DELETE | `/messages/:id` | Só a cópia local |
| DELETE | `/messages` | Limpa todo o inbox local |

### Hábitos — `/habits`
| Método | Rota | Corpo |
| --- | --- | --- |
| GET | `/habits` | — |
| POST | `/habits` | `name` (obr.), `unit`, `target` |
| PATCH | `/habits/:id` | `current`, `target` |
| DELETE | `/habits/:id` | — |

### Notas (vault) — `/vault`
| Método | Rota | Corpo / query | Resposta |
| --- | --- | --- | --- |
| GET | `/vault/notes` | — | `[{path,title,updatedAt,excerpt}]`, mais recentes primeiro |
| GET | `/vault/note` | `?path=` | `{path,title,updatedAt,content}`; 404 se não existir |
| POST | `/vault/note` | `path`, `content` | Cria/sobrescreve; acrescenta `.md`; cria pastas |
| DELETE | `/vault/note` | `?path=` | |
| GET | `/vault/search` | `?q=` | Título, trecho e conteúdo |

`path` que escape do vault → **400** `caminho fora do vault`.

### Configurações — `/settings`
| Método | Rota | Corpo | Resposta |
| --- | --- | --- | --- |
| GET | `/settings` | — | `[{key,value,isSecret,hasValue}]` das 17 chaves editáveis. Segredos vêm com `value: null` |
| PATCH | `/settings` | objeto `{CHAVE: "valor"}` | `{ok:true}`. Chave fora da lista → 400; corpo vazio → 400 |

Escreve no `.env` preservando comentários. Ver [CONFIGURATION.md](CONFIGURATION.md).

### Google — `/integrations/google`
| Método | Rota | Corpo / query | Notas |
| --- | --- | --- | --- |
| GET | `/status` | — | `{connected, accounts:[{email,connectedAt}]}` |
| GET | `/auth` | — | Redireciona ao consentimento Google (seletor de conta) |
| GET | `/callback` | `?code=&error=` | Troca o código, sincroniza o Gmail e redireciona para `WEB_APP_URL/?google=connected&account=…` (ou `?google=error`) |
| DELETE | `/accounts/:email` | — | Desconecta a conta |
| POST | `/sync-gmail` | `?limit=&account=` | `{synced, accounts}` |
| GET | `/gmail/:id/body` | — | `{from,subject,text,html}`; 404 se o id não for `gmail-…` |
| GET | `/calendar` | `?limit=` | Próximos eventos de todas as agendas: `{id,title,start,end?,location?,account,calendarName}` |
| POST | `/calendar/events` | `title`, `start`, `end` (obr.), `description`, `account` | |
| PATCH | `/calendar/events/:id` | `title`, `start`, `end`, `description`, `account` | `:id` = `calendarId:eventId` (URL-encode) |
| DELETE | `/calendar/events/:id` | `?account=` | |
| GET | `/tasks` | `?account=` | Google Tasks ao vivo: `{id,title,notes?,due?,status,account}` |
| POST | `/tasks` | `title` (obr.), `notes`, `due`, `account` | |
| PATCH | `/tasks/:id` | `title`, `notes`, `due`, `status` ∈ `needsAction\|completed`, `account` | |
| DELETE | `/tasks/:id` | `?account=` | |

---

## 2. Agent (`:4100`)

| Método | Rota | Corpo | Resposta |
| --- | --- | --- | --- |
| GET | `/health` | — | `{ok:true, service:"planner-agent"}` |
| POST | `/chat` | `message` (obr.) | `{reply}` — 400 sem `message`; 500 se nenhuma chave de IA estiver configurada |
| GET | `/claude-code/pending` | — | Pedidos com `status:"pending"`, mais antigos primeiro |
| POST | `/claude-code/:id/confirm` | — | Executa o pedido; devolve a ação (`status` `done` ou `error`, `output`/`error`). 404 se o id não existir |
| POST | `/claude-code/:id/reject` | — | Marca `rejected` |
| POST | `/claude-code/run` | `prompt` (obr.), `cwd` | **Executa na hora**, sem fila (usado pela aba Terminal) |
| POST | `/research/request` | `theme` (obr.) | Cria pedido pendente `kind:"research"` |
| GET | `/notifications/pending` | — | `[{id,title,body,createdAt,seen}]` não vistas |
| POST | `/notifications/:id/ack` | — | `{ok:true}` |

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

| Método | Rota | Corpo | Resposta |
| --- | --- | --- | --- |
| GET | `/health` | — | `{ok:true, service:"planner-voice"}` |
| POST | `/speak` | `text` (obr.) | `200 audio/wav`. 500 se o binário/modelo do Piper não existir |

---

## 4. Ponte P2P (`127.0.0.1:4401`)

| Método | Rota | Corpo | Resposta |
| --- | --- | --- | --- |
| GET | `/health` | — | `{ok:true, service:"planner-p2p-node", peerId}` |
| POST | `/publish` | `{type, payload}` | `{ok:true}` ou `{ok:false, reason}` (ex.: nenhum par inscrito) — sempre HTTP 200 |

Chamada pelo Core a cada evento de domínio. Não use fora da máquina local.
