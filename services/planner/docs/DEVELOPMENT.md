# Guia de desenvolvimento

## 1. Pré-requisitos

- **Node.js ≥ 22.5** (o Core usa `node:sqlite`, ainda experimental) e **pnpm**.
- Uma chave de IA (Groq ou Gemini têm free tier) para o chat — o resto funciona sem.
- Opcional: Claude Code instalado e autenticado (Terminal e pesquisa); Piper (voz); credenciais OAuth do Google.

## 2. Primeira execução

### 2.1 Instalador

| Sistema | Comando | Opções |
| --- | --- | --- |
| Windows | `powershell -ExecutionPolicy Bypass -File scripts\install.ps1` | `-CheckOnly` `-WithVoice` `-Shortcut` `-NoDesktop` `-Yes` |
| Linux / macOS / Raspberry Pi | `bash scripts/install.sh` | `--check` `--with-voice` `--no-desktop` `--yes` |

O que fazem, em ordem (idempotente — pode rodar de novo):

1. Confere **Node ≥ 22.5** (não instala Node por você) e ativa o **pnpm** via corepack se faltar.
2. Avisa se o **Claude Code CLI** não existe (só Terminal e Pesquisa dependem dele).
3. `pnpm install` (`--no-desktop` exclui o Electron, ~100 MB).
4. Cria o `.env` a partir do `.env.example` **só se ele não existir**; em modo interativo pergunta a chave do Groq (ou do Gemini), sem eco. Nunca sobrescreve um `.env` existente.
5. `pnpm --filter @planner-life/shared build`.
6. Voz (opcional): baixa o Piper e o modelo `pt_BR` para `packages/voice/vendor/`. Fora do Windows grava `PIPER_BIN` e `PIPER_MODEL` (caminhos reais) no `.env`; em Raspberry Pi/ARM usa a voz `low`.
7. Windows, opcional: atalho "Planner Life" na área de trabalho (`start-hidden.vbs`).
8. Cria `data/` e mostra as pendências (chave de IA, Google, Claude Code).

`--check`/`-CheckOnly` só verifica, sem alterar nada. `--yes`/`-Yes` não faz perguntas.

### 2.2 Manual

```bash
pnpm install
cp .env.example .env            # preencha ao menos uma chave de IA
pnpm --filter @planner-life/shared build
pnpm dev                        # shared (watch) + core + agent + web + voice
pnpm dev:p2p                    # em outro terminal (opcional)
```

Abra http://localhost:4300. Ou rode tudo como app de janela:

```bash
pnpm desktop                    # sobe backend, espera health, abre o Electron
```

| Script (raiz) | O que faz |
| --- | --- |
| `pnpm dev` | build do `shared` + `concurrently` de shared, core, agent, web e voice |
| `pnpm dev:core` / `dev:agent` / `dev:web` / `dev:voice` / `dev:p2p` | um serviço isolado |
| `pnpm desktop` | build do `shared` + Electron (que inicia `pnpm dev` e o p2p-node) |
| `pnpm build` | `pnpm -r build` |
| `pnpm typecheck` | `pnpm -r typecheck` em todos os pacotes |

Verificação rápida de saúde:

```bash
curl http://localhost:4000/health   # core
curl http://localhost:4100/health   # agent
curl http://localhost:4200/health   # voice
curl http://127.0.0.1:4401/health   # p2p-node
```

## 3. Estrutura do código

```
packages/core/src/
├── main.ts                  dotenv + Nest + CORS
├── app.module.ts            importa todos os módulos
├── db.ts                    schema + migrate() + openDatabase()
├── eventBus.ts              PlannerEventBus (EventEmitter)
├── database/                módulo global (token PLANNER_DB)
├── <dominio>/               *.controller.ts, *.service.ts, *.module.ts
├── repositories/<dominio>.ts  SQL puro
├── integrations/google/     auth, gmail, calendar, tasks
├── vault/  settings/  p2p-bridge/  events/

packages/agent/src/
├── main.ts  cli.ts  agent.controller.ts  agent.service.ts
├── tools.ts                 SYSTEM_PROMPT + AGENT_TOOLS + runTool
├── tool-registry.ts         une nativas + skills + MCP
├── providers/               groq | gemini | anthropic
├── mcp/  skills/  claude-code/  scheduler/
packages/agent/skills/<nome>/SKILL.md

apps/web/
├── app/page.tsx             busca tudo em paralelo (server)
├── app/dashboard-shell.tsx  navegação e views (client)
├── app/views/*.tsx          uma por aba
├── app/chat-panel.tsx  notifications-banner.tsx  claude-code-approvals.tsx
└── lib/api.ts               tipos + todas as chamadas HTTP
```

## 4. Convenções

- **Camadas do Core:** controller valida entrada → service aplica regra e emite eventos → repository faz SQL. Não pule camadas.
- **Toda mutação** chama `eventsService.record(tipo, payload)` **e** `eventBus.publish(tipo, payload)`. Tipos novos entram em `PlpEventType` (`packages/shared/src/types.ts`).
- **Validação de entrada** no controller, com `BadRequestException` e mensagem em português.
- **Mapeamento:** coluna `snake_case` no banco, `camelCase` no tipo.
- **Comentários:** só quando o *porquê* não é óbvio (restrição escondida, contorno de bug). Não descreva o que o código já diz.
- **Idioma:** mensagens ao usuário e docs em português; identificadores em inglês.
- **Segurança:** nunca `shell: true` com dados externos; nunca devolver segredo ao navegador; nunca aceitar caminho sem `resolveSafe`.
- **Sem testes automatizados** no repositório hoje: valide com `pnpm typecheck` e exercitando a API/interface. Ao adicionar lógica com regra (ex.: cooldown de avisos), teste manualmente o caso de borda.

## 5. Como estender

### 5.1 Novo módulo no Core (ex.: "Livros")

1. Tabela em `db.ts` (`CREATE TABLE IF NOT EXISTS`). Se for coluna nova em tabela existente, também uma verificação em `migrate()`.
2. Tipo em `packages/shared/src/types.ts` (+ tipos de evento em `PlpEventType`) e **rebuild do shared**.
3. `repositories/livros.ts`, `livros/livros.service.ts`, `livros.controller.ts`, `livros.module.ts`.
4. Registrar o módulo em `app.module.ts`.
5. Ferramentas no Agent (`AGENT_TOOLS` + `runTool`) — ver [AGENT.md §9](AGENT.md).
6. `lib/api.ts` (tipo + funções), busca em `page.tsx`, prop em `DashboardShell`, nova view em `app/views/` e item em `NAV`/`ViewId`.
7. Documentar a rota em [API.md](API.md) e a tabela em [DATA-MODEL.md](DATA-MODEL.md).

### 5.2 Nova Skill
Crie `packages/agent/skills/<nome>/SKILL.md` com `name` e `description` no frontmatter e reinicie o Agent.

### 5.3 Novo servidor MCP
Adicione em `.mcp.json` (`command`, `args`, `env`) e reinicie o Agent.

### 5.4 Nova configuração editável
Adicione a chave em `SETTINGS_KEYS` (`settings.controller.ts`), se for segredo em `SECRET_KEYS` (`settings.service.ts`), no `.env.example` e na `SettingsView.tsx`. Decida se vale ao vivo (lida por HTTP) ou exige reinício e documente em [CONFIGURATION.md](CONFIGURATION.md).

## 6. Armadilhas conhecidas (principalmente no Windows)

| Sintoma | Causa | Solução |
| --- | --- | --- |
| Editei o código e **nada mudou** | `ts-node-dev --respawn` tenta reiniciar, falha com `EADDRINUSE` porque o processo antigo ainda segura a porta, e o antigo continua servindo código velho | Encerrar todos os `node.exe` do projeto e subir limpo (comando abaixo) |
| Tipos novos do `shared` não aparecem em outros pacotes | Os pacotes consomem o **build** do `shared` | `pnpm --filter @planner-life/shared build` |
| `spawn EINVAL` ao chamar `claude` | `.cmd` não executa sem shell no Windows | Já tratado: `resolveClaudeBin()` chama o `claude.exe` real. Não troque por `shell: true` (injeção) |
| Acentos viram `�` em `curl -d` | Codificação do shell | Gravar o JSON em arquivo e usar `--data-binary @arquivo.json` |
| Notificação do navegador sem som | Web Audio exige gesto do usuário | Clicar em qualquer ponto da página uma vez |
| Google: "conta não conectada" / eventos não criam | Escopo antigo (`calendar.readonly`) ou token expirado sem refresh | Reconectar a conta em **+ Conectar conta** |
| Alterei o vault nas Configurações e nada aconteceu | `OBSIDIAN_VAULT_PATH` é lido só ao iniciar o Core | Reiniciar o Core |
| Chat perdeu o contexto | Histórico em memória do Agent | Esperado após reiniciar o Agent |

### Reinício limpo no Windows (PowerShell)

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*PlannerLIfe*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
netstat -ano | findstr "LISTENING" | findstr ":4000 :4100 :4200 :4300 :4400 :4401"   # deve vir vazio
pnpm dev
```

Ajuste `*PlannerLIfe*` para o nome da pasta onde o repositório está.

## 7. Como validar mudanças

1. `pnpm typecheck` (todos os pacotes).
2. Subir a stack limpa (§6) e conferir os 4 `/health` + `http://localhost:4300` (200).
3. Exercitar a rota/tela alterada. Para UI, use o navegador de verdade: caminho feliz **e** bordas (campo vazio, id inexistente).
4. Para rotinas agendadas, confira `GET /notifications/pending` no próximo múltiplo de 5/10 minutos.

## 8. Checklist antes de publicar o repositório

- [ ] `git ls-files | grep -Ei '(^|/)\.env'` lista **apenas** `.env.example`.
- [ ] `git ls-files | grep -Ei '\.db$|\.wav$|\.onnx|vendor/'` vem vazio.
- [ ] Nenhum valor real do seu `.env` aparece na árvore nem no histórico (`git log --all -p -S"<valor>"`).
- [ ] Padrões de chave ausentes: `gsk_`, `GOCSPX-`, `AIza`, `sk-ant-`, `ghp_`, `-----BEGIN … PRIVATE KEY`.
- [ ] O e-mail de autor dos commits é aceitável ser público (ou use o e-mail `noreply` do GitHub).
- [ ] `data/`, `.claude/` e `packages/voice/vendor/` seguem no `.gitignore`.
