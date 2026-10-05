# Especificação do Produto — Planner Life

Versão do documento: 1.0 · Versão do produto: 0.1 (`package.json`) · Estado: implementado e em uso.

## 1. Visão

Uma ferramenta única para **planejamento pessoal e acompanhamento**, com um
assistente conversacional ("Jarvis pessoal") que enxerga e opera todos os
seus dados: agenda, tarefas, projetos, estudos, pesquisa, clientes, hábitos,
e-mail e notas em markdown.

### 1.1 Princípios

1. **Os dados são do usuário e ficam locais.** SQLite em disco + arquivos `.md`. Nada depende de um serviço proprietário do Planner Life.
2. **A IA é substituível.** O agente fala com o Core por HTTP, e o provider (Groq, Gemini, Anthropic) é escolhido por configuração. Trocar de modelo não muda ferramentas nem dados.
3. **Humano na decisão para ações de alto impacto.** O agente nunca executa código na máquina sozinho: ele só cria um pedido pendente para o usuário confirmar (§4.11).
4. **Custo zero por padrão.** Groq e Gemini têm free tier; voz é local (Piper); reconhecimento de voz usa o navegador.
5. **Funciona sem rede.** Core, agente local (com chave), vault e dashboard funcionam offline em relação à rede P2P e ao Google.
6. **Tudo tem CRUD completo**, tanto pela interface quanto por ferramentas do agente ("cadastra um cliente" funciona igual ao formulário).

### 1.2 Usuário-alvo

Uma única pessoa, em um computador principal (Windows é o ambiente de
desenvolvimento e uso atual), opcionalmente com um Raspberry Pi como nó
secundário. **Não há multiusuário, login nem controle de acesso** (ver §7 e §8).

## 2. Escopo

### 2.1 Dentro do escopo (v0.1)

Tarefas, projetos, memória, CRM, estudos, pesquisa, hábitos, inbox (Gmail),
agenda (Google Calendar com CRUD), Google Tasks (CRUD), notas/vault
(Obsidian), terminal Claude Code, chat com voz, notificações proativas,
configurações, nó P2P (publicação) e app desktop.

### 2.2 Fora do escopo (hoje)

- Persistir no Core os eventos PLP **recebidos** de outros dispositivos (o nó só os loga).
- Autenticação, multiusuário, criptografia em repouso, backup automático.
- Instalador empacotado (`electron-builder` configurado, mas sem pipeline de build).
- Integração com GitHub, agentes especializados por domínio, assinatura criptográfica do protocolo PLP.
- Aplicativo móvel.

## 3. Módulos e mapa da interface

O dashboard (Next.js) tem 13 abas. Cada aba corresponde a um módulo:

| Aba           | Módulo                                                                         | Dados                                                                 | Origem           |
| ------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ---------------- |
| Painéis       | Dashboard/Canvas montado com blocos (há um painel Básico embutido)             | `dashboards`, `blocks`                                                | Core             |
| Construtor    | Cria blocos (HTML+CSS+JS), permissões, aprovação                               | `blocks`, `collections`                                               | Core + Agent     |
| Hoje          | Painel do dia                                                                  | Agenda, tarefas do dia, hábitos, eventos recentes, saúde dos serviços | Core + Google    |
| Tarefas       | Tarefas locais + Google Tasks                                                  | `tasks`, Google Tasks                                                 | Core + Google    |
| Projetos      | Projetos e progresso                                                           | `projects`, `tasks`                                                   | Core             |
| CRM           | Clientes e funil                                                               | `clients`                                                             | Core             |
| Estudos       | Disciplinas, cronograma, tópicos/entregas, Pomodoro                            | `subjects`, `study_*`, `schedule_blocks`                              | Core             |
| Pesquisa      | Linhas, fila de artigos, leitura, pesquisa via Claude Code                     | `research_lines`, `papers`, vault                                     | Core + Agent     |
| Inbox         | E-mails do Gmail                                                               | `messages`                                                            | Core + Google    |
| Notas         | Vault markdown (Obsidian)                                                      | arquivos `.md`                                                        | Core (vault)     |
| Terminal      | Canvas de terminais reais (Claude Code, Agente Planner, Shell) + prompt rápido | Sessões no serviço `terminal`; layout no navegador                    | Terminal + Agent |
| Memória       | Memória de longo prazo do agente                                               | `memory_entries`                                                      | Core             |
| Configurações | Chaves, modelos, notificações                                                  | `.env`                                                                | Core             |

Além das abas: painel de chat lateral (voz, "ouvir resposta"), comando
rápido, cartões de aprovação do Claude Code e toasts de notificação.

## 4. Requisitos funcionais

Convenção: **RF-x.y** = requisito; **CA** = critério de aceite verificável.

### 4.1 Tarefas e projetos

- **RF-1.1** Criar, listar (filtro por `status` e `projectId`), editar (`title`, `projectId`, `dueAt`, `notes`), mudar status e excluir tarefas.
- **RF-1.2** Status válidos: `pending`, `in_progress`, `done`, `cancelled`.
- **RF-1.3** Criar, listar, editar (`name`, `goal`, `progress` 0–100) e excluir projetos.
- **RF-1.4** Excluir um projeto exclui suas tarefas.
- **CA** `POST /tasks` sem `title` → 400. `PATCH /tasks/:id/status` com status inválido → 400.

### 4.2 Memória de longo prazo

- **RF-2.1** O agente pode salvar (`save_memory`), listar e apagar fatos/preferências com `tags`. Origem registrada em `source` (`personal-agent` quando vem do agente).
- **RF-2.2** A aba Memória lista e remove entradas.

### 4.3 CRM

- **RF-3.1** Clientes com `stage` ∈ {`lead`, `contact`, `proposal`, `closed`}, `value` (R$), `nextAction` e `nextActionAt`.
- **RF-3.2** Funil calculado a partir dos dados reais (sem valores fixos na interface).
- **CA** Estágio inválido → 400 na criação e na edição.

### 4.4 Estudos

Estudos é **exclusivo para estudar** e independe de Projetos/Tarefas.
Cobre faculdade, estudo próprio e cursos livres (idiomas etc.): cada
"disciplina" é apenas um contêiner com nome.

- **RF-4.1 Disciplinas:** nome, progresso 0–100, nota livre, **data de prova** (`examDate`). A interface mostra um selo com a contagem regressiva até a prova.
- **RF-4.2 Tópicos:** checklist de conteúdo por disciplina (`done` marcável).
- **RF-4.3 Entregas e leituras:** um tópico com `dueAt` preenchido é uma entrega/leitura com prazo. A seção "Entregas e leituras" lista os tópicos com prazo e não concluídos, de **qualquer** disciplina, ordenados por data, com o nome da disciplina. **Não usa a entidade Tarefa.**
- **RF-4.4 Cronograma semanal:** blocos fixos (`dayOfWeek` 0=domingo…6=sábado, `startTime`/`endTime` `HH:MM`) por disciplina, exibidos em grade de 7 colunas.
- **RF-4.5 Pomodoro:** 25 min de foco / 5 min de pausa, com disciplina opcional.
  - Só registra uma `StudySession` quando o bloco de foco **termina naturalmente** ou o usuário clica "Parar e registrar" com **≥ 1 minuto** decorrido.
  - Pausar não registra nada.
- **RF-4.6 Sessões:** histórico de tempo estudado, com resumo por disciplina; o agente também pode registrar manualmente ("estudei 30 min de cálculo").
- **CA** `POST /study/schedule` com `dayOfWeek` fora de 0–6 → 400. `PATCH /study/topics/:id` exige `done` booleano.

### 4.5 Pesquisa

- **RF-5.1** Linhas de investigação (`name`, `stage`, `refs`, `nextStep`) e fila de artigos (`status` ∈ {`na_fila`, `em_leitura`, `resumido`}, `source`, linha opcional).
- **RF-5.2 Pesquisar um tema:** o usuário digita um **tema** e clica "Pesquisar com Claude Code". O Claude Code (via `claude -p`) faz a pesquisa.
  1. `POST /research/request {theme}` no Agent cria um pedido pendente do tipo `research`.
  2. O cartão de aprovação aparece no dashboard; ao **confirmar**, o Claude Code executa.
  3. O resultado é salvo como nota em `Pesquisas/<slug>-<timestamp>.md` no vault **e** vira um artigo com status `resumido` e `notePath`.
  4. O artigo aparece na aba Pesquisa sem recarregar a página.
- **RF-5.3 Pesquisa pelo chat:** "pesquisa sobre X" faz o agente usar `create_research_note` (nota + artigo vinculado). `create_note` sozinho não deve ser usado para pesquisa (deixaria a nota órfã).
- **RF-5.4 Leitura:** abrir um artigo com nota o renderiza como leitura de livro/artigo dentro do dashboard.
- **RF-5.5 Exclusão:** existe botão **Excluir** na leitura, com confirmação. Excluir um artigo **apaga também a nota do vault** vinculada. Falha ao apagar a nota é registrada em log e não impede a exclusão do artigo.
- **RF-5.6** Excluir uma linha de pesquisa **não** exclui seus artigos (ficam sem linha).

### 4.6 Inbox (Gmail)

- **RF-6.1** Sincronizar as mensagens mais recentes do Gmail (por conta, `limit` padrão 10) para `messages`. IDs no formato `gmail-<conta>-<idGmail>`.
- **RF-6.2** Ler o corpo completo (texto e HTML) de um e-mail sincronizado. O HTML é renderizado em quadro isolado.
- **RF-6.3** Marcar como tratada/não tratada; excluir uma; limpar tudo. **Excluir é só a cópia local** — nada muda no Gmail; uma nova sincronização traz de volta o que ainda existir lá.
- **RF-6.4** Escopo `gmail.readonly`: o Planner Life nunca altera o Gmail.

### 4.7 Agenda e Google Tasks

- **RF-7.1 Calendar:** listar próximos eventos de **todas** as agendas visíveis na conta (inclusive compartilhadas, como a da família), criar, mover/editar e cancelar eventos. IDs compostos `calendarId:eventId`.
- **RF-7.2 Google Tasks:** CRUD completo, sempre **ao vivo** (sem cópia local, `no-store`).
- **RF-7.3 Multi-conta:** várias contas Google conectadas ao mesmo tempo; operações aceitam `account` (e-mail) quando há mais de uma.
- **RF-7.4 Sincronizar:** botão "🔄 Sincronizar" nas Google Tasks. Como a lista já é buscada ao vivo, ele é um recarregamento com feedback visual, não uma correção de dados.
- **RF-7.5 Reconexão:** contas conectadas antes da mudança de escopo para `calendar` (escrita) precisam reconectar para criar/editar eventos.

### 4.8 Hábitos

- **RF-8.1** Qualquer hábito com `unit`, `target` e `current` (água, treino, leitura…). Sem widgets fixos.

### 4.9 Notas (vault / Obsidian)

- **RF-9.1** O vault é uma pasta de arquivos `.md`. Se `OBSIDIAN_VAULT_PATH` estiver definida, usa o vault real do Obsidian; senão, `data/vault`. O app Obsidian **não** é necessário.
- **RF-9.2** Listar (ordenado por atualização, com título e trecho), ler, criar/sobrescrever, apagar e buscar (título e conteúdo). O título vem do primeiro `# Título` ou do nome do arquivo.
- **RF-9.3** **Segurança de caminho:** nenhum caminho pode escapar da raiz do vault (`../..` → 400 `caminho fora do vault`). Arquivos/pastas iniciados por `.` são ignorados na listagem.
- **RF-9.4** `write` acrescenta `.md` quando ausente e cria pastas intermediárias.

### 4.10 Agente conversacional

- **RF-10.1** Chat em português com **uso de ferramentas** (72 nativas, mais `use_skill` e as de servidores MCP) cobrindo todos os módulos, Google, vault e Claude Code (catálogo em [AGENT.md](AGENT.md)).
- **RF-10.2** Provider escolhido por `AGENT_PROVIDER` ou, se vazio, pela primeira chave existente (Groq → Gemini → Anthropic).
- **RF-10.3** O agente sobe e responde `/health` mesmo sem nenhuma chave; o erro de chave ausente só ocorre na primeira mensagem, com mensagem explicativa.
- **RF-10.4** Harness extensível: servidores **MCP** em `.mcp.json` (ferramentas `mcp__<servidor>__<ferramenta>`) e **Skills** (`packages/agent/skills/<nome>/SKILL.md`) carregadas sob demanda por `use_skill`.
- **RF-10.5** Respostas em texto simples (sem tabelas, `#` ou blocos de código), pois o painel não renderiza markdown. Listas com `-`.
- **RF-10.6 Voz:** botão "🔊 ouvir" gera fala local (Piper, `POST /speak` → `audio/wav`); botão de microfone usa a Web Speech API (só Chrome/Edge; escondido onde não houver suporte).
- **RF-10.7** Atalhos rápidos: "Planejar meu dia", "O que está atrasado?", "Faz minha revisão semanal".

### 4.11 Claude Code (terminal)

Dois caminhos, com **regras de confirmação diferentes de propósito**:

| Caminho                    | Quem decide      | Confirmação                                                            | Endpoint                    |
| -------------------------- | ---------------- | ---------------------------------------------------------------------- | --------------------------- |
| Agente (`run_claude_code`) | IA               | **Obrigatória**: cria pedido pendente, o usuário confirma no dashboard | `GET/POST /claude-code/...` |
| Aba Terminal               | Humano digitando | **Implícita** (enviar já é confirmar): executa na hora                 | `POST /claude-code/run`     |

- **RF-11.1** Execução via `claude -p <prompt>` (modo não interativo), `cwd` = parâmetro, senão `CLAUDE_CODE_CWD`, senão o diretório do processo. Timeout de 5 min; saída máxima 10 MB.
- **RF-11.2** **Sem shell.** No Windows resolve o `claude.exe` real em `%APPDATA%\Claude\claude-code\<versão>\` e o chama direto. Isso evita `spawn EINVAL` (shim `.cmd`) **e** injeção de comando (com `shell: true` o Node não escapa argumentos — `DEP0190`). Um prompt com `"`, `&` ou `|` chega como texto literal.

**Terminal embutido (aba Terminal → Canvas)** — inspirado no canvas do Maestri:

- **RF-11.4** A aba Terminal tem dois modos: **Canvas** (padrão) e **Prompt rápido** (o `claude -p` de RF-11.1).
- **RF-11.5** No Canvas o usuário abre vários **terminais reais** (xterm.js sobre PTY): **Claude Code** (sessão interativa), **Agente Planner** (`pnpm cli`) e **Shell**. Como é o humano digitando, não há confirmação (mesma lógica da aba Terminal).
- **RF-11.6** Cada terminal é uma janela: **arrastar** pela barra de título, **redimensionar** pelo canto (o terminal reajusta as colunas/linhas), **fechar** com × (confirma antes de encerrar um processo ativo), **traz para a frente** ao clicar. O fundo é navegável (arrastar), com **Organizar** (grade) e **Recentralizar**. Indicador de estado: ativo, conectando, sem conexão, encerrado.
- **RF-11.7** **Persistência:** os processos vivem no servidor. Trocar de aba do dashboard ou recarregar a página **não** os encerra; ao voltar, o histórico recente (256 KB) é reexibido. A posição e o tamanho das janelas ficam no `localStorage` do navegador.
- **RF-11.8** Ctrl+C **copia** quando há texto selecionado; sem seleção, segue como interrupção para o processo.
- **RF-11.9** Limites: 8 terminais simultâneos; sessão sem cliente por 12 h é encerrada.
- **RF-11.10** A área do canvas ocupa exatamente a altura disponível da janela, de modo que o rodapé dos terminais (caixa de entrada do Claude Code) fica sempre visível.
- **RF-11.11** Os terminais não herdam o `.env` do projeto nem os marcadores de sessão do Claude Code.
- **CA** Abrir um Shell, executar um comando, trocar de aba e voltar mostra o comando e a saída; recarregar a página reconecta com estado "ativo". Uma origem que não seja o dashboard não consegue criar sessão nem abrir o WebSocket (403).

- **RF-11.3** Pedidos pendentes ficam **em memória** (perdem-se ao reiniciar o Agent).

### 4.12 Notificações proativas

O Jarvis avisa sozinho. Três rotinas no Agent (`@nestjs/schedule`), lendo a
configuração ao vivo do Core a cada execução:

| Rotina               | Cron          | Regra                                                                                              | Repetição                                |
| -------------------- | ------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Resumo da manhã      | a cada 10 min | Hora local = `MORNING_BRIEFING_HOUR` (padrão 8)                                                    | 1×/dia                                   |
| Compromisso em breve | a cada 5 min  | Evento começa em `(0, EVENT_REMINDER_MINUTES]` (padrão 15)                                         | 1×/evento                                |
| **Google Tasks**     | a cada 10 min | Tarefa `needsAction` **com prazo** ≤ hoje: "Tarefa atrasada" (prazo < hoje) ou "Tarefa vence hoje" | **a cada 1 h enquanto continuar aberta** |

- **RF-12.1 Repetição das Google Tasks:** enquanto a tarefa permanecer na lista sem ser concluída, o aviso se repete a cada hora (o cooldown é por tarefa; como o cron roda de 10 em 10 min, o intervalo efetivo fica entre 60 e 70 min). Concluir/excluir a tarefa encerra os avisos sozinho. Tarefas **sem prazo** nunca avisam; o Google Tasks só guarda **data**, sem horário, por isso não existe "faltam X minutos".
- **RF-12.2 Canais:** o app desktop mostra notificação nativa do SO (som padrão do sistema); o dashboard mostra um toast com **aviso sonoro** (dois tons gerados por Web Audio, sem arquivo de áudio), controlado por `NOTIFICATION_SOUND_ENABLED`. Só notificações realmente novas tocam o som. O navegador só libera áudio após o primeiro clique/tecla na página.
- **RF-12.3** Cada rotina pode ser desligada em Configurações e vale imediatamente (sem reiniciar).

### 4.13 Configurações

- **RF-13.1** Aba com: provedor e modelos de IA, chaves (Groq, Gemini, Anthropic), voz (Piper), pasta do vault, pasta do Claude Code e as notificações proativas.
- **RF-13.2 Segredos:** chaves `*_API_KEY` **nunca** voltam ao navegador em texto puro (só `hasValue`). Campo secreto vazio + já configurado = "manter o valor atual".
- **RF-13.3 Lista fechada:** apenas 17 chaves são editáveis (§ [CONFIGURATION.md](CONFIGURATION.md)); chave desconhecida → 400. Portas e URLs internas ficam de fora de propósito.
- **RF-13.4** A gravação preserva comentários e o restante do `.env`.
- **RF-13.5** Só as configurações lidas ao vivo (notificações) valem na hora; o resto exige reiniciar o serviço afetado.

### 4.14 Rede P2P

- **RF-14.1** Nó libp2p (TCP + noise + yamux + mDNS + gossipsub) que descobre pares na LAN, conecta e troca eventos PLP no tópico `planner-life/events/v1`. O mesmo código roda no PC e no Raspberry Pi.
- **RF-14.2** O Core publica **todo** evento do `PlannerEventBus` no nó local via ponte HTTP (`POST 127.0.0.1:4401/publish`). Se o nó estiver desligado, o Core continua normalmente (falha silenciosa em `debug`).

### 4.15 App desktop

- **RF-15.1** `pnpm desktop` sobe o backend, mostra uma tela de carregamento até core/agent/voice/web responderem `ok` (limite 120 s) e abre a dashboard em janela Electron. Fechar a janela derruba todo o backend (árvore de processos).
- **RF-15.2** Faz polling de notificações a cada 30 s e as exibe como notificação nativa.

### 4.16 Painéis e Construtor (dashboard maleável)

Detalhes técnicos em [BUILDER.md](BUILDER.md).

- **RF-16.1 Blocos:** um bloco é `html` + `css` + `js` (função `planner.main`) + permissões `read`/`write`/`tools`. Roda isolado (iframe `sandbox="allow-scripts"`, CSP sem rede) e só acessa dados/ferramentas por uma ponte que confere as permissões a cada chamada.
- **RF-16.2 Aprovação:** blocos criados por agente/API nascem **não aprovados** e não acessam nada; o usuário aprova no Construtor. Editar código ou permissões revoga a aprovação (salvo a mudança já vir aprovada pelo Construtor).
- **RF-16.3 Construtor:** lista de blocos, editor HTML/CSS/JS, **pré-visualização ao vivo** com console (log e erros), permissões (incluindo as coleções do usuário e ferramentas), aba **Componentes** do design system, duplicar/excluir, e **"Gerar com IA"**.
- **RF-16.4 Painéis:** cada painel tem blocos posicionados e abre em **modo Dashboard** (grade de 12 colunas) ou **modo Canvas** (posição livre, fundo navegável); o modo é alternável e lembrado. Editar layout: arrastar, redimensionar, adicionar (`+ Bloco`) e remover; salva sozinho. Janela estreita empilha os blocos.
- **RF-16.5 Embutidos:** o painel **Básico** e 7 blocos (`builtin-*`: resumo, tarefas, compromissos, relógio, hábitos, projetos, entregas) vêm prontos, são **somente leitura** (403 ao editar/excluir) e reaplicados a cada subida; duplique para editar. Excluir um bloco o remove dos painéis.
- **RF-16.6 Design system e modais:** todo bloco recebe as classes/variáveis do design system. `ctx.ui.modal` abre um modal de **tela cheia** (iframe próprio, herda as permissões do bloco, devolve valor via `planner.close`); há também `ctx.ui.confirm` e `ctx.ui.toast`. Os modais são construídos com HTML/CSS/JS pelo próprio Claude ou pelo usuário.
- **RF-16.7 Agente:** 7 ferramentas (`list_blocks`, `get_block`, `save_block`, `delete_block`, `list_dashboards`, `save_dashboard`, `delete_dashboard`) e a skill `criar-bloco`. O agente **nunca aprova** o que cria.
- **RF-16.8 Ferramentas por bloco:** `ctx.tool(nome, args)` chama ferramentas do Agent (inclusive de servidores MCP) via `POST /tools/call`, só as declaradas no bloco; `run_claude_code` e `use_skill` são vetadas.
- **CA** Um bloco aprovado só com leitura de `tasks` não consegue `fetch`, ler `memory`, gravar, chamar ferramenta não declarada, acessar `parent.document`/`localStorage`/cookies nem executar `<script>`/`onerror` injetados. Salvar a edição num modal do bloco _Tarefas_ grava no banco e atualiza o bloco.

### 4.17 Banco sob medida (coleções)

- **RF-17.1** O usuário (ou o Claude) define **coleções** com esquema — campos `text`, `longtext`, `number`, `date`, `boolean`, `select` (com `options`), `required` — e cria/edita/exclui **registros** validados contra o esquema.
- **RF-17.2** Nomes seguros (`a-z0-9_`), `id`/`createdAt`/`updatedAt` reservados, campo desconhecido rejeitado, número/data/opção coeridos ou rejeitados com mensagem clara. Alterar o esquema não apaga dados; excluir a coleção apaga os registros. Limites: 40 campos, 10 000 registros por coleção.
- **RF-17.3** Consulta com busca (`q`), ordenação, paginação e filtro de igualdade por campo.
- **RF-17.4** Os blocos acessam uma coleção como o recurso `col:<nome>` (leitura e escrita com permissão); mutações geram eventos `collection.*`/`record.*` (e vão para o P2P).

### 4.18 Claude como construtor (MCP)

Detalhes em [MCP.md](MCP.md).

- **RF-18.1** Servidor MCP `planner-life` (`packages/mcp`, stdio) exposto ao Claude Code por `.mcp.json`. Oferece as ferramentas de **banco** (7), `planner_guide`, **todas** as ferramentas do Agent (descobertas dinamicamente) — 79 no total —, o prompt `construir-sistema` (argumento `situacao`) e o recurso `planner://guia-construtor`.
- **RF-18.2** O usuário descreve a situação; o Claude modela coleções, cria blocos e monta o painel em **canvas**, e diz o que precisa ser aprovado no Construtor.
- **RF-18.3** `run_claude_code` e `use_skill` não são expostas. O Agent ignora o servidor `planner-life` em `.mcp.json` (evita recursão).
- **RF-18.4** A aba Terminal informa se o **Claude Code está instalado** (versão) e desabilita "+ Claude Code" se não estiver; os instaladores também avisam.

### 4.19 Workspace (canvas estilo Maestri) e visual

Detalhes em [ARCHITECTURE.md](ARCHITECTURE.md) §3.8.

- **RF-19.1 Tela principal:** a dashboard abre num **workspace** — canvas infinito de pontos com barra de ferramentas flutuante (selecionar, terminal, bloco, nota, organizar), controles no canto (camadas, assistente, minimapa, zoom −/%/+) e barra lateral com **Workspaces** (criar, renomear, excluir), **Módulos** (as telas clássicas: Hoje, Tarefas, Projetos, CRM, Estudos, Pesquisa, Inbox, Notas, Memória, Painéis, Construtor, Terminal (prompt), Configurações) e **Integrações** (Google).
- **RF-19.2 Itens:** cada workspace guarda **terminais** (Claude Code, Assistente, Shell — sessões PTY reais do serviço `terminal`), **blocos** do Construtor (mesmo sandbox e aprovação de RF-16) e **notas** de texto. Cada item tem barra de título (mover), canto (redimensionar), fechar e traz para frente ao clicar. Terminais continuam rodando ao trocar de workspace; fechar o item encerra a sessão.
- **RF-19.3 Navegação:** arrastar o fundo move; `Ctrl` + roda dá zoom ancorado no cursor (25 %–200 %); roda simples sobre o fundo move. O zoom é **semântico**: posições e tamanhos escalam, a fonte do terminal escala e os blocos são reduzidos via CSS, mantendo a seleção de texto exata.
- **RF-19.4 Persistência:** posição, tamanho, ordem, viewport e o conteúdo das notas ficam no Core (`workspaces`), salvos 700 ms após a última mudança e ao sair. Cada gravação leva a versão vista pelo cliente; se outra janela gravou antes, o Core responde **409** e o cliente **para de gravar** e avisa, em vez de sobrescrever (L14). Só criar/renomear/excluir geram evento.
- **RF-19.5 Primeira execução:** cria o workspace **Início** com os blocos embutidos (resumo, relógio, tarefas, compromissos) e uma nota de boas-vindas.
- **RF-19.6 Tema:** escuro por padrão (estilo Maestri) e claro alternável no rodapé da barra lateral; a escolha fica em `localStorage` (`planner.theme`) e vale para o app, o Construtor e os iframes dos blocos (o design system recebe as variáveis do tema).
- **RF-19.7 Telas estreitas:** abaixo de 900 px a barra lateral vira gaveta (botão de menu); o assistente abre como gaveta sobre o canvas.
- **CA** Mover/redimensionar/zoom persistem e reaparecem após recarregar; trocar de workspace e voltar não perde itens; duas janelas abertas não se sobrescrevem silenciosamente.

### 4.20 Automações (motor nativo no canvas)

Detalhes em [AUTOMATIONS.md](AUTOMATIONS.md).

- **RF-20.1 Motor:** o Core executa automações como grafo de nós (gatilho manual, agendamento cron, uma vez, evento; ações de ferramenta, aviso, assistente e registro; leitura de dados; condição e definição de campos), com dados por nó, simulação (dry) e expressões seguras sem `eval`. Um runner dispara os gatilhos das automações ativas.
- **RF-20.2 Editor no canvas:** editor em React Flow (`AutomationEditor`), usado pelo nó `automation` do workspace e pelo módulo **Automações** (lista + tela cheia). Menu **Automações**: _Automação com Claude_ (terminal Claude Code orientado a automações + editor lado a lado).
- **RF-20.3 Linguagem natural:** o usuário descreve o que quer e o Claude Code (MCP `planner-life`) monta o grafo com `automation_nodes`, `list_automations`, `get_automation`, `save_automation`, `run_automation`, `automation_runs`, `delete_automation` (prompt `construir-automacao`). O `save_automation` valida tipos de nó e chamadas de ferramenta (nome e parâmetros reais do Agent).
- **RF-20.4 Rascunho até ativar:** tudo que o Claude salva nasce **inativo**; editar uma ativa a desativa. O MCP só simula; ativar/executar é ação do usuário na interface.
- **RF-20.5 Avisos e temporizadores:** ferramentas do Agent `create_reminder`, `list_reminders`, `cancel_reminder` e `notify` (aviso imediato); lembretes são automações `trigger.once` + `action.notify`.
- **RF-20.6 Concorrência:** salvar com `baseUpdatedAt` desatualizado devolve 409 (outra janela ou o Claude alterou); o editor avisa e oferece recarregar.
- **CA** Um pedido em português ("toda segunda às 9h crie a tarefa Planejar a semana") vira automação desenhada como rascunho; a simulação mostra os dados por nó; depois de ativada, o gatilho dispara. Uma chamada de ferramenta com parâmetro errado é recusada no `save_automation` com a lista de parâmetros válidos.

### 4.21 Chamada de voz (Gemini Live)

Detalhes em [VOICE-CALL.md](VOICE-CALL.md).

- **RF-21.1** Botão de microfone no app abre uma **conversa por voz** em português com o assistente (Gemini Live); o Gemini é usado **só** nessa chamada (`GEMINI_LIVE_API_KEY`, editável em Configurações), o chat continua no provedor configurado.
- **RF-21.2** O assistente **chama as ferramentas do Planner** em linguagem natural (pesquisa e notas, agenda, tarefas, estudos, agendamentos — as do Agent, carregadas a cada chamada). Ferramentas destrutivas (`delete_*`, `clear_*`, `disconnect_*`), `run_claude_code` e `use_skill` ficam de fora.
- **RF-21.3** O cartão da chamada mostra a transcrição do que você e o assistente disseram e as ferramentas usadas; dá para interromper falando por cima, silenciar o microfone e encerrar. Uma chamada por vez, até 14 min.
- **RF-21.4** A chave nunca vai ao navegador; o WebSocket `/live` só aceita loopback, `Host` e `Origin` do dashboard.

### 4.22 Instalar o MCP no Claude Code

- **RF-22.1** `pnpm mcp:install` (`scripts/install-mcp.mjs`) registra o servidor `planner-life` no Claude Code com caminho absoluto (escopo `user`, vale em qualquer pasta), compila o MCP se faltar, é idempotente e confere a conexão. `--check`, `--remove` e `--scope local`. Os instaladores oferecem o passo (`-WithMcp` / `--with-mcp`).

## 5. Regras de negócio críticas (resumo)

1. Entregas e leituras pertencem a **Estudos** (tópico com `dueAt`), nunca a Projetos/Tarefas.
2. Excluir artigo de pesquisa apaga a nota vinculada; excluir linha de pesquisa não apaga artigos.
3. Excluir projeto apaga suas tarefas; excluir mensagem do Inbox é só local.
4. O agente **não executa** Claude Code; ele **propõe**. Só o humano confirma (ou digita no Terminal).
5. Segredos não voltam ao navegador; nenhum caminho de nota sai do vault.
6. Aviso de Google Tasks repete a cada 1 h até a tarefa sair da lista; aviso de evento e resumo são únicos.
7. Cada mutação relevante grava um evento (`events`) **e** publica no barramento (→ P2P).

## 6. Requisitos não funcionais

| Tema                    | Requisito                                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Privacidade             | Dados em disco local (`data/planner.db`, vault). Só saem da máquina: prompts para o provider de IA escolhido, chamadas ao Google e mensagens PLP na rede local. |
| Portabilidade           | Node.js ≥ 22.5 (`node:sqlite`). O nó P2P roda em Raspberry Pi 3 (1 GB); no Pi, use voz Piper "low".                                                             |
| Disponibilidade parcial | Core sem P2P, agente sem Google, dashboard sem voz: cada peça degrada sem derrubar as outras.                                                                   |
| Substituibilidade       | `core`, `agent` e `p2p-node` só se falam por HTTP/eventos. Trocar o LLM ou o transporte não toca o Core.                                                        |
| Desempenho              | Dashboard busca tudo em paralelo (`Promise.all`, `no-store`). Notificações por polling de 30 s.                                                                 |
| Manutenção              | Migrações SQLite idempotentes via `PRAGMA table_info` (§ [DATA-MODEL.md](DATA-MODEL.md)).                                                                       |
| Portas                  | Faixa 4000+ (incomuns): 4000 core, 4100 agent, 4200 voice, 4300 web, 4400/4401 P2P.                                                                             |

## 7. Segurança

Modelo pensado para **uso pessoal em máquina confiável**. O que existe:

- `.env` e `data/` fora do git; segredos mascarados na API de configurações; lista fechada de chaves editáveis.
- Vault com bloqueio de _path traversal_.
- Claude Code **sem shell** e com confirmação humana para pedidos vindos da IA.
- Ponte P2P HTTP escuta só em `127.0.0.1`.
- Serviço de terminal: só `127.0.0.1`, `Origin`/`Host` verificados (inclusive no WebSocket), perfis por lista fixa e ambiente sem as chaves do `.env` (RF-11.4 a 11.11).
- Tokens OAuth do Google ficam no SQLite local (`integration_tokens`) e são renovados por `refresh_token`.

O que **não** existe (riscos assumidos — ver §8): autenticação nas APIs, restrição
de CORS, TLS, criptografia em repouso.

## 8. Limitações conhecidas

| #   | Limitação                                                                                                                                                                                                                                                                                                                                     | Impacto                                                                                                                                        | Mitigação atual                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| L1  | **Nenhuma API tem autenticação, CORS é aberto e os serviços escutam em todas as interfaces** (`app.listen(port)` sem host).                                                                                                                                                                                                                   | Qualquer máquina da mesma rede alcança Core (dados) e Agent — inclusive `POST /claude-code/run`, que executa o Claude Code.                    | Usar apenas em rede confiável / firewall bloqueando 4000–4401. Recomendado: escutar em `127.0.0.1` e exigir um token. |
| L2  | Estado do Agent em memória: histórico do chat, pedidos do Claude Code, fila de notificações (máx. 50) e controle de repetição dos avisos.                                                                                                                                                                                                     | Reiniciar o Agent apaga tudo; após reiniciar, avisos de evento/tarefa podem repetir uma vez.                                                   | —                                                                                                                     |
| L3  | **Conversa única e compartilhada**: um histórico global por provider, sem truncamento e sem isolamento entre chamadas concorrentes (chat, resumo da manhã, comando rápido).                                                                                                                                                                   | Contexto cresce sem limite; o resumo da manhã entra no mesmo histórico.                                                                        | Reiniciar o Agent. Anthropic limita a resposta a 1024 tokens.                                                         |
| L4  | Datas de "hoje" nas rotinas usam UTC (`toISOString`) enquanto a hora do resumo usa o fuso local.                                                                                                                                                                                                                                              | Perto da meia-noite local (UTC-3, após 21h) uma tarefa que vence "hoje" pode ser tratada como atrasada e o resumo pode disparar em outro dia.  | —                                                                                                                     |
| L5  | Notificações têm consumidor efetivo único: o desktop dá `ack` logo após mostrar; o toast do navegador só dá `ack` ao dispensar.                                                                                                                                                                                                               | Com desktop e navegador abertos, quem consultar primeiro "leva" o aviso.                                                                       | Usar um só canal por vez.                                                                                             |
| L6  | O rótulo "aplica na hora, sem restart" da seção **Notas** em Configurações está incorreto: o `VaultService` lê `OBSIDIAN_VAULT_PATH` só ao iniciar o Core.                                                                                                                                                                                    | Trocar a pasta do vault só vale após reiniciar o Core.                                                                                         | Reiniciar o Core.                                                                                                     |
| L7  | Eventos PLP recebidos de outros nós não são gravados no Core.                                                                                                                                                                                                                                                                                 | A "rede" é só de publicação hoje.                                                                                                              | Roadmap.                                                                                                              |
| L8  | Reiniciar por edição de arquivo (`ts-node-dev --respawn`) pode falhar com `EADDRINUSE` no Windows e o processo antigo continuar servindo código velho.                                                                                                                                                                                        | Alteração parece "não pegar".                                                                                                                  | Encerrar todos os `node.exe` do projeto e subir limpo (ver [DEVELOPMENT.md](DEVELOPMENT.md)).                         |
| L9  | **Terminal embutido:** as sessões PTY ficam em memória no serviço `terminal` (reiniciá-lo encerra todas); o layout da aba **Terminal (prompt)** fica só no `localStorage` do navegador (o dos workspaces fica no Core); sem conexão entre terminais; o histórico reexibido é limitado a 256 KB e pode aparecer cortado em apps de tela cheia. | Perde-se o estado ao reiniciar o serviço (o item do workspace reabre uma sessão nova); trocar de navegador mostra a aba Terminal sem o layout. | Usar `Organizar` para reposicionar.                                                                                   |
| L10 | **Aprovação de blocos é proteção de interface**, não controle de acesso: a API não tem autenticação e aceita criar bloco já com `approved:true`. Um bloco aprovado também pode navegar o _próprio_ iframe para uma URL com dados que ele pôde ler (o runtime só bloqueia cliques em links).                                                   | Aprovar código malicioso vaza o que ele pode ler.                                                                                              | Revisar o código antes de aprovar; sem rede/cookies/DOM do dashboard.                                                 |
| L11 | **Groq free tier** recusa requisições acima de ~8 000 tokens; as 72 ferramentas já ocupam ~6 mil. Turnos longos (ex.: criar bloco grande pelo chat) podem dar 413.                                                                                                                                                                            | Erro 500 no chat.                                                                                                                              | O histórico é cortado (`GROQ_MAX_REQUEST_CHARS`), a skill é enxuta; para sistemas grandes use o Claude Code via MCP.  |
| L12 | No painel cada item tem geometrias `grid` e `canvas` **independentes**; mudar de modo remonta os iframes (os blocos rodam de novo).                                                                                                                                                                                                           | Layouts diferentes por modo; recarga visível.                                                                                                  | —                                                                                                                     |
| L13 | Coleções ficam em `records.data` (JSON): consulta filtra em memória (limite 10 000/coleção), sem índices por campo nem relações entre coleções.                                                                                                                                                                                               | Desempenho para bases grandes.                                                                                                                 | Suficiente para uso pessoal.                                                                                          |
| L14 | **Workspace em duas janelas** (ex.: app desktop + navegador): sem sincronização ao vivo. Uma janela com layout antigo, ao gravar, recebe 409 e para de gravar até recarregar; clientes que gravam pela API sem `baseUpdatedAt` sobrescrevem sem checagem.                                                                                     | Mudanças da janela desatualizada não são salvas; aviso no canvas.                                                                              | Recarregar a janela.                                                                                                  |
| L15 | O item de terminal do workspace guarda só o id da sessão: se o serviço `terminal` reiniciar, a sessão some e o item mostra "Sessão encerrada" com o botão **Reabrir**. Blocos dentro do canvas rodam de novo ao mudar de tema.                                                                                                                | Perde-se o histórico do terminal; recarga visível dos blocos.                                                                                  | Reabrir o terminal pelo item.                                                                                         |
| L16 | **Automações:** um grafo ativo executa ferramentas do Agent sem você olhar; a barreira é o rascunho + sua revisão (o MCP só simula). Sem o Core no ar nenhuma automação dispara; execuções perdidas com o Core desligado não são recuperadas.                                                                                                 | Uma automação aprovada com ferramenta errada age no seu PC.                                                                                    | Revisar antes de ativar; simular (dry).                                                                               |
| L17 | **Chamada de voz:** exige internet e chave do Gemini, dura até 15 min (sem retomar contexto), microfone aberto o tempo todo e sem identificação de quem fala; o áudio passa pelo Google.                                                                                                                                                      | Ruído/terceiros podem acionar ferramentas permitidas (não as destrutivas).                                                                     | Silenciar; fones; `LIVE_ALLOW_DESTRUCTIVE` só se quiser.                                                              |

## 9. Roadmap

1. Autenticação por token + bind em `127.0.0.1` por padrão (fecha L1).
2. Persistir eventos PLP recebidos no Core (`onPlpEvent` → banco) e resolução de conflitos.
3. Persistir histórico de chat e fila de notificações; sessões de conversa separadas.
4. Fuso horário explícito nas rotinas (fecha L4).
5. Testar o nó P2P em Raspberry Pi 3 real.
6. Agentes especializados (Research, Study, Coding, CRM, Planning) e mais Skills.
7. Instalador desktop (`electron-builder` + Next standalone + build dos serviços).
8. Integração com GitHub; PLP versionado com assinatura por nó.
9. Migrar as abas nativas (Tarefas, Estudos, CRM…) para blocos editáveis; ligar terminais entre si e notas do vault/navegador/desenho como itens do canvas; ferramentas MCP para o Claude montar workspaces; relações entre coleções; painel de dados (visualização/edição de coleções sem bloco); exportar/importar blocos e painéis (compartilhar); auto-evolução guiada (worktree + typecheck + revisão) como fluxo do produto.
10. Canvas de terminais (paridade maior com o Maestri): **conectar terminais** para agentes se falarem, **notas markdown do vault no canvas**, zoom, workspaces nomeados e layout salvo no Core (hoje só no navegador).
