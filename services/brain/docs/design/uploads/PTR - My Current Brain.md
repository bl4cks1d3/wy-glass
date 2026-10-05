# 🧠 My Current Brain

## PTR — Plano Técnico de Requisitos

**Versão:** 0.1  
**Status:** Inicial  
**Produto:** My Current Brain  
**Tipo:** Plataforma de Inteligência Técnica Pessoal

---

# 1. Objetivo do PTR

Este documento define os requisitos técnicos e funcionais necessários para transformar o conceito do **My Current Brain** em um sistema implementável.

O PTR estabelece:

- requisitos funcionais;
- requisitos não funcionais;
- módulos;
- fluxos;
- regras de negócio;
- APIs;
- modelo de dados;
- integrações;
- arquitetura;
- prioridades;
- critérios de aceitação;
- roadmap técnico.

---

# 2. Escopo do MVP

O primeiro MVP deverá permitir que o usuário:

1. crie seu perfil técnico;
2. informe interesses e objetivos;
3. cadastre tecnologias que conhece;
4. acompanhe fontes tecnológicas;
5. receba conteúdos coletados automaticamente;
6. tenha conteúdos classificados por IA;
7. receba recomendações personalizadas;
8. veja por que determinado conteúdo é relevante;
9. organize conteúdos em estudar, salvar ou ignorar;
10. receba um Daily Brief;
11. registre conhecimentos;
12. acompanhe estudos;
13. transforme conteúdos em projetos;
14. acompanhe sua evolução.

---

# 3. Arquitetura de Alto Nível

```text
                    ┌──────────────────┐
                    │     FRONTEND     │
                    │ Next.js / React  │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │    API GATEWAY   │
                    └────────┬─────────┘
                             │
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
   User Service       Knowledge Service   Content Service
          │                  │                  │
          └──────────────────┼──────────────────┘
                             ▼
                    ┌──────────────────┐
                    │  AI ORCHESTRATOR │
                    └────────┬─────────┘
                             │
             ┌───────────────┼───────────────┐
             ▼               ▼               ▼
        Classifier       Researcher      Recommender
             │               │               │
             └───────────────┼───────────────┘
                             ▼
                    ┌──────────────────┐
                    │    PostgreSQL    │
                    │    + pgvector    │
                    └──────────────────┘

External Sources
       │
       ├── RSS
       ├── GitHub
       ├── Hacker News
       ├── Blogs
       └── APIs
```

---

# 4. Stack Tecnológica

## 4.1 Frontend

Obrigatório:

- Next.js;
- React;
- TypeScript;
- Tailwind CSS.

Responsabilidades:

- interface;
- dashboard;
- navegação;
- visualização de conhecimento;
- projetos;
- estudos;
- notificações.

---

# 4.2 Backend

Recomendação inicial:

- Python;
- FastAPI;
- Pydantic;
- SQLAlchemy.

Motivo:

O sistema terá forte dependência de:

- IA;
- processamento de texto;
- embeddings;
- RAG;
- crawlers;
- pipelines;
- processamento assíncrono.

Python simplifica esse ecossistema.

---

# 4.3 Banco

PostgreSQL.

Extensão:

```text
pgvector
```

Responsabilidades:

- dados do usuário;
- conteúdos;
- conhecimentos;
- projetos;
- relações;
- embeddings;
- histórico.

---

# 4.4 Cache / Filas

Inicialmente:

```text
Redis
```

Uso futuro:

- jobs;
- cache;
- rate limiting;
- filas de processamento;
- tarefas agendadas.

---

# 4.5 IA

A arquitetura deverá ser independente de fornecedor.

Interface:

```text
LLMProvider
EmbeddingProvider
```

Implementações possíveis:

```text
OpenAI
Anthropic
Google
Ollama
Local Models
```

O sistema não deverá possuir lógica de negócio diretamente acoplada a um único provedor.

---

# 5. Módulos

O sistema será dividido inicialmente em:

```text
01. Authentication
02. User Profile
03. Knowledge
04. Content
05. Sources
06. AI
07. Recommendation
08. Learning
09. Projects
10. Build Watch
11. Daily Brief
12. Notifications
13. Search
14. Analytics
15. Administration
```

---

# 6. Requisitos Funcionais

## RF-001 — Cadastro

O sistema deverá permitir criar uma conta.

Dados mínimos:

```text
nome
email
senha
```

Critério de aceitação:

> Usuário consegue criar uma conta e acessar sua área autenticada.

---

# 7. RF-002 — Perfil Técnico

O usuário deverá informar:

- profissão;
- nível;
- objetivos;
- tecnologias;
- interesses;
- áreas desejadas.

Exemplo:

```text
Objetivo:
Backend + IA

Tecnologias:
Python
TypeScript
Node.js
PostgreSQL

Interesses:
Agents
RAG
Open Source
DevOps
```

---

# 8. RF-003 — Objetivos

O usuário poderá criar objetivos.

Exemplo:

```text
Objetivo:
Tornar-se desenvolvedor especializado em IA.

Prazo:
12 meses
```

Um objetivo poderá estar relacionado a:

- conhecimentos;
- tecnologias;
- projetos;
- learning paths.

---

# 9. RF-004 — Tecnologias

O sistema deverá manter um catálogo de tecnologias.

Exemplos:

```text
Python
JavaScript
TypeScript
Rust
Go
Node.js
React
Next.js
PostgreSQL
Docker
Kubernetes
```

Cada tecnologia poderá possuir:

```text
nome
categoria
descrição
site oficial
github
documentação
tags
```

---

# 10. RF-005 — Fontes

O usuário deverá poder selecionar fontes.

Exemplo:

```text
GitHub
Hacker News
RSS
Blogs
```

Configurações:

```text
fonte
frequência
categorias
ativada/desativada
```

---

# 11. RF-006 — Coleta

O sistema deverá coletar conteúdos automaticamente.

Pipeline:

```text
Scheduler
   ↓
Source Connector
   ↓
Fetcher
   ↓
Parser
   ↓
Normalizer
   ↓
Database
```

---

# 12. RF-007 — Deduplicação

O sistema deverá detectar conteúdos potencialmente duplicados.

Exemplo:

```text
Article A
Article B
Reddit Post
GitHub Release
```

podem representar o mesmo acontecimento.

O sistema deverá agrupar conteúdos relacionados.

---

# 13. RF-008 — Classificação

Cada conteúdo deverá ser classificado.

Categorias:

```text
NEWS
RELEASE
TOOL
FRAMEWORK
LIBRARY
RESEARCH
TUTORIAL
PROJECT
SECURITY
ARCHITECTURE
AI
DEVOPS
DATABASE
CAREER
```

---

# 14. RF-009 — Extração de entidades

A IA deverá identificar:

- tecnologias;
- linguagens;
- frameworks;
- empresas;
- projetos;
- pessoas;
- conceitos;
- assuntos.

Exemplo:

```text
Conteúdo:

"Open source agent framework built with Python..."

Entidades:

Python
Agent
Open Source
Framework
```

---

# 15. RF-010 — Resumo

Todo conteúdo relevante deverá possuir um resumo.

O resumo deverá ser:

- curto;
- factual;
- contextual;
- baseado na fonte original.

---

# 16. RF-011 — Why This Matters

O sistema deverá explicar a relevância do conteúdo para o usuário.

Exemplo:

```text
Você está estudando AI Agents.

Este conteúdo apresenta uma arquitetura
relacionada ao seu projeto atual.

Relevância:
Alta
```

---

# 17. RF-012 — Recomendação

O sistema deverá recomendar conteúdos.

Entrada:

```text
Perfil
+
Objetivos
+
Conhecimento
+
Projetos
+
Histórico
+
Conteúdo
```

Saída:

```text
Recomendação
```

---

# 18. RF-013 — Feed

O feed deverá possuir filtros:

```text
Todos
Now
Learn
Build
Frontier
Salvos
```

Filtros adicionais:

```text
AI
Backend
Frontend
DevOps
Database
Security
Architecture
```

---

# 19. RF-014 — Salvar conteúdo

Usuário poderá salvar conteúdos.

Estados:

```text
UNREAD
READ
SAVED
LEARNING
COMPLETED
IGNORED
```

---

# 20. RF-015 — Knowledge

O usuário poderá registrar conhecimentos.

Exemplo:

```text
Event Loop

Status:
Learning

Confidence:
Medium
```

---

# 21. RF-016 — Knowledge Evidence

O sistema deverá registrar evidências.

Exemplos:

```text
✓ estudou artigo
✓ respondeu exercício
✓ implementou projeto
✓ concluiu tutorial
✓ utilizou tecnologia
```

Essas evidências poderão aumentar a confiança do conhecimento.

---

# 22. RF-017 — Knowledge Gap

O sistema deverá identificar lacunas.

Exemplo:

```text
Objetivo:
AI Agents

Conhecimentos existentes:

✓ Python
✓ APIs
✓ LLM

Lacunas:

○ Tool Calling
○ Memory
○ Evaluation
○ Agent Architecture
```

---

# 23. RF-018 — Learning Path

O sistema deverá criar trilhas.

Exemplo:

```text
AI Agents

01. LLM Fundamentals
02. Prompting
03. Tool Calling
04. Memory
05. RAG
06. Agent Architecture
07. Evaluation
08. Observability
```

Cada etapa deverá possuir:

- objetivo;
- pré-requisitos;
- conteúdos;
- exercícios;
- projeto.

---

# 24. RF-019 — Build

O sistema deverá transformar conhecimento em projeto.

Exemplo:

```text
Conhecimento:
RAG

Projeto:
Chatbot de PDFs
```

---

# 25. RF-020 — Project Generator

A IA poderá gerar:

```text
Nome
Descrição
Objetivo
Tecnologias
Pré-requisitos
Arquitetura
Tasks
Critérios de conclusão
```

---

# 26. RF-021 — Project Tracking

Cada projeto deverá possuir:

```text
IDEA
PLANNED
BUILDING
PAUSED
COMPLETED
ARCHIVED
```

Tasks:

```text
TODO
IN_PROGRESS
DONE
```

---

# 27. RF-022 — Build Watch

O sistema deverá permitir acompanhar projetos externos.

Cada projeto:

```text
nome
autor
URL
GitHub
tecnologias
descrição
última atualização
```

---

# 28. RF-023 — Daily Brief

O sistema deverá gerar um resumo diário.

Estrutura:

```text
🔥 Important
📚 Learn
🔨 Build
👀 Build Watch
🔭 Frontier
```

---

# 29. RF-024 — Weekly Brief

Resumo semanal contendo:

- principais acontecimentos;
- conhecimentos estudados;
- projetos;
- tecnologias descobertas;
- lacunas identificadas;
- recomendações.

---

# 30. RF-025 — Notificações

Tipos:

```text
CONTENT_RELEVANT
RELEASE
LEARNING
PROJECT
DAILY_BRIEF
WEEKLY_BRIEF
```

---

# 31. RF-026 — Busca

A busca deverá permitir:

```text
keyword search
semantic search
technology search
knowledge search
project search
```

Exemplo:

> "Como funcionam agentes locais?"

O sistema poderá buscar por significado e não somente por palavras.

---

# 32. RF-027 — Chat com Knowledge Base

O usuário poderá conversar com seu próprio conhecimento.

Exemplo:

> "Quais assuntos de RAG eu já estudei?"

ou:

> "O que falta aprender para terminar meu projeto?"

---

# 33. RF-028 — RAG

O sistema deverá possuir uma camada RAG.

```text
Query
 ↓
Embedding
 ↓
Vector Search
 ↓
Knowledge
 ↓
Context
 ↓
LLM
 ↓
Answer
```

---

# 34. RF-029 — Citações

Respostas baseadas em conteúdos externos deverão apontar para a fonte.

Exemplo:

```text
Resposta...

Fonte:
GitHub
Documentation
Article
```

---

# 35. RF-030 — Feedback

O usuário poderá informar:

```text
👍 Interessante
👎 Não relevante
🔥 Muito relevante
⏳ Depois
```

Esses sinais serão utilizados para melhorar recomendações futuras.

---

# 36. Requisitos Não Funcionais

## RNF-001 — Performance

Dashboard deverá carregar em aproximadamente:

```text
< 2 segundos
```

em condições normais.

---

## RNF-002 — Escalabilidade

A arquitetura deverá permitir separar:

```text
API
Workers
AI Processing
Database
```

conforme o sistema crescer.

---

## RNF-003 — Observabilidade

Registrar:

- erros;
- jobs;
- latência;
- chamadas de IA;
- falhas de integração;
- consumo.

---

# 37. RNF-004 — Segurança

Obrigatório:

- HTTPS;
- hashing de senha;
- autenticação;
- autorização;
- proteção de endpoints;
- validação de entrada;
- rate limiting.

---

# 38. RNF-005 — Privacidade

O usuário deverá poder:

- visualizar seus dados;
- exportar seus dados;
- excluir seus dados;
- desativar integrações.

---

# 39. RNF-006 — Resiliência

Falhas de fontes externas não deverão derrubar o sistema.

Exemplo:

```text
GitHub API
     ↓
   ERROR
     ↓
Retry
     ↓
Backoff
     ↓
Log
```

O restante do sistema continua funcionando.

---

# 40. RNF-007 — Idempotência

Jobs de coleta deverão ser idempotentes.

Executar:

```text
collect()
collect()
collect()
```

não deverá criar três conteúdos duplicados.

---

# 41. RNF-008 — Provider Agnostic AI

O código deverá evitar:

```python
openai.chat(...)
```

espalhado pelo projeto.

Preferir:

```python
llm.generate(...)
```

com adapters.

---

# 42. API

## Authentication

```text
POST /auth/register
POST /auth/login
POST /auth/refresh
POST /auth/logout
```

---

## User

```text
GET /me
PATCH /me
```

---

## Profile

```text
GET /profile
PATCH /profile
```

---

## Interests

```text
GET /interests
POST /interests
DELETE /interests/{id}
```

---

## Technologies

```text
GET /technologies
GET /technologies/{id}
```

---

## Sources

```text
GET /sources
POST /sources
PATCH /sources/{id}
DELETE /sources/{id}
```

---

## Content

```text
GET /content
GET /content/{id}
POST /content/{id}/save
POST /content/{id}/feedback
```

---

## Knowledge

```text
GET /knowledge
POST /knowledge
GET /knowledge/{id}
PATCH /knowledge/{id}
```

---

## Learning

```text
GET /learning-paths
POST /learning-paths
GET /learning-paths/{id}
POST /learning-paths/{id}/progress
```

---

## Projects

```text
GET /projects
POST /projects
GET /projects/{id}
PATCH /projects/{id}
POST /projects/{id}/tasks
PATCH /projects/{id}/tasks/{task_id}
```

---

## Brief

```text
GET /brief/daily
GET /brief/weekly
```

---

## Search

```text
GET /search?q=
```

---

# 43. Banco de Dados

Tabelas principais:

```text
users
profiles
goals
interests
technologies

sources
source_configs

contents
content_topics
content_entities
content_relations

knowledge
knowledge_evidence
knowledge_relations

learning_paths
learning_modules
learning_progress

projects
project_tasks
project_technologies

recommendations
feedback
notifications

daily_briefs
weekly_briefs

embeddings
jobs
job_runs
```

---

# 44. Pipeline de Jobs

O sistema deverá possuir tarefas assíncronas.

```text
Scheduler
    ↓
Collect
    ↓
Normalize
    ↓
Deduplicate
    ↓
Classify
    ↓
Embed
    ↓
Analyze
    ↓
Personalize
    ↓
Recommend
    ↓
Digest
```

---

# 45. Frequência Inicial

### Coleta

A cada:

```text
15–60 minutos
```

dependendo da fonte.

### Classificação

Após ingestão.

### Daily Brief

Uma vez por dia.

### Weekly Brief

Uma vez por semana.

---

# 46. Sistema de Prioridade

Cada conteúdo deverá possuir uma prioridade interna:

```text
P0 — crítico
P1 — alto
P2 — médio
P3 — baixo
P4 — ignorar
```

O usuário não precisa necessariamente visualizar esses códigos.

---

# 47. Rate Limiting

Cada integração externa deverá possuir limites próprios.

Exemplo:

```text
Source
 ↓
RateLimiter
 ↓
Request
```

Evitar bloqueio de APIs externas.

---

# 48. Cache

Deverão ser utilizados caches para:

- conteúdos;
- respostas repetidas;
- embeddings;
- metadados;
- recomendações;
- Daily Brief.

---

# 49. Sistema de Eventos

O backend deverá ser orientado a eventos quando fizer sentido.

Exemplo:

```text
ContentCreated
       ↓
ContentClassified
       ↓
ContentEmbedded
       ↓
ContentAnalyzed
       ↓
RecommendationGenerated
```

---

# 50. Estrutura de Projeto

Sugestão:

```text
my-current-brain/
│
├── frontend/
│   ├── app/
│   ├── components/
│   ├── lib/
│   └── services/
│
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── core/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   ├── repositories/
│   │   ├── workers/
│   │   ├── ai/
│   │   └── integrations/
│   │
│   ├── migrations/
│   └── tests/
│
├── infrastructure/
│   ├── docker/
│   └── deployment/
│
├── docs/
│   ├── PTD.md
│   ├── PTR.md
│   └── architecture/
│
└── README.md
```

---

# 51. Camada AI

Estrutura:

```text
backend/app/ai/

├── providers/
│   ├── base.py
│   ├── openai.py
│   ├── anthropic.py
│   └── ollama.py
│
├── agents/
│   ├── researcher.py
│   ├── classifier.py
│   ├── recommender.py
│   ├── learning.py
│   └── project.py
│
├── embeddings/
│
├── prompts/
│
└── orchestrator.py
```

---

# 52. Agente Researcher

Entrada:

```text
topic
user_context
time_range
```

Processamento:

```text
Search
 ↓
Collect
 ↓
Filter
 ↓
Verify
 ↓
Summarize
 ↓
Relate
```

Saída:

```json
{
  "topic": "AI Agents",
  "items": [],
  "summary": "...",
  "relevance": "high"
}
```

---

# 53. Agente Classifier

Responsável por:

- categoria;
- tópicos;
- entidades;
- relevância inicial.

---

# 54. Agente Recommender

Entrada:

```text
user_profile
knowledge
projects
content
history
```

Saída:

```text
recommended_content
recommended_learning
recommended_project
```

---

# 55. Agente Learning

Responsável por:

- learning paths;
- explicações;
- exercícios;
- revisões;
- identificação de lacunas.

---

# 56. Agente Project

Responsável por:

- gerar projetos;
- decompor projetos;
- criar tarefas;
- relacionar conhecimento;
- acompanhar progresso.

---

# 57. Critérios de Aceitação do MVP

O MVP será considerado funcional quando:

### Usuário

- [ ] conseguir criar conta;
- [ ] conseguir configurar perfil;
- [ ] conseguir informar interesses;
- [ ] conseguir informar tecnologias.

### Coleta

- [ ] sistema conseguir coletar conteúdos;
- [ ] conteúdos serem armazenados;
- [ ] duplicações serem tratadas.

### IA

- [ ] conteúdos classificados;
- [ ] resumos gerados;
- [ ] relevância calculada;
- [ ] contexto pessoal gerado.

### Dashboard

- [ ] NOW funcionando;
- [ ] LEARN funcionando;
- [ ] BUILD funcionando;
- [ ] FRONTIER funcionando.

### Learning

- [ ] usuário conseguir salvar conhecimento;
- [ ] usuário conseguir acompanhar estudo.

### Brief

- [ ] Daily Brief gerado automaticamente.

---

# 58. Fases de Desenvolvimento

## Fase 01 — Foundation

```text
Authentication
Database
API
Frontend
User Profile
```

---

## Fase 02 — Information Engine

```text
RSS
GitHub
Hacker News

Ingestion
Normalization
Deduplication
Classification
```

---

## Fase 03 — AI Engine

```text
Summarization
Entity Extraction
Relevance
Why This Matters
Embeddings
```

---

## Fase 04 — Knowledge

```text
Knowledge
Evidence
Knowledge Graph
Knowledge Gap
Search
RAG
```

---

## Fase 05 — Learning

```text
Learning Paths
Study
Exercises
Progress
```

---

## Fase 06 — Build

```text
Project Generator
Projects
Tasks
Build Watch
```

---

## Fase 07 — Intelligence

```text
Daily Brief
Weekly Brief
Personalized Recommendations
Agents
```

---

# 59. Definition of Done

Uma funcionalidade só será considerada concluída quando possuir:

```text
✓ Código
✓ Testes
✓ API documentada
✓ Validação
✓ Tratamento de erros
✓ Logs
✓ Persistência
✓ UI
✓ Loading State
✓ Empty State
✓ Error State
✓ Documentação
```

---

# 60. Princípio Arquitetural

O projeto deverá ser construído de forma incremental.

Evitar inicialmente:

- microserviços desnecessários;
- infraestrutura excessivamente complexa;
- múltiplos bancos;
- múltiplos agentes independentes;
- Kubernetes;
- pipelines complexos.

Começar como:

```text
Monolith Modular
+
Workers
+
PostgreSQL
+
Redis
```

e evoluir conforme houver necessidade real.

---

# 61. Arquitetura Evolutiva

### Inicial

```text
Next.js
   │
FastAPI
   │
PostgreSQL
   │
Redis
```

### Crescimento

```text
Next.js
   │
API
   │
 ┌─┴───────────────┐
 │                 │
API             Workers
 │                 │
 └───────┬─────────┘
         │
    PostgreSQL
```

### Escala

Somente quando necessário:

```text
API
├── Content Service
├── Knowledge Service
├── AI Service
├── Recommendation Service
└── Project Service
```

---

# 62. Segurança da IA

A IA não deverá possuir acesso irrestrito ao sistema.

Cada agente deverá possuir permissões.

Exemplo:

```text
Research Agent
    ↓
READ sources
WRITE research

Project Agent
    ↓
READ knowledge
WRITE projects
```

Evitar agentes com:

```text
FULL DATABASE ACCESS
```

---

# 63. Observabilidade da IA

Registrar:

```text
model
provider
tokens
latency
cost
prompt_version
response_status
```

Isso permitirá acompanhar custo e qualidade.

---

# 64. Versionamento de Prompts

Prompts deverão ser versionados.

Exemplo:

```text
researcher_v1
researcher_v2
classifier_v1
recommender_v1
```

Nunca deixar prompts críticos espalhados pelo código.

---

# 65. Avaliação da IA

O sistema deverá possuir avaliações automáticas e manuais.

Exemplos:

```text
Summary Quality
Classification Accuracy
Recommendation Relevance
Citation Accuracy
Hallucination Rate
```

O feedback do usuário será importante para melhorar os modelos.

---

# 66. Princípio de Fontes

Informações externas deverão manter:

```text
source_url
source_name
published_at
retrieved_at
```

O sistema deverá diferenciar:

```text
FATO DA FONTE
        ↓
INTERPRETAÇÃO DA IA
        ↓
RECOMENDAÇÃO
```

Essas três camadas não devem ser misturadas.

---

# 67. Roadmap

```text
                    MY CURRENT BRAIN

                         V0.1
                          │
                   Information Feed
                          │
                          ↓
                         V0.2
                          │
                   AI Personalization
                          │
                          ↓
                         V0.3
                          │
                    Knowledge Graph
                          │
                          ↓
                         V0.4
                          │
                    Learning Engine
                          │
                          ↓
                         V0.5
                          │
                     Build Engine
                          │
                          ↓
                         V1.0
                          │
              Personal Technical OS
```

---

# 68. Resultado Esperado

Ao final da primeira versão, o usuário deverá abrir o sistema e receber uma resposta clara para cinco perguntas:

```text
┌───────────────────────────────────────┐
│                                       │
│  1. O que aconteceu?                  │
│                                       │
│  2. O que importa para mim?           │
│                                       │
│  3. O que eu deveria aprender?        │
│                                       │
│  4. O que eu poderia construir?       │
│                                       │
│  5. O que está surgindo no horizonte? │
│                                       │
└───────────────────────────────────────┘
```

Esse é o comportamento mínimo que define o **My Current Brain**.

---

# 69. Visão Final

O sistema evoluirá de:

```text
Agregador
```

para:

```text
Curador
```

depois:

```text
Assistente de Aprendizagem
```

depois:

```text
Knowledge System
```

e finalmente:

```text
Personal Technical Intelligence
```

A visão final é que o My Current Brain funcione como uma camada inteligente entre o profissional e o ecossistema tecnológico:

```text
              INTERNET
                  │
                  ↓
          ┌───────────────┐
          │ MY CURRENT    │
          │     BRAIN     │
          └───────┬───────┘
                  │
        ┌─────────┼─────────┐
        ↓         ↓         ↓
      NOW       LEARN    FRONTIER
        │         │         │
        └─────────┼─────────┘
                  ↓
                BUILD
                  ↓
               PROJECT
                  ↓
              KNOWLEDGE
                  ↓
              EVOLUTION
```

## Princípio final

> **O My Current Brain não existe para fazer o usuário consumir mais informação. Existe para ajudá-lo a transformar informação em conhecimento, conhecimento em prática e prática em evolução.**
