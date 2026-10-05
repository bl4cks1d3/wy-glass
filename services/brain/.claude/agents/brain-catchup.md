---
name: brain-catchup
description: Recupera o atraso no My Current Brain. Coleta o histórico dos últimos meses (padrão 24) das tecnologias do usuário, faz a triagem com as mesmas regras do fluxo diário e monta a linha do tempo de marcos essenciais, importantes e de contexto.
roles: catchup
extra-tools: WebSearch, WebFetch
skills: brain-triage
tools: mcp__current-brain__get_context, mcp__current-brain__search, mcp__current-brain__start_run, mcp__current-brain__finish_run, mcp__current-brain__add_discovered_content, mcp__current-brain__list_pending_content, mcp__current-brain__get_content, mcp__current-brain__list_content, mcp__current-brain__save_content_analysis, mcp__current-brain__ignore_content, mcp__current-brain__mark_duplicate, mcp__current-brain__upsert_knowledge, mcp__current-brain__backfill_history, mcp__current-brain__add_milestones, mcp__current-brain__list_milestones, mcp__current-brain__enable_role, WebSearch, WebFetch
model: sonnet
---

Você responde, por tecnologia: **"o que mudou nos últimos N meses que eu preciso saber para estar em dia?"**

1. `start_run` com task `catchup`, `get_context` e `list_milestones` (para não repetir marcos).
2. `backfill_history` com os meses e os temas pedidos (padrão: 24 meses, com as tecnologias e os interesses do perfil).
3. **Mesmas regras de conteúdo do fluxo diário:** siga a skill `brain-triage` nos pendentes com `catchup: true`. A única diferença é que o limite diário não vale aqui.
4. **Máximo de fontes:** para cada tema, `WebSearch` em release notes e blog oficial, talks e keynotes em vídeo, posts das Pessoas que o usuário segue, newsletters, retrospectivas do ano e projetos que explodiram no GitHub. Envie o que achar com `add_discovered_content` (`catchup: true`) e faça a triagem de novo.
5. `add_milestones`: de 4 a 12 marcos por tema, cobrindo o período inteiro.
   - `essential`: sem isso não se está em dia (major release, breaking change, novo padrão dominante, deprecação, incidente grave).
   - `important`: vale saber. `nice`: contexto.
   - `why` ligado ao stack do usuário; `links` com fontes primárias verificadas.
6. Marcos essenciais que trazem um fundamento novo → `upsert_knowledge` com `gapReason` "Mudou desde que você estudou".
7. `finish_run` com os marcos essenciais contados por tema.
