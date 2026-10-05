# Documentação do Planner Life

Planner Life é um sistema operacional pessoal de IA: um núcleo local que
guarda seus dados (tarefas, projetos, estudos, pesquisa, CRM, hábitos,
notas), um agente conversacional que opera esses dados por ferramentas, um
dashboard web/desktop e uma rede P2P opcional entre dispositivos.

> A IA não é dona dos dados. O Planner Life é o sistema que possui o
> contexto. Os agentes (Groq, Gemini, Claude, Claude Code) são componentes
> substituíveis.

## Índice

| Documento | Para quê |
| --- | --- |
| [SPEC.md](SPEC.md) | Especificação do produto: visão, requisitos funcionais e não funcionais, regras de negócio, limitações e roadmap |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Componentes, processos e portas, fluxos de dados, decisões de arquitetura e modelo de segurança |
| [API.md](API.md) | Referência dos endpoints HTTP de cada serviço (Core, Agent, Voice, ponte P2P) |
| [DATA-MODEL.md](DATA-MODEL.md) | Tabelas SQLite, tipos compartilhados, eventos PLP e regras de cascata |
| [AGENT.md](AGENT.md) | Personal Agent: providers, catálogo de ferramentas, Skills, MCP, Claude Code, rotinas proativas |
| [CONFIGURATION.md](CONFIGURATION.md) | Variáveis de ambiente, aba Configurações e o que exige reinício |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Como rodar, estrutura do monorepo, convenções, como estender e armadilhas conhecidas |

## Visão em uma página

```
                        ┌──────────────────────────────┐
   Navegador / Electron │  apps/web  (Next.js, :4300)   │
                        └───────┬───────────┬──────────┘
                                │           │
                   dados (REST) │           │ chat, notificações,
                                ▼           ▼ Claude Code
                     ┌────────────────┐  ┌──────────────────┐   ┌────────────┐
                     │ core  (:4000)  │◄─┤ agent  (:4100)   │   │ voice(:4200)│
                     │ NestJS+SQLite  │  │ LLM + ferramentas│   │ Piper (TTS)│
                     └───┬─────┬──────┘  └──┬─────────┬─────┘   └────────────┘
                         │     │            │         │
                Google   │     │ vault      │ MCP     │ claude -p
             (Gmail/Cal/ │     ▼ (.md)      ▼         ▼
                Tasks)   │  Obsidian     servidores   Claude Code
                         ▼               externos     (terminal do PC)
                   ┌────────────┐
                   │ p2p-node   │◄── libp2p / gossipsub ──► outros dispositivos
                   │ (:4400/01) │
                   └────────────┘
```

## Convenções desta documentação

- Português do Brasil. Nomes de código, rotas e variáveis ficam como no repositório.
- Datas em ISO 8601. `dueAt`/`examDate` aceitam data (`2026-09-20`) ou data-hora.
- Caminhos são relativos à raiz do repositório, salvo indicação contrária.
- Onde o comportamento real difere do que seria intuitivo, isso aparece como
  **Limitação** (ver também a seção 8 de [SPEC.md](SPEC.md)).
