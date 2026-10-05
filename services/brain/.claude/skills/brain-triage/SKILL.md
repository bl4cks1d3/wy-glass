---
name: brain-triage
description: Procedimento de triagem de conteúdo do My Current Brain (analisar, descartar ou agrupar itens pendentes com as três camadas separadas). Use sempre que for processar itens de list_pending_content, no fluxo diário, no Catch-up ou em uma triagem avulsa.
---

# Triagem de conteúdo pendente

Esta é a regra única de triagem. `brain-triage`, `brain-catchup` e `brain-weekly` seguem exatamente este procedimento.

## Antes de começar

- `get_context`: perfil (stack, interesses e prioridades), metas, projetos, lacunas, `recentFeedback` e `rejectedProjects`.
- `get_feedback` com `sinceDays: 14`. Itens que o usuário marcou como **very_relevant** (resgatados) mostram o que você anda subestimando. `not_useful` e `not_for_me` mostram o que rebaixar.

## Loop

1. `list_pending_content` com limit 40. Itens com `rescuedByUser: true` vêm primeiro: **analise sempre** (P1/P2) e nunca descarte.
2. Para cada item, uma decisão:
   - **Duplicado:** o mesmo evento já foi analisado (confira com `list_content`, `sinceHours: 72`). → `mark_duplicate`.
   - **Fora do foco:** não se conecta a meta, stack, projeto, lacuna nem interesse alto ou médio. → descartar.
   - **Relevante:** → analisar.
3. **Analisar** (`save_content_analysis`, lotes de até 20). As três camadas ficam separadas:
   - `summary`: 2 ou 3 frases factuais, só com o que a fonte diz. Se o trecho for curto demais para isso, faça `WebFetch` na URL. Nunca invente números, versões ou nomes.
   - `whyItMatters`: 1 ou 2 frases citando **pelo nome** a meta, o projeto, a lacuna ou a tecnologia do usuário.
   - `keyPoints`: 3 pontos objetivos. `explain.code`, `explain.architecture` e `explain.application` quando fizer sentido técnico.
   - `learnTopic` e `relatedKnowledge` para ligar o item ao mapa.
   - Prioridade: **P0** crítico e acionável (CVE ou breaking change no stack) · **P1** ligação forte com projeto, meta ou lacuna · **P2** interesse alto · **P3** interessante, sem urgência.
   - Frontier: preencha `maturity` (1–5) e `signals`.
4. **Descartar** (`ignore_content` com `items`): **um motivo específico por item**, dizendo o que o item é e por que está fora do foco. O usuário lê esses motivos na aba Descartados. Rótulos genéricos de lote são proibidos e o hook de validação bloqueia.
5. Repita até não restarem pendentes, ou até ~150 itens no run.

## Depois do loop

- Conceitos que aparecem em 2 ou mais itens relevantes → `upsert_knowledge` com `evidence: [{kind: "seen"}]`. Use `gapReason` quando o conceito for pré-requisito de uma meta ou projeto.
- Links de GitHub em itens relevantes → `track_repos`.

## Tom

Idioma do perfil (pt-BR), direto, técnico, sem hype e sem emojis.
