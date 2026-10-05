# 🧠 My Current Brain

## Design Brief

**Versão:** 0.1  
**Produto:** My Current Brain  
**Categoria:** Personal Technical Intelligence  
**Plataforma inicial:** Web Desktop + Mobile Responsive  
**Estilo:** Minimalista, técnico, inteligente, editorial e futurista

---

# 1. Conceito Visual

O **My Current Brain** deve parecer uma mistura entre:

- laboratório de pesquisa;
- terminal moderno;
- dashboard de inteligência;
- reader/editorial;
- sistema operacional pessoal;
- mapa de conhecimento.

Não deve parecer:

- portal de notícias;
- rede social;
- feed infinito;
- plataforma de cursos;
- dashboard corporativo tradicional.

A sensação desejada é:

> **“Este sistema entende o que está acontecendo no mundo da tecnologia e sabe o que é relevante para mim.”**

---

# 2. Design Philosophy

## Informação → Contexto → Ação

A interface deve sempre conduzir o usuário por três níveis:

```text
INFORMAÇÃO
    ↓
POR QUE IMPORTA?
    ↓
O QUE FAZER COM ISSO?
```

Exemplo:

```text
Nova tecnologia X
        ↓
Por que isso importa para você?
        ↓
Você está estudando Agents.
        ↓
Quer entender?
        ↓
[ ESTUDAR ] [ EXPERIMENTAR ] [ SALVAR ]
```

---

# 3. Personalidade Visual

Palavras-chave:

```text
Inteligente
Técnico
Calmo
Preciso
Minimalista
Curioso
Experimental
Editorial
Futurista
Humano
```

A interface deve transmitir tecnologia sem cair no visual clichê de:

> “Cyberpunk neon cheio de elementos.”

O futurismo deverá vir principalmente de:

- tipografia;
- espaçamento;
- animações;
- visualização de dados;
- microinterações;
- organização da informação.

---

# 4. Layout Geral

Desktop:

```text
┌───────────────────────────────────────────────────────────┐
│ 🧠 MY CURRENT BRAIN          Search...        ◯ Profile   │
├──────────────┬────────────────────────────────────────────┤
│              │                                            │
│  HOME        │                                            │
│              │             MAIN CONTENT                   │
│  NOW         │                                            │
│  LEARN       │                                            │
│  BUILD       │                                            │
│  FRONTIER    │                                            │
│              │                                            │
│  KNOWLEDGE   │                                            │
│  PROJECTS    │                                            │
│              │                                            │
│  WATCH       │                                            │
│              │                                            │
│  SETTINGS    │                                            │
│              │                                            │
└──────────────┴────────────────────────────────────────────┘
```

---

# 5. Navegação

Sidebar fixa no desktop.

Itens:

```text
🧠 Home

⚡ Now
📚 Learn
🔨 Build
👀 Build Watch
🔭 Frontier

──────────────

🧩 Knowledge
🚀 Projects
🗺 Learning Paths

──────────────

🔎 Explore

──────────────

⚙ Settings
```

No mobile:

```text
┌─────────────────────────────┐
│ 🧠                  ◯       │
├─────────────────────────────┤
│                             │
│       CONTENT               │
│                             │
├─────────────────────────────┤
│ 🏠   ⚡   📚   🔨   🧩      │
└─────────────────────────────┘
```

Bottom navigation para as áreas mais importantes.

---

# 6. Dashboard

O Dashboard é a tela principal.

Objetivo:

> Em menos de 30 segundos o usuário deve entender o que está acontecendo e o que merece sua atenção.

---

# 7. Hero

Topo:

```text
Good morning, Nomade.

Your brain is
up to date.

24 September 2026
```

Abaixo:

```text
12 relevant updates
3 things to learn
1 project to build
```

Visual extremamente limpo.

---

# 8. Daily Pulse

Componente principal:

```text
┌──────────────────────────────────────────────┐
│ TODAY                                        │
│                                              │
│ 12 relevant                                  │
│                                              │
│ ──────────────────────────────────────────── │
│                                              │
│ 03  Important updates                        │
│ 02  Concepts to learn                        │
│ 01  Project                                  │
│ 03  Frontier signals                         │
│                                              │
│              [ Start briefing ]              │
└──────────────────────────────────────────────┘
```

---

# 9. Feed Principal

O feed não deverá usar cards gigantes.

Preferência:

### Editorial List

```text
09:32

NEW TOOL
Open-source agent framework X

A new framework for building local AI agents.

Why it matters
You are currently exploring AI agents.

AI · AGENTS · OPEN SOURCE

[Read] [Save]
────────────────────────────────────
```

Isso permite mostrar muita informação sem poluir a tela.

---

# 10. Hierarquia Visual

Cada conteúdo deverá possuir:

### Nível 1

Título.

### Nível 2

Resumo.

### Nível 3

Contexto pessoal.

### Nível 4

Metadados.

Exemplo:

```text
NEW RELEASE

Ollama X.X

Local inference platform receives...

WHY IT MATTERS

Relevant to your Local AI project.

AI · LOCAL · LLM

8 min
```

---

# 11. Sistema de Tags

Tags pequenas e discretas:

```text
AI
PYTHON
BACKEND
OPEN SOURCE
RESEARCH
RELEASE
```

Não usar grandes badges coloridos.

Preferência:

```text
[AI] [AGENTS] [PYTHON]
```

---

# 12. Cores

A paleta deve ser predominantemente neutra.

### Light

```text
Background
#F7F7F5

Surface
#FFFFFF

Text
#171717

Secondary
#737373

Border
#E5E5E5
```

### Dark

```text
Background
#0D0D0D

Surface
#151515

Text
#F5F5F5

Secondary
#8A8A8A

Border
#292929
```

---

# 13. Cor de Acento

Utilizar apenas uma cor principal de destaque.

Sugestão:

```text
Electric Blue
#4F7CFF
```

Uso:

- links;
- ações principais;
- progresso;
- seleção;
- estados ativos.

Evitar transformar toda a interface em azul.

---

# 14. Semântica de Cores

As cores deverão possuir significado.

```text
Accent
→ interação

Green
→ concluído / sucesso

Amber
→ atenção / pendência

Red
→ erro / crítico

Purple
→ IA / inteligência
```

Usar cores semanticamente e não decorativamente.

---

# 15. Tipografia

Preferência:

### Interface

**Inter**

ou

**Geist**

### Código / dados técnicos

**JetBrains Mono**

Exemplo:

```text
AI Agents
```

versus:

```text
agent.run(tool_call)
```

---

# 16. Títulos

Títulos devem ser grandes, porém não exagerados.

Exemplo:

```text
Your Current Brain
```

Peso:

```text
600–700
```

Subtítulos:

```text
400–500
```

---

# 17. Cards

Cards devem ser utilizados com moderação.

Preferir:

```text
border
+
subtle background
+
spacing
```

Evitar:

```text
shadow
+
gradient
+
rounded corners excessivos
```

O sistema deve parecer uma ferramenta profissional.

---

# 18. Border Radius

Utilizar:

```text
4px
6px
8px
12px
```

Evitar componentes extremamente arredondados.

---

# 19. Dashboard Grid

Desktop:

```text
┌──────────────────────┬─────────────────┐
│                      │                 │
│      DAILY PULSE     │    KNOWLEDGE    │
│                      │                 │
├──────────────────────┼─────────────────┤
│                      │                 │
│       NOW            │     LEARN       │
│                      │                 │
├──────────────────────┴─────────────────┤
│                                        │
│              BUILD                      │
│                                        │
├────────────────────────────────────────┤
│                                        │
│              FRONTIER                   │
│                                        │
└────────────────────────────────────────┘
```

---

# 20. NOW

Página dedicada ao que está acontecendo.

```text
NOW

Today
This week
Releases
Tools
Research
Security
```

Conteúdo organizado por relevância.

---

# 21. LEARN

A página deverá parecer uma biblioteca.

```text
LEARN

Continue learning

┌─────────────────────────────┐
│ Event Loop                  │
│ ███████░░░ 70%              │
│ 15 min remaining             │
└─────────────────────────────┘
```

---

# 22. BUILD

A página mais orientada à ação.

```text
BUILD

Current projects

┌─────────────────────────────┐
│ AI Research Assistant       │
│                             │
│ ██████░░░░ 60%              │
│                             │
│ Next task                   │
│ Implement retrieval         │
│                             │
│ [Continue]                  │
└─────────────────────────────┘
```

---

# 23. BUILD WATCH

Visual semelhante a um feed de desenvolvimento.

```text
BUILD WATCH

● Project updated

Local AI Assistant
by @developer

+ Added memory
+ Added RAG

2 hours ago

[View project]
```

Cada atualização deve parecer um pequeno evento.

---

# 24. FRONTIER

Área visualmente distinta.

Objetivo:

> Mostrar sinais emergentes sem transformar tudo em recomendação.

Categorias:

```text
Emerging
Research
Experimental
Open Source
Early Stage
```

A estética pode ser um pouco mais experimental.

---

# 25. Knowledge Map

Uma das telas mais importantes.

Visualização:

```text
                    AI
                    │
          ┌─────────┼─────────┐
          │         │         │
         LLM       RAG      Agents
          │         │         │
          │      Embeddings  Tools
          │         │         │
          └─────────┼─────────┘
                    │
                 Projects
```

Nós maiores:

> conhecimento consolidado.

Nós menores:

> conhecimentos descobertos.

---

# 26. Knowledge Detail

Exemplo:

```text
┌────────────────────────────────────────┐
│ RAG                                    │
│ Retrieval Augmented Generation         │
│                                        │
│ STATUS                                 │
│ Practicing                             │
│                                        │
│ CONFIDENCE                             │
│ ██████░░░░                             │
│                                        │
│ RELATED                                │
│ Embeddings · Retrieval · LLM           │
│                                        │
│ PROJECTS                               │
│ PDF Research Assistant                 │
│                                        │
│ LEARN                                  │
│ Evaluation                             │
└────────────────────────────────────────┘
```

---

# 27. Página de Conteúdo

Ao clicar em uma notícia:

```text
┌─────────────────────────────────────────────┐
│ AI · OPEN SOURCE                            │
│                                             │
│ New framework for local AI agents            │
│                                             │
│ 8 min read                                  │
│                                             │
│ ─────────────────────────────────────────── │
│                                             │
│ SUMMARY                                     │
│                                             │
│ ...                                         │
│                                             │
│ WHY IT MATTERS TO YOU                       │
│                                             │
│ You are currently exploring...              │
│                                             │
│ WHAT YOU SHOULD KNOW                        │
│                                             │
│ 01 ...                                      │
│ 02 ...                                      │
│ 03 ...                                      │
│                                             │
│ WHAT TO DO NEXT                             │
│                                             │
│ [Study] [Build] [Save]                      │
└─────────────────────────────────────────────┘
```

---

# 28. Ação "Learn"

Botão:

```text
[ Learn this ]
```

Ao clicar:

```text
15 MIN LEARNING SESSION

01 — Concept
02 — Example
03 — Code
04 — Exercise
05 — Check understanding
```

---

# 29. Ação "Build"

```text
BUILD WITH THIS

Project:

Build a local RAG assistant.

Difficulty:
Intermediate

Estimated:
2h 30m

Prerequisites:
✓ Python
✓ APIs
○ Embeddings

[Start project]
```

---

# 30. Search

Busca global.

Atalho:

```text
/
```

ou:

```text
⌘ K
```

Interface:

```text
┌──────────────────────────────────────┐
│ 🔎 Search your brain...              │
├──────────────────────────────────────┤
│                                      │
│ Recent                               │
│                                      │
│ RAG                                  │
│ AI Agents                            │
│ Event Loop                           │
│                                      │
└──────────────────────────────────────┘
```

Resultados misturados:

```text
Knowledge
Content
Projects
Technologies
Learning
```

---

# 31. Command Palette

Atalho:

```text
⌘ K
```

Ações:

```text
Search
Start learning
Create project
Add knowledge
Open daily brief
Open knowledge map
Settings
```

---

# 32. Daily Brief

Interface quase editorial.

```text
MY CURRENT BRAIN

24 SEPTEMBER 2026

Good morning.

Here is what changed
while you were away.

──────────────────────

01

NEW IN AI

...

Why this matters

...

──────────────────────

02

NEW TOOL

...

──────────────────────

03

RESEARCH

...
```

No final:

```text
Your next move

[ Learn ]
```

---

# 33. Onboarding

O onboarding deve parecer uma conversa curta.

### Step 01

```text
What are you trying to become?
```

### Step 02

```text
What do you already know?
```

### Step 03

```text
What are you currently building?
```

### Step 04

```text
What do you want to keep an eye on?
```

### Step 05

```text
How much time do you have per day?
```

Opções:

```text
10 min
20 min
30 min
1 hour
2+ hours
```

---

# 34. Personalization

O sistema deverá permitir:

```text
My interests

AI
Backend
Open Source
Systems
Programming Languages
DevOps
```

Cada interesse poderá possuir prioridade:

```text
High
Medium
Low
```

---

# 35. Feedback

Cada recomendação deverá possuir feedback simples:

```text
Was this useful?

👍 Yes

👎 No

Not for me
```

Esse feedback deve ser discreto.

---

# 36. Empty States

Nunca apresentar uma tela vazia.

Exemplo:

```text
Nothing here yet.

Your brain is still learning
what matters to you.

[Explore technology]
```

---

# 37. Loading States

Preferência por skeletons.

Evitar spinners excessivos.

Exemplo:

```text
████████████████
██████████
████████████████████
```

---

# 38. AI Loading

Para operações de IA:

```text
Analyzing...

Understanding context...
Connecting ideas...
```

Evitar:

> "Loading AI..."

A interface pode comunicar o que está acontecendo.

---

# 39. Microinterações

As animações devem ser discretas.

Exemplos:

- conteúdo entrando no feed;
- progresso de aprendizagem;
- expansão de conhecimento;
- atualização do Daily Brief;
- transição entre estados.

Duração:

```text
150–250ms
```

---

# 40. Motion

O movimento deve transmitir:

```text
fluidez
continuidade
processamento
descoberta
```

Não usar animações decorativas em excesso.

---

# 41. Responsividade

Desktop:

```text
Sidebar
+
3-column layout
```

Tablet:

```text
Collapsed sidebar
+
2 columns
```

Mobile:

```text
Single column
+
Bottom navigation
```

---

# 42. Mobile First

No mobile:

Prioridade:

```text
1. Daily Brief
2. Now
3. Learn
4. Build
5. Notifications
```

O usuário deverá conseguir consumir uma atualização em poucos segundos.

---

# 43. Mobile Feed

```text
┌───────────────────────────┐
│ 🧠 My Current Brain       │
│                           │
│ Today                     │
│                           │
│ NEW TOOL                  │
│                           │
│ Local AI framework...     │
│                           │
│ Why it matters            │
│ Relevant to your project. │
│                           │
│ [Read]                    │
│                           │
├───────────────────────────┤
│ 🏠  ⚡  📚  🔨  🧩       │
└───────────────────────────┘
```

---

# 44. Acessibilidade

Obrigatório:

- contraste adequado;
- navegação por teclado;
- foco visível;
- labels;
- ARIA quando necessário;
- tamanho adequado de elementos;
- suporte a screen readers.

---

# 45. Design System

Componentes base:

```text
Button
Input
Select
Tabs
Badge
Card
Avatar
Tooltip
Dialog
Drawer
Dropdown
Toast
Progress
Skeleton
CommandMenu
```

Componentes específicos:

```text
ContentItem
KnowledgeNode
KnowledgeCard
ProjectCard
LearningCard
BriefSection
SourceBadge
RecommendationCard
BuildUpdate
```

---

# 46. Espaçamento

Utilizar sistema consistente:

```text
4
8
12
16
24
32
48
64
```

Evitar espaçamentos arbitrários.

---

# 47. Grid

Base:

```text
12 columns
```

Desktop:

```text
max-width:
1280–1440px
```

Conteúdo centralizado.

---

# 48. Densidade

O My Current Brain deverá possuir uma densidade maior que aplicativos convencionais.

Motivo:

O usuário é técnico e precisa visualizar bastante informação.

Porém:

```text
densidade alta
≠
interface poluída
```

A organização visual deverá compensar a quantidade de dados.

---

# 49. Ícones

Utilizar ícones simples e consistentes.

Preferência:

```text
Lucide
```

Evitar utilizar emojis como elemento principal da interface.

Emojis podem existir em conteúdos editoriais, mas não devem definir o design system.

---

# 50. Dark Mode

Dark mode deverá ser tratado como uma experiência principal, não apenas uma inversão de cores.

O sistema deve funcionar muito bem em:

```text
Dark
Light
```

Usuário poderá escolher:

```text
System
Light
Dark
```

---

# 51. Visualização de Dados

Para conhecimento e evolução:

- barras;
- linhas;
- mapas;
- timelines;
- grafos.

Evitar gráficos excessivamente decorativos.

Cada visualização deve responder uma pergunta.

Exemplo:

> "Em quais áreas estou evoluindo?"

---

# 52. Página "My Evolution"

```text
MY EVOLUTION

Knowledge
         ↑

Projects
         ↑↑

Learning
         ↑

────────────────────

Areas

AI              ████████
Backend         ███████
DevOps          █████
Architecture    ████
Algorithms      ███
```

---

# 53. Tom da Interface

A linguagem deverá ser:

- direta;
- inteligente;
- curta;
- humana;
- técnica quando necessário.

Evitar:

> "Parabéns! Você desbloqueou uma nova jornada de aprendizado! 🚀🎉"

Preferir:

> **Knowledge updated.**

ou:

> **You are ready for the next concept.**

---

# 54. Voice

O produto poderá futuramente possuir comandos de voz.

Exemplo:

> "O que aconteceu hoje em IA?"

Resposta:

> "Separei cinco atualizações relevantes para você."

Não é prioridade do MVP.

---

# 55. Design Token Inicial

```text
Background:
#F7F7F5

Surface:
#FFFFFF

Surface Secondary:
#F1F1EF

Text:
#171717

Text Secondary:
#737373

Border:
#E5E5E5

Accent:
#4F7CFF

Success:
#22C55E

Warning:
#F59E0B

Error:
#EF4444

Radius:
6px / 8px / 12px

Spacing:
4 / 8 / 12 / 16 / 24 / 32 / 48 / 64
```

---

# 56. Referência Estética

A interface deve combinar características de:

```text
Editorial
        +
Developer Tool
        +
Knowledge Management
        +
Research Tool
        +
Personal OS
```

A inspiração conceitual não deve ser uma cópia de nenhum produto específico.

---

# 57. Regra de Ouro

Cada tela deverá responder:

> **"O que eu deveria fazer agora?"**

Se a tela apenas mostra informações, ela ainda não está cumprindo completamente o propósito do produto.

---

# 58. Experiência Ideal

O usuário abre o sistema.

Primeiro vê:

```text
WHAT'S NEW
```

Depois:

```text
WHY IT MATTERS
```

Depois:

```text
WHAT TO LEARN
```

E finalmente:

```text
WHAT TO BUILD
```

O fluxo psicológico é:

```text
Curiosidade
    ↓
Compreensão
    ↓
Aprendizado
    ↓
Ação
```

---

# 59. Identidade

## Nome

**My Current Brain**

## Abreviação

**MCB**

## Símbolo

Um símbolo abstrato combinando:

```text
brain
+
network
+
cursor
+
signal
```

Evitar desenhar literalmente um cérebro humano.

---

# 60. Logo

Direção:

```text
     ╭──────╮
   ╭─┤  · · ├─╮
   │ │ ·──· │ │
   ╰─┤  · · ├─╯
     ╰──────╯
```

Conceito:

> Uma rede de conhecimento em constante atualização.

---

# 61. Tagline

Principal:

> **Stay curious. Stay current.**

Alternativa:

> **Build your current brain.**

Descrição:

> **A personal intelligence system for continuous technical learning.**

---

# 62. Princípio Final de Design

O My Current Brain deve parecer menos:

> "um site onde você lê notícias"

e mais:

> **"um ambiente pessoal onde seu conhecimento técnico está vivo."**

A interface deve comunicar continuamente:

```text
O mundo está mudando.

Seu conhecimento também.

Vamos acompanhar os dois.
```
