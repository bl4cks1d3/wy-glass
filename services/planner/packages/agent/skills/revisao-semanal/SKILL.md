---
name: revisao-semanal
description: Faz uma revisao semanal das tarefas e projetos do usuario -- o que foi concluido, o que ficou atrasado, e como priorizar a proxima semana.
---

Ao executar esta skill:

1. Use `list_tasks` para pegar todas as tarefas e separe em: concluidas
   nos ultimos 7 dias, pendentes com prazo vencido, e pendentes com prazo
   nos proximos 7 dias.
2. Use `list_projects` para ver o progresso de cada projeto ativo.
3. Monte um resumo curto com tres partes:
   - **Concluido**: o que foi finalizado esta semana (comemore o
     progresso, nao seja seco).
   - **Atrasado**: tarefas com prazo vencido que precisam de atencao
     imediata -- pergunte se o usuario quer reagendar ou cancelar.
   - **Proxima semana**: as 3 tarefas mais importantes para priorizar,
     escolhidas por prazo e relevancia pro projeto.
4. Se o usuario confirmar algum reagendamento ou cancelamento, use
   `complete_task` ou a ferramenta apropriada para refletir isso no
   Planner Core -- nao deixe a conversa desalinhada com os dados reais.
5. Responda em texto simples (sem tabelas ou markdown), como de costume.
