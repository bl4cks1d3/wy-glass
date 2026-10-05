# Planner Life

Sistema operacional pessoal de IA. Este repositorio contem a primeira versao
(v0.1) descrita na visao do projeto: um nucleo local (Planner Core), um
agente pessoal de IA, uma interface web e um no de rede P2P que ja pode
rodar tanto no computador principal quanto em um Raspberry Pi.

> A IA nao e dona dos dados. O Planner Life e o sistema que possui o
> contexto. Os agentes (Claude hoje, outros runtimes amanha) sao
> componentes substituiveis.

> **Documentação completa:** [docs/](docs/README.md) — especificação
> ([SPEC](docs/SPEC.md)), [arquitetura](docs/ARCHITECTURE.md),
> [API](docs/API.md), [modelo de dados](docs/DATA-MODEL.md),
> [agente](docs/AGENT.md), [configuração](docs/CONFIGURATION.md) e
> [guia de desenvolvimento](docs/DEVELOPMENT.md).

## Estrutura

```
planner-life/
├── packages/
│   ├── shared/     # Tipos e protocolo PLP (Planner Life Protocol) compartilhados
│   ├── core/       # Planner Core: NestJS + SQLite (projetos, tarefas, memoria, eventos)
│   ├── agent/      # Personal Agent: NestJS, harness com MCP + Skills sobre Groq/Gemini/Claude
│   │   └── skills/ # Pacotes de instrucoes (SKILL.md) carregados sob demanda
│   ├── voice/      # TTS local em portugues (Piper) - POST /speak
│   └── p2p-node/   # No de rede P2P (libp2p) - roda no PC e no Raspberry Pi
├── apps/
│   ├── web/        # Dashboard (Next.js) - agenda, projetos, "Planejar meu dia"
│   └── desktop/    # App desktop (Electron) - a mesma dashboard numa janela nativa
└── .mcp.json       # Servidores MCP que o Personal Agent conecta como cliente
```

| Pacote | Stack | Porta padrao |
| --- | --- | --- |
| `@planner-life/core` | NestJS + `node:sqlite` | 4000 |
| `@planner-life/agent` | NestJS + Groq/Gemini/Claude (plugavel), harness MCP + Skills | 4100 |
| `@planner-life/voice` | NestJS + Piper (TTS local, pt-BR) | 4200 |
| `@planner-life/p2p-node` | libp2p (TCP + mDNS + gossipsub) | 4400 (TCP), 4401 (bridge HTTP) |
| `@planner-life/web` | Next.js (App Router) | 4300 |

## Como rodar

Pre-requisitos: Node.js 22.5+ (usa `node:sqlite`, ainda experimental) e
`pnpm`.

### Instalacao automatica

Os scripts verificam os pre-requisitos, instalam as dependencias, criam o
`.env` (pedindo a chave de IA, se voce quiser), compilam o pacote
compartilhado e, opcionalmente, baixam a voz local (Piper). Podem ser
rodados de novo sem problema.

```powershell
# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
# opcoes: -WithVoice  -Shortcut  -NoDesktop  -Yes  -CheckOnly
```

```bash
# Linux, macOS e Raspberry Pi
bash scripts/install.sh
# opcoes: --with-voice  --no-desktop  --yes  --check
```

Depois: `pnpm dev` e abra http://localhost:4300. Se preferir fazer na mao:

```bash
pnpm install
cp .env.example .env
# preencha GROQ_API_KEY e/ou GEMINI_API_KEY no .env (veja a secao abaixo)
```

Build do pacote compartilhado (necessario antes de rodar core/agent):

```bash
pnpm --filter @planner-life/shared build
```

Suba os servicos (em terminais separados, ou `pnpm dev` para core+agent+web
juntos):

```bash
pnpm dev:core   # http://localhost:4000
pnpm dev:agent  # http://localhost:4100
pnpm dev:web    # http://localhost:4300
```

### App desktop (Electron)

Em vez de abrir o navegador em `localhost:4300`, da pra rodar o Planner
Life como um app de verdade, com janela e icone proprios:

```bash
pnpm desktop
```

Isso sobe o mesmo backend de `pnpm dev` (core, agent, voice, p2p-node) nos
bastidores, mostra uma tela de carregamento enquanto os servicos locais
ficam prontos, e abre a dashboard numa janela nativa (Electron) assim que
tudo estiver de pe. Fechar a janela derruba o backend junto -- nao fica
nada rodando escondido. O codigo esta em `apps/desktop/src/main.ts`.

**Atalho na area de trabalho (Windows):** ja existe um em
`C:\Users\<voce>\Desktop\Planner Life.lnk` -- clicar nele roda
`apps/desktop/scripts/start-hidden.vbs`, que chama `start.bat` (`cd` pra
raiz do repo + `pnpm desktop`) sem abrir nenhuma janela de console. Se
precisar recriar o atalho (outra maquina, apagou sem querer), os scripts
estao versionados em `apps/desktop/scripts/` -- so criar um atalho `.lnk`
apontando pro `start-hidden.vbs`.

Isso ainda e o modo desenvolvimento (o Electron so aponta pra um `pnpm dev`
rodando de verdade). Para gerar um instalador de verdade (.exe/.dmg/AppImage)
que empacota tudo, o proximo passo e `pnpm --filter @planner-life/desktop dist`
(usa `electron-builder`, configurado em `apps/desktop/package.json`), o que
exige antes buildar o Next.js em modo standalone e os servicos NestJS --
isso ainda nao esta automatizado.

### Provider de IA (free tier por padrao)

O `@planner-life/agent` nao esta preso a um modelo. Ele escolhe o provider
em tempo de execucao, na seguinte ordem de prioridade (todas com free
tier, exceto a ultima):

1. **Groq** (`GROQ_API_KEY`) - modelos abertos (Llama etc.) com free tier
   generoso e latencia muito baixa. Gere uma chave em
   https://console.groq.com/keys
2. **Gemini** (`GEMINI_API_KEY`) - free tier do Google AI Studio. Gere uma
   chave em https://aistudio.google.com/apikey
3. **Anthropic/Claude** (`ANTHROPIC_API_KEY`) - pago, mantido como opcao.

Basta preencher a chave da opcao que voce quiser usar no `.env` -- o
agente detecta sozinho qual delas esta configurada. Para forcar uma opcao
especifica (por exemplo, se voce tiver mais de uma chave preenchida), use
`AGENT_PROVIDER=groq|gemini|anthropic`. Os nomes de modelo (`GROQ_MODEL`,
`GEMINI_MODEL`, `ANTHROPIC_MODEL`) tambem sao configuraveis, ja que os
catalogos de modelos gratuitos mudam com frequencia.

Para conversar com o Personal Agent direto pelo terminal (sem passar pela
web):

```bash
pnpm --filter @planner-life/agent cli
```

### Harness: MCP e Skills

O Personal Agent nao e um tool-caller fechado -- ele e um **harness**: alem
das ferramentas nativas do Planner Core (criar/listar tarefas e projetos,
salvar memoria), ele pode:

- **Conectar em servidores MCP externos.** Liste-os em `.mcp.json` na raiz
  do projeto (mesmo formato do `.mcp.json` do Claude Code):

  ```json
  {
    "mcpServers": {
      "everything": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-everything"]
      }
    }
  }
  ```

  O agente conecta em cada servidor configurado ao subir e expoe as
  ferramentas deles pro modelo como `mcp__<servidor>__<ferramenta>`. Um
  servidor que falha ao conectar so gera um aviso no log -- nao derruba o
  agente.

- **Carregar Skills sob demanda.** Uma skill e uma pasta em
  `packages/agent/skills/<nome>/SKILL.md` com frontmatter (`name`,
  `description`) e instrucoes no corpo -- o mesmo mecanismo que o Claude
  Code usa consigo mesmo. O catalogo de skills disponiveis fica sempre no
  system prompt; o conteudo completo so e carregado quando o modelo chama
  a ferramenta `use_skill`. Ja vem uma skill de exemplo
  (`revisao-semanal`).

Isso vale para os tres providers (Groq, Gemini, Anthropic) igualmente --
trocar de modelo nunca muda quais ferramentas ou skills estao disponiveis.

### Google (Gmail, Calendar, Tasks -- multi-conta)

O `@planner-life/core` conecta na sua conta Google via OAuth (escopos
`gmail.readonly`, `calendar` -- leitura e escrita --, `tasks` e
`userinfo.email`) e da acesso real a:

- **Inbox**: sincroniza as mensagens do Gmail pro inbox do Planner Life
  (`GET /messages`), com leitura do corpo completo do e-mail
  (`GET /integrations/google/gmail/:id/body`) e marcação de tratada.
- **Agenda**: eventos de todas as agendas visiveis na conta -- a principal
  e as compartilhadas que voce ja habilitou no Google Calendar (agenda da
  familia inclusive) -- aparecem na view Hoje, e o agente pode criar,
  mover e cancelar eventos. Contas conectadas antes do escopo de escrita
  precisam reconectar.
- **Google Tasks**: CRUD completo (criar/listar/editar/concluir/excluir)
  direto na aba Tarefas, sem copia local (sempre busca ao vivo). Tarefas
  atrasadas ou que vencem hoje geram aviso (notificacao + som), repetido
  a cada 1h enquanto continuarem abertas.

Configure `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no `.env` (crie um
OAuth client em https://console.cloud.google.com/apis/credentials) e
ative as APIs Gmail, Calendar e Tasks no mesmo projeto. Depois, clique em
"+ Conectar conta" no dashboard (ou acesse `/integrations/google/auth`
direto no core) -- da pra conectar **mais de uma conta Google** repetindo
o fluxo, o Google mostra o seletor de conta a cada vez.

### CRM, Estudos, Pesquisa e Habitos

Alem de tarefas e projetos, o Planner Core tambem modela:

- **CRM** (`/clients`): clientes/leads por estagio (lead/contato/proposta/
  fechado), com funil calculado a partir dos dados reais.
- **Estudos** (`/subjects`, `/study`): disciplinas com progresso e data de
  prova, topicos (com prazo = entregas e leituras), cronograma semanal,
  Pomodoro e registro de sessoes -- independente de Projetos/Tarefas.
- **Pesquisa** (`/research/lines`, `/research/papers`): linhas de
  investigacao e fila de leitura de artigos.
- **Habitos** (`/habits`): qualquer habito com meta e valor atual (agua,
  treino, leitura...), sem widget especial hardcoded.

Todos tem CRUD completo tanto pela interface web (criar/editar/excluir em
cada view) quanto por ferramentas do Personal Agent -- peça pro agente
"cadastra um cliente novo" ou "cria uma disciplina" que funciona igual a
usar o formulario.

Para subir um no P2P (no seu PC, ou copiando o pacote `p2p-node` para um
Raspberry Pi rodando Node.js):

```bash
pnpm dev:p2p
```

Dois nos na mesma rede local se descobrem automaticamente via mDNS, se
conectam e passam a trocar eventos PLP (`task.created`, `project.updated`,
etc.) por gossipsub. O Planner Core ja publica automaticamente todo evento
do `PlannerEventBus` para o `p2p-node` local (`P2pBridgeService`, via HTTP
em `P2P_NODE_HTTP_URL`), que propaga para os outros dispositivos na rede --
essa e a base da "Rede P2P" da visao do projeto.

## O que ja funciona no v0.1

- [x] Planner Core com projetos, tarefas, memoria e log de eventos (SQLite local)
- [x] CRM, Estudos, Pesquisa e Habitos como modulos reais (CRUD completo,
      UI + ferramentas do agente)
- [x] Personal Agent com tool-use (Groq, Gemini ou Claude -- escolhido
      automaticamente pela chave configurada), CRUD completo em todos os
      modulos acima
- [x] Harness: cliente MCP (servidores externos em `.mcp.json`) + Skills
      carregadas sob demanda (`packages/agent/skills/`)
- [x] Integracao real com Google: Gmail (inbox + leitura de e-mail),
      Calendar (todas as agendas visiveis, incl. compartilhadas) e Tasks
      (CRUD ao vivo) -- multi-conta
- [x] Voz local em portugues (Piper) com botao "Ouvir resposta" no dashboard
- [x] Dashboard completo (Next.js): Hoje, Tarefas, Projetos, CRM, Estudos
      (com cronograma, topicos e Pomodoro), Pesquisa, Inbox, Notas
      (Obsidian), Terminal (Claude Code) e Configuracoes, com chat lateral
      e comando rapido conversando direto com o Personal Agent
- [x] No P2P (libp2p) capaz de descobrir, conectar e trocar eventos PLP com
      outros nos na rede local - mesmo codigo roda no PC e no Raspberry Pi
- [x] Bridge automatico `core -> p2p-node`: todo evento do
      `PlannerEventBus` (tarefas, projetos, memoria, clientes, habitos,
      pesquisa...) e publicado de verdade na rede PLP via gossipsub

## Proximos passos

- Persistir no Planner Core os eventos PLP recebidos de outros dispositivos
  (hoje o `p2p-node` so loga o que chega; falta um `onPlpEvent` -> escrita
  no banco local)
- Testar o `p2p-node` de verdade em um Raspberry Pi 3 (1GB RAM) na mesma
  rede do PC
- Agentes especializados adicionais (Research, Study, Coding, CRM,
  Planning) como novos providers dentro de `@planner-life/agent`
- Mais skills (a estrutura ja suporta, falta escrever as instrucoes: pesquisa,
  faculdade, revisao de codigo...)
- Integracao com GitHub
- Protocolo PLP com schema versionado e assinatura criptografica por no
  (identidade do dispositivo)

## Filosofia

Os pacotes `core`, `agent` e `p2p-node` sao deliberadamente separados: o
`core` guarda dados e regras, o `agent` e apenas um runtime de IA que fala
com o core por HTTP, e o `p2p-node` e so transporte. Trocar Claude por
outro modelo, ou trocar libp2p por outro protocolo, nao deveria exigir
tocar no `core`.
