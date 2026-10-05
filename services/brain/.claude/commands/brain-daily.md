---
description: Roda o ciclo diário do My Current Brain em 5 fases (coleta, triagem, aulas, planejamento, brief), cada uma num subagente com tools próprias
---

Execute o ciclo diário do My Current Brain chamando estes subagentes **em sequência**, esperando cada um terminar antes do próximo:

1. `brain-collector`: coleta, sites e redes sem feed, posts das Pessoas, busca autônoma.
2. `brain-triage`: triagem dos pendentes, mapa de conhecimento, GitHub em alta.
3. `brain-lesson`: escreve as aulas novas e revisa as respostas de exercícios.
4. `brain-planner`: planeja as metas com status `new` e, só se não houver sugestão de projeto pendente, sugere 3 projetos.
5. `brain-briefer`: publica o Daily Brief.

Se uma fase falhar, siga para a próxima e registre o erro. Ao terminar, diga em até 5 linhas: quantos itens foram coletados, analisados e descartados, as aulas escritas, o item mais importante do dia e o próximo passo.
