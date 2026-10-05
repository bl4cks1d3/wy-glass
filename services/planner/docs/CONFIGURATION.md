# Configuração

Toda a configuração fica em um único arquivo `.env` na **raiz do
repositório** (copie de `.env.example`). Core, Agent, Voice e p2p-node o
carregam com `dotenv` ao iniciar. O `.env` está no `.gitignore` — **nunca o
versione**.

```bash
cp .env.example .env
```

## 1. Quando uma mudança passa a valer

Os serviços leem `process.env` **uma vez, na inicialização**. A aba
Configurações grava no `.env`, mas isso **não** altera o `process.env` dos
processos em execução.

| Categoria                                                                                | Valem na hora                                            | Exigem reiniciar       |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------- |
| Notificações (`MORNING_BRIEFING_*`, `EVENT_REMINDER_*`, `GOOGLE_TASKS_REMINDER_ENABLED`) | ✅ o Agent relê `GET /settings` a cada execução do cron  | —                      |
| `NOTIFICATION_SOUND_ENABLED`                                                             | ✅ ao recarregar a página (o toast lê uma vez ao montar) | —                      |
| IA (`AGENT_PROVIDER`, chaves, `*_MODEL`)                                                 | —                                                        | Agent                  |
| `CLAUDE_CODE_CWD`                                                                        | —                                                        | Agent                  |
| `PIPER_BIN`, `PIPER_MODEL`                                                               | —                                                        | Voice                  |
| `OBSIDIAN_VAULT_PATH`                                                                    | —                                                        | Core                   |
| `TERMINAL_*`                                                                             | —                                                        | Terminal               |
| Portas, `DB_PATH`, `CORE_API_URL`, OAuth Google                                          | —                                                        | serviço correspondente |

> A tela de Configurações rotula a seção **Notas** como "aplica na hora, sem
> restart", mas o `VaultService` lê `OBSIDIAN_VAULT_PATH` só no construtor —
> **é preciso reiniciar o Core** ([SPEC.md §8, L6](SPEC.md)).

## 2. Variáveis

### Core

| Variável                                    | Padrão                                               | Descrição                                                      |
| ------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------- |
| `CORE_PORT`                                 | `4000`                                               | Porta HTTP                                                     |
| `DB_PATH`                                   | `./data/planner.db`                                  | Arquivo SQLite (criado se não existir)                         |
| `OBSIDIAN_VAULT_PATH`                       | _(vazio)_ → `data/vault`                             | Pasta do vault. Aponte para o vault real do Obsidian se quiser |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | —                                                    | Cliente OAuth do Google Cloud                                  |
| `GOOGLE_REDIRECT_URI`                       | `http://localhost:4000/integrations/google/callback` | Deve coincidir exatamente com o cadastrado no Google Cloud     |
| `WEB_APP_URL`                               | `http://localhost:4300`                              | Para onde o callback do Google redireciona no fim              |
| `P2P_NODE_HTTP_URL`                         | `http://127.0.0.1:4401`                              | Ponte HTTP do nó P2P local                                     |

### Agent

| Variável                                | Padrão                    | Descrição                                                                                                                                                                                       |
| --------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENT_PORT`                            | `4100`                    | Porta HTTP (também usada pelo resumo da manhã para chamar `/chat`)                                                                                                                              |
| `CORE_API_URL`                          | `http://localhost:4000`   | Onde ficam os dados e as configurações                                                                                                                                                          |
| `AGENT_PROVIDER`                        | _(vazio)_                 | `groq` \| `gemini` \| `anthropic`; vazio = primeira chave existente                                                                                                                             |
| `GROQ_API_KEY` / `GROQ_MODEL`           | — / `openai/gpt-oss-120b` | https://console.groq.com/keys                                                                                                                                                                   |
| `GEMINI_API_KEY` / `GEMINI_MODEL`       | — / `gemini-2.0-flash`    | https://aistudio.google.com/apikey                                                                                                                                                              |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | — / `claude-sonnet-5`     | Pago                                                                                                                                                                                            |
| `CLAUDE_CODE_CWD`                       | _(vazio)_                 | Pasta padrão do `claude -p`. Requer o Claude Code instalado e autenticado                                                                                                                       |
| `TOOLS_ALLOWED_ORIGINS`                 | _(vazio)_                 | Origens extras (vírgula) autorizadas em `/tools/*` além de `http://localhost:4300`/`127.0.0.1:4300` — só se você mudar a porta do dashboard. Essas rotas só aceitam chamadas da própria máquina |
| `GROQ_MAX_REQUEST_CHARS`                | `30000`                   | Tamanho máximo (caracteres) da requisição ao Groq; turnos antigos saem do histórico para caber ([AGENT.md](AGENT.md))                                                                           |

### MCP (`packages/mcp`)

| Variável            | Padrão                  | Descrição                         |
| ------------------- | ----------------------- | --------------------------------- |
| `PLANNER_CORE_URL`  | `http://localhost:4000` | Onde estão as coleções            |
| `PLANNER_AGENT_URL` | `http://localhost:4100` | De onde vêm as demais ferramentas |

Registro no Claude Code: `.mcp.json` do projeto (já inclui) ou `claude mcp add planner-life -s user -- node <caminho>/packages/mcp/dist/index.js`. Detalhes em [MCP.md](MCP.md).

### Notificações proativas (lidas ao vivo)

| Variável                        | Padrão | Descrição                                                            |
| ------------------------------- | ------ | -------------------------------------------------------------------- |
| `MORNING_BRIEFING_ENABLED`      | `true` | Liga/desliga o resumo da manhã (só `false` desliga)                  |
| `MORNING_BRIEFING_HOUR`         | `8`    | Hora local (0–23)                                                    |
| `EVENT_REMINDER_ENABLED`        | `true` | Avisar antes de compromissos                                         |
| `EVENT_REMINDER_MINUTES`        | `15`   | Antecedência em minutos                                              |
| `GOOGLE_TASKS_REMINDER_ENABLED` | `true` | Avisar tarefas do Google atrasadas/vencendo hoje (repete a cada 1 h) |
| `NOTIFICATION_SOUND_ENABLED`    | `true` | Aviso sonoro no toast do navegador                                   |

### Voz

| Variável      | Padrão                                                 | Descrição                                              |
| ------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| `VOICE_PORT`  | `4200`                                                 | Porta HTTP                                             |
| `PIPER_BIN`   | `packages/voice/vendor/piper/piper.exe`                | Executável do Piper (no Linux/Pi: `piper`, sem `.exe`) |
| `PIPER_MODEL` | `packages/voice/vendor/models/pt_BR-faber-medium.onnx` | Modelo `.onnx` (+ `.onnx.json` ao lado)                |

Setup do Piper e do modelo: `packages/voice/README.md`.

### P2P

| Variável        | Padrão         | Descrição                                         |
| --------------- | -------------- | ------------------------------------------------- |
| `P2P_TCP_PORT`  | `4400`         | Porta libp2p (TCP)                                |
| `P2P_HTTP_PORT` | `4401`         | Ponte HTTP (só `127.0.0.1`)                       |
| `P2P_NODE_NAME` | `planner-node` | Nome deste nó (vira o `origin` nos envelopes PLP) |

### Chamada de voz (Gemini Live)

| Variável                 | Padrão            | Descrição                                                                                          |
| ------------------------ | ----------------- | -------------------------------------------------------------------------------------------------- |
| `GEMINI_LIVE_API_KEY`    | —                 | Chave do Gemini **só** para a chamada de voz (editável em Configurações; nunca volta ao navegador) |
| `GEMINI_LIVE_MODEL`      | `gemini-3.8-live` | Modelo Live                                                                                        |
| `GEMINI_LIVE_VOICE`      | `Kore`            | Voz                                                                                                |
| `VOICE_ALLOWED_ORIGINS`  | _(vazio)_         | Origens extras autorizadas a ligar                                                                 |
| `LIVE_ALLOW_DESTRUCTIVE` | `false`           | Libera ferramentas de apagar por voz                                                               |

Exigem reiniciar o serviço de voz. Ver [VOICE-CALL.md](VOICE-CALL.md).

### Terminal

| Variável                   | Padrão    | Descrição                                                                                                                                                                        |
| -------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TERMINAL_PORT`            | `4500`    | Porta (escuta só em `127.0.0.1`)                                                                                                                                                 |
| `TERMINAL_ALLOWED_ORIGINS` | _(vazio)_ | Origens extras autorizadas a abrir terminais, separadas por vírgula. Já valem `http://localhost:4300` e `http://127.0.0.1:4300`; só é preciso se você mudar a porta do dashboard |
| `TERMINAL_MAX_SESSIONS`    | `8`       | Máximo de terminais abertos ao mesmo tempo                                                                                                                                       |
| `TERMINAL_IDLE_HOURS`      | `12`      | Horas sem nenhum cliente conectado até a sessão ser encerrada                                                                                                                    |

Os terminais herdam o ambiente do usuário **sem** as variáveis do `.env` do projeto e sem os marcadores de sessão do Claude Code.

### Web

| Variável                    | Padrão                  | Descrição                                                                                                                       |
| --------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_CORE_API_URL`  | `http://localhost:4000` |                                                                                                                                 |
| `NEXT_PUBLIC_AGENT_API_URL` | `http://localhost:4100` |                                                                                                                                 |
| `NEXT_PUBLIC_VOICE_API_URL` | `http://localhost:4200` |                                                                                                                                 |
| `NEXT_PUBLIC_P2P_HTTP_URL`  | `http://localhost:4401` | Usada só para o indicador de saúde                                                                                              |
| `NEXT_PUBLIC_TERMINAL_URL`  | `http://127.0.0.1:4500` | Serviço de terminal (REST e WebSocket). Como o servidor só escuta em loopback, o dashboard só abre terminais na própria máquina |
| `WEB_PORT`                  | —                       | **Não é lida por nenhum código.** A porta 4300 está fixa em `apps/web/package.json`                                             |

> O Next.js só carrega arquivos `.env*` da pasta **`apps/web`**, não o `.env`
> da raiz. Portanto as `NEXT_PUBLIC_*` do `.env` raiz não têm efeito: valem os
> padrões acima. Para apontar o dashboard para outros endereços (ex.: acessar
> de outro dispositivo), crie `apps/web/.env.local` com essas variáveis e
> reinicie o `web`.

## 3. Aba Configurações

Edita **17 chaves** (lista fechada em `SETTINGS_KEYS`):

`AGENT_PROVIDER` · `GROQ_API_KEY` · `GROQ_MODEL` · `GEMINI_API_KEY` ·
`GEMINI_MODEL` · `ANTHROPIC_API_KEY` · `ANTHROPIC_MODEL` · `PIPER_BIN` ·
`PIPER_MODEL` · `OBSIDIAN_VAULT_PATH` · `CLAUDE_CODE_CWD` ·
`MORNING_BRIEFING_ENABLED` · `MORNING_BRIEFING_HOUR` ·
`EVENT_REMINDER_ENABLED` · `EVENT_REMINDER_MINUTES` ·
`GOOGLE_TASKS_REMINDER_ENABLED` · `NOTIFICATION_SOUND_ENABLED`

Regras:

- **Segredos** (`GROQ_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`): `GET /settings` devolve `value: null` e `hasValue`. O campo é `type="password"`; deixado em branco, **mantém** o valor atual; preenchido, substitui.
- **Escrita:** substitui só as linhas `CHAVE=valor` existentes (ou acrescenta ao fim), preservando comentários e o resto do arquivo. Quebras de linha no valor viram espaço.
- **Validação:** chave fora da lista → `400 configuracao desconhecida: X`. O servidor **não** valida o _conteúdo_ (ex.: hora fora de 0–23 é gravada como veio).
- Portas, URLs internas e credenciais OAuth do Google **não** são editáveis pela tela, de propósito.

## 4. Google Cloud (OAuth)

1. Em https://console.cloud.google.com/apis/credentials crie um cliente OAuth ("Desktop app" ou "Web application").
2. Ative as APIs **Gmail**, **Calendar** e **Tasks** no mesmo projeto.
3. Se for "Web application", cadastre como URI de redirecionamento exatamente o valor de `GOOGLE_REDIRECT_URI`.
4. Preencha `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no `.env` e reinicie o Core.
5. No dashboard, clique em **+ Conectar conta** (ou abra `/integrations/google/auth` no Core). Repita para conectar outras contas.

Escopos pedidos: `gmail.readonly`, `calendar`, `tasks`, `userinfo.email`.
Contas conectadas antes de o escopo de Calendar passar de leitura para
escrita precisam **reconectar** para criar/editar eventos.

## 5. Segurança da configuração

- Nunca versione `.env` nem `data/`. Ambos estão no `.gitignore`.
- Antes de publicar o repositório, confirme com `git ls-files | grep -i env` (deve listar só `.env.example`) e que o `.env.example` contém apenas valores vazios ou não secretos.
- Se uma chave vazar (ex.: colada em issue, log ou commit), **revogue-a** no provedor e gere outra; remover do histórico git não basta.
