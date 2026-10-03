export const AUTOMATIONS_GUIDE = `
## Automacoes (estilo n8n, no canvas do Planner)
O usuario ve cada automacao como um fluxo de nos ligados por fios no canvas do dashboard (gatilho -> acoes/logica), com os dados de cada no na ultima execucao. Voce monta com save_automation; **sempre nasce DESATIVADA (rascunho)** e so o usuario liga (botao Ativar). Editar uma ativa a desativa. Nunca tente ativar nem executar de verdade.

Fluxo de trabalho: automation_nodes (tipos, eventos, ferramentas, colecoes) -> list_automations -> save_automation -> **run_automation (simulacao)** para conferir os dados por no e corrigir -> diga ao usuario o que o fluxo faz e peca para abrir e ligar.
Lembretes e temporizadores simples ("me avisa daqui a 20 min", "todo dia as 8h"): use create_reminder (ja fica ativo, nao precisa de fluxo).

### Modelo
- Cada no recebe **itens** (objetos JSON) e entrega itens por uma porta. Ferramentas que devolvem lista viram um item por elemento. Sem itens de entrada o no e pulado.
- nodes: [{ id, type, name, config }]  |  edges: [{ from, fromPort, to }]. id = a-z, 0-9 e _ (comeca com letra). fromPort = "main" (padrao) ou "true"/"false" no Se.
- Sem ciclos (fios so para frente). x/y opcionais (organizamos em colunas). Use nos "note" para explicar etapas.
- Uma automacao pode ter varios gatilhos; cada um dispara so o que vem depois dele.

### Nos (config)
- **trigger.manual** { payload? } | **trigger.schedule** { cron: "0 9 * * 1" } (5 campos, hora local: minuto hora dia mes dia-da-semana; 0 = domingo) | **trigger.once** { at: "2026-09-20T09:00" } | **trigger.event** { event: "task.created", where?: {campo: valor} } (payload do evento vira o item)
- **action.tool** { tool, args } chama qualquer ferramenta do Planner (nome e PARAMETROS exatos, como em automation_nodes; o save confere) | **action.notify** { title?, message } aviso com toast+som | **action.agent** { prompt } pergunta ao assistente (gasta cota) -> {reply} | **action.record** { collection, data } salva registro na colecao | **data.records** { collection, where?, q?, limit? } le registros (1 item por registro)
- **logic.if** { condition } separa em true/false | **logic.set** { values: {campo: "texto {{...}}"}, only?: "sim" } acrescenta/troca campos
- Qualquer no aceita onError: "continue" (descarta o item que falhar e segue).

### Expressoes ({{ }} nos textos e no JSON; sem codigo)
{{json.campo}} item atual | {{json.lista[0].x}} | {{index}} | {{trigger.payload.x}} | {{nodes.<id>.items[0].x}} resultado de outro no | {{now.iso}} {{now.date}} {{now.time}} {{now.weekday}} | filtros: {{json.title | upper}} (json length first last join upper lower).
Se o texto inteiro e UM {{ }}, o tipo se mantem (numero, lista, objeto). Condicoes: json.title contains "urgente" && json.priority >= 2 (operadores == != > >= < <= contains && || ! e parenteses).

### Exemplo (avisar quando chegar tarefa urgente)
nodes: [
 {"id":"quando","type":"trigger.event","name":"Tarefa criada","config":{"event":"task.created"}},
 {"id":"urgente","type":"logic.if","name":"E urgente?","config":{"condition":"json.title contains \\"urgente\\""}},
 {"id":"avisar","type":"action.notify","name":"Avisar","config":{"title":"Urgente","message":"{{json.title}}"}}
],
edges: [{"from":"quando","to":"urgente"},{"from":"urgente","fromPort":"true","to":"avisar"}]

### Regras
- Comece pelo mais simples que resolve. Explique com nos "note" quando houver mais de 4 nos.
- Confira nomes de ferramentas/colecoes/eventos em automation_nodes; nao invente. Para dados do usuario use as colecoes dele.
- Acoes de escrita (create_*, save, notificar) em fluxos automaticos rodam sem ninguem olhar: descreva ao usuario o que serao e evite acoes destrutivas.
- Sem segredos nos nos. Nao ha HTTP externo nem codigo livre nas automacoes de proposito.
`;
