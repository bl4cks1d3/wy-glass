# My Current Brain

> Stay curious. Stay current. Uma inteligência técnica pessoal: coleta o que acontece no ecossistema, filtra pelo seu contexto e transforma em aprender → construir → evoluir.

Especificações em [docs/](docs/): [PTD](docs/PTD.md), [PTR](docs/PTR.md), [Design Brief](docs/DESIGN-BRIEF.md) e o protótipo do Claude Design em [docs/design/](docs/design/My%20Current%20Brain.dc.html).

## A ideia central: a IA roda na sua assinatura

O app **não chama nenhuma API de LLM**. Ele só faz a parte determinística: coletar fontes, guardar e mostrar. Todo o trabalho de inteligência (triagem, resumo, "por que importa", lacunas, trilhas, projetos e brief) é feito por um **agente do Claude Code**, que usa o app pelo **MCP `current-brain`**. Como é o Claude Code logado na sua conta claude.ai, o consumo sai da sua assinatura Pro/Max, não de créditos de API.

```text
 Fontes (HN, RSS, arXiv, GitHub releases)
        │  ingest_sources (determinístico, idempotente)
        ▼
 ┌──────────────────────┐   MCP stdio    ┌───────────────────────────┐
 │  data/brain.db       │◀──────────────▶│  Claude Code              │
 │  SQLite (node:sqlite)│  22 ferramentas │  agente brain-curator     │
 └──────────┬───────────┘  com escopo     │  (sua assinatura)         │
            │                             └───────────────────────────┘
            ▼
 Next.js (apps/web): Início · Now · Learn · Build · Watch · Frontier · Mapa · Evolução · Brief
```

## Estrutura

| Caminho                           | O quê                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `packages/core`                   | Tipos, schema SQLite, repositório, ingestão (RSS/Atom/HN), seed                                                    |
| `apps/mcp`                        | Servidor MCP `current-brain` (stdio). Só operações com escopo definido (PTR §62)                                   |
| `apps/web`                        | Next.js 16 + React 19 + Tailwind 4, fiel ao protótipo do Claude Design                                             |
| `apps/terminal`                   | Terminal integrado (PTY com o `claude` real, WebSocket só em 127.0.0.1 com token) + coletor contínuo a cada 10 min |
| `.claude/agents/brain-curator.md` | O agente: regras de relevância, tom e as tarefas `daily`, `weekly` e `research`                                    |
| `.claude/commands/`               | `/brain-daily`, `/brain-weekly`, `/brain-research <tema>`                                                          |
| `.mcp.json`                       | Registra o MCP para o Claude Code nesta pasta                                                                      |
| `scripts/run-agent.ps1`           | Execução headless (`claude -p --agent brain-curator`)                                                              |
| `scripts/schedule-agent.ps1`      | Agenda os runs diário e semanal no Agendador de Tarefas do Windows                                                 |

## Funcionalidades

- **Onboarding e perfil:** seleção múltipla em todas as perguntas, catálogo com mais de 300 tecnologias e temas por categoria, e qualquer item fora da lista pode ser digitado e adicionado. Dá para editar depois em **Ajustes → Perfil**, incluindo a prioridade de cada tema.
- **Terminal do Claude integrado:** botão **Claude** no canto (ou `Ctrl+``). É uma sessão real do Claude Code nesta pasta, com o agente e o MCP já disponíveis. A sessão continua quando você troca de página.
- **Metas de aprendizado → plano de estudo:** em **Learn**, descreva a meta com suas palavras. "Planejar agora com o Claude" envia `/brain-plan` ao terminal. O agente monta a trilha e anexa **vídeos do YouTube, tutoriais, cursos, docs, artigos e exercícios** por módulo, e você marca cada um como concluído, o que conta como evidência no mapa.
- **Coleta diária:** o coletor roda a cada 10 min enquanto o app está no ar. Em **Ajustes → Coleta diária** você ativa o run diário do agente no Agendador do Windows (coleta, busca, análise e brief) e o Weekly Brain aos domingos.
- **Mande um link, vira fonte:** em Now, Fontes, Ajustes, na paleta ⌘K (colando a URL) ou com `/brain-link`. Blogs com RSS, canais e playlists do YouTube, repositórios do GitHub e subreddits são detectados sozinhos; sites sem feed são visitados pelo agente todo dia.
- **Busca autônoma:** cada tema de prioridade alta ou média vira uma busca diária no Hacker News e outra no GitHub (repositórios novos), e o agente ainda pesquisa na web por metas, lacunas e temas.
- **Grafos:** em **Conhecimento → Grafo**, conceitos, conteúdos, projetos e metas; em **Fontes**, fontes → temas e áreas → conceitos que alimentam, com o **sinal** de cada fonte (quanto passa da triagem).
- **Pessoas:** siga quem apresenta notícias e quem constrói, com todos os perfis de cada pessoa (YouTube, Instagram, TikTok, X, Threads, LinkedIn, Twitch, Kick, Bluesky, Mastodon, Medium, DEV, Substack, Vimeo, blog). Cada pessoa mostra quando postou pela última vez e quantos posts fez em 7 dias. YouTube, Bluesky, Mastodon, Medium, DEV, Substack e blogs são feeds automáticos. Instagram, TikTok, X e afins não têm feed público: o agente procura os posts no run diário, ou você aponta um **RSSHub próprio** em Ajustes para virarem feed. `/brain-people` pede sugestões de pessoas para seguir.
- **GitHub em alta:** GitHub Trending (diário, semanal e das linguagens da sua stack), repositórios novos que já passaram de 500 estrelas e todo projeto citado nos conteúdos, com **quem postou**. O histórico diário de estrelas mostra o ganho real na semana. Visões: sua stack, postados por quem você segue, tudo. Com `GITHUB_TOKEN` o limite da API sobe de 60 para 5000 requisições por hora.
- **Catch-up (até 2 anos):** para quem sente que está atrasado. Coleta o histórico de 6, 12 ou 24 meses das suas tecnologias (releases major e minor dos repositórios oficiais e as discussões mais votadas do HN) e o agente monta uma linha do tempo com marcos **essenciais**, **importantes** e de contexto. Você marca "já sei", "estudar" ou "pular" e acompanha quão em dia está por tecnologia. Esse histórico não entra no Now diário.

## Começando

Requer Node 22.13+ (usa o `node:sqlite` embutido, sem dependência nativa) e o Claude Code logado com a sua conta.

```bash
npm install
```

```bash
npm run dev
```

Sobe o web (porta 3000) e o terminal/coletor (porta 3031) juntos. Na primeira visita, <http://localhost:3000> abre o onboarding (as cinco perguntas). Depois:

```bash
npm run ingest
```

Coleta as fontes (sem IA). Os itens ficam **pendentes** até o agente analisá-los.

### Rodando o agente

Numa sessão do Claude Code aberta nesta pasta (aprove o MCP `current-brain` na primeira vez):

```text
/brain-daily            ciclo diário completo
/brain-plan <meta>      plano de estudo com vídeos, tutoriais e exercícios
/brain-link <url>       passa a acompanhar um site/canal/repo
/brain-catchup [meses]  recupera o atraso (padrão 24 meses)
/brain-people [tema]    sugere pessoas para seguir
/brain-research <tema>  pesquisa pontual
/brain-weekly           Weekly Brain + recalibração
```

Ou pelo terminal, sem sessão interativa:

```bash
npm run agent:daily
```

O script remove `ANTHROPIC_API_KEY` do processo antes de chamar o `claude`, para garantir que o uso saia da assinatura. Os logs ficam em `logs/`.

Para agendar (todo dia às 07:00 e o semanal aos domingos às 18:00):

```bash
powershell -File scripts/schedule-agent.ps1
```

### Só para ver as telas

```bash
npm run db:seed
```

Popula o banco com o mundo de exemplo do protótipo (itens da fonte "Exemplo (demo)"). Para limpar:

```bash
npm run db:reset
```

Para usar um banco separado de demonstração, defina `MCB_DB_PATH` (a configuração `web-demo` em `.claude/launch.json` já aponta para `data/demo.db`).

## Ferramentas do MCP

| Grupo                  | Ferramentas                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Contexto               | `get_context`, `search`, `get_feedback`                                                                                                      |
| Links e busca autônoma | `add_link`, `sync_topic_sources`, `list_due_pages`, `mark_page_checked`, `add_discovered_content`                                            |
| Metas                  | `list_goals`, `create_goal`, `update_goal`, `add_learning_resources`                                                                         |
| Catch-up               | `backfill_history` (releases, HN, DEV, arXiv, Stack Overflow, GitHub), `add_milestones`, `list_milestones`                                   |
| Pessoas                | `list_creators`, `add_creator`, `suggest_creator`, `list_creator_posts`                                                                      |
| GitHub em alta         | `list_trending_repos`, `annotate_repo`, `track_repos`                                                                                        |
| Fontes                 | `list_sources`, `add_source`, `ingest_sources`                                                                                               |
| Conteúdo               | `list_pending_content`, `get_content`, `list_content`, `save_content_analysis` (lote), `ignore_content`, `mark_duplicate`, `record_feedback` |
| Conhecimento           | `upsert_knowledge` (evidências são sempre acrescentadas, nunca substituídas), `upsert_learning_item`, `upsert_learning_path`                 |
| Build                  | `suggest_project`, `update_project`, `add_build_watch`                                                                                       |
| Brief                  | `publish_brief` (diário ou semanal)                                                                                                          |
| Observabilidade        | `start_run`, `finish_run` (aparecem no header e em Ajustes)                                                                                  |

As três camadas do PTR §66 ficam separadas no modelo: `excerpt` é o **fato da fonte** e o agente nunca o reescreve; `summary` e `whyItMatters` são a **interpretação da IA**; salvos, feedback e estudo formam a **camada do usuário**.

## Próximos passos (roadmap do PTR)

- Busca semântica / RAG sobre o próprio conhecimento (pgvector ou `sqlite-vec`)
- Migrar para Postgres quando houver multiusuário (o repositório já isola o SQL)
- Integração com o Planner Life (PTD §50): o MCP `planner-life` já está disponível na sua máquina
- Fontes: YouTube, Reddit, newsletters (MVP 3)
