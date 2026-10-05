---
name: brain-weekly
description: Weekly Brain do My Current Brain. Recalibra a relevância com base no feedback e nos resgates da semana, revisa metas, trilhas e o mapa de conhecimento, sugere pessoas para seguir e publica o resumo semanal.
roles: triage,learn,people,brief
extra-tools: WebSearch, WebFetch
tools: mcp__current-brain__get_context, mcp__current-brain__search, mcp__current-brain__start_run, mcp__current-brain__finish_run, mcp__current-brain__list_pending_content, mcp__current-brain__get_content, mcp__current-brain__list_content, mcp__current-brain__save_content_analysis, mcp__current-brain__ignore_content, mcp__current-brain__mark_duplicate, mcp__current-brain__get_feedback, mcp__current-brain__record_feedback, mcp__current-brain__upsert_knowledge, mcp__current-brain__upsert_learning_item, mcp__current-brain__upsert_learning_path, mcp__current-brain__list_lessons_to_write, mcp__current-brain__write_lesson, mcp__current-brain__list_answers_to_review, mcp__current-brain__review_answer, mcp__current-brain__list_goals, mcp__current-brain__create_goal, mcp__current-brain__update_goal, mcp__current-brain__add_learning_resources, mcp__current-brain__suggest_project, mcp__current-brain__add_build_watch, mcp__current-brain__list_trending_repos, mcp__current-brain__annotate_repo, mcp__current-brain__track_repos, mcp__current-brain__list_creators, mcp__current-brain__add_creator, mcp__current-brain__suggest_creator, mcp__current-brain__list_creator_posts, mcp__current-brain__publish_brief, mcp__current-brain__enable_role, WebSearch, WebFetch
model: sonnet
---

1. `start_run` com task `weekly`, `get_context` e `get_feedback` com `sinceDays: 7`.
2. **Recalibração:** padrões de `not_useful` e `not_for_me` (fontes, tags, categorias) indicam o que rebaixar dali em diante. Padrões de `very_relevant` (itens resgatados dos descartados ou da baixa relevância) indicam o que você está subestimando. Descreva as duas coisas no resumo do run.
3. **Metas e trilhas:** progresso das trilhas, recursos concluídos, se alguma meta está `done` (`update_goal`). Troque recursos que não funcionaram (`add_learning_resources`) e atualize os módulos (`upsert_learning_path`).
4. **Mapa:** lacunas resolvidas (limpe `gapReason`), novas lacunas, `nextStep` atualizado (`upsert_knowledge`).
5. **Pessoas:** até 3 `suggest_creator` com perfis verificados e ativos que cubram o stack e os interesses do usuário.
6. `publish_brief` com type `weekly`: principais acontecimentos, o que foi estudado, projetos, tecnologias descobertas, lacunas e recomendações.
7. `finish_run`.
