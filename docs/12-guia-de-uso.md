# 12. Guia de uso

Guia prático do dia a dia. Para arquitetura/como foi construído, ver os outros documentos (`00-indice.md`). Este aqui é só "como eu uso isso".

---

## 12.1 Início rápido

1. Óculos ligados e pareados no Windows como dispositivo de áudio Bluetooth (uma vez só, `Configurações > Bluetooth e dispositivos`).
2. Dois atalhos na área de trabalho:
   - **`Wy Glass - Servidor.lnk`** — sobe o servidor (se já não estiver rodando). Não abre nenhuma janela — roda oculto.
   - **`Wy Glass - Dashboard.lnk`** — abre o painel de controle. Se o servidor não estiver de pé, ele sobe sozinho antes de abrir o painel.
3. Depois disso, é só usar os botões físicos dos óculos ou falar com o assistente.

Não precisa abrir nenhum arquivo `.py` nem terminal — os atalhos cobrem os dois casos de uso (rodar em segundo plano / abrir o painel visual).

## 12.2 O que cada botão faz hoje

| Gesto | Ação |
|---|---|
| **Botão 1 (frente) · clique simples** | Acorda o Jarvis (agente unificado — Groq + busca + navegador + visão de tela). Grava sua pergunta, responde, e **encerra** (não fica em loop — clique de novo pra perguntar outra coisa). |
| **Botão 1 (frente) · clique duplo** | Alternativa via Gemini puro (conversa contínua — fica ouvindo até você apertar o botão 2). |
| **Botão 2 (trás) · clique simples** | Encerra uma conversa em andamento (relevante pro clique duplo do botão 1, que fica em loop). |
| **Botão 2 (trás) · clique duplo** | Abre o Dashboard. |

Isso é configurável — ver §12.5 se quiser mudar o que cada gesto faz.

## 12.3 Conversando com o Jarvis (botão 1, clique simples)

Aperte o botão 1, espere a saudação ("Bom dia/Boa tarde/Boa noite, sankofa. O que você precisa?"), e fale. Ele consegue:

- **Responder perguntas gerais** — é uma conversa normal, sem gatilho especial.
- **Pesquisar na internet** — peça explicitamente ("pesquisa X", "busca Y"). Usa Tavily (se configurado) → Wikipedia → DuckDuckGo, nessa ordem, escolhendo a primeira fonte que responder.
- **Ver o clima** — perguntas com "tempo", "temperatura", "clima" vão direto pro wttr.in (dado ao vivo, mais confiável que busca genérica).
- **Câmbio/moedas** — "quanto tá o dólar", "cotação do euro" vão direto pro Frankfurter (taxas do Banco Central Europeu).
- **Criptomoedas** — "quanto tá o bitcoin" vai direto pro CoinGecko (preço em tempo real).
- **Feriados** — "próximo feriado" vai direto pro Nager.Date (feriados nacionais do Brasil).
- **Ver sua tela** — peça explicitamente ("olha minha tela", "o que você vê na tela", "visualiza minha tela"). Ele tira um print e descreve via visão do Groq (Llama 4 Scout).
- **Abrir uma página** — peça explicitamente ("abre o site X").
- **Notícias** — peça explicitamente ("quais as notícias de hoje").
- **Abrir o dashboard** — peça ("abre o dashboard", "mostra o painel") em vez de usar o botão.

Ele só faz essas ações quando você pede claramente — perguntas soltas tipo "e aí" nunca disparam nada sozinhas.

## 12.4 O Dashboard

Três abas:

- **STATUS** — conexão dos óculos, estado da conversa, tabela de gestos configurados (duplo-clique numa linha testa o gesto na hora), log de eventos ao vivo.
- **GESTOS** — editor completo: escolhe um dos 6 slots (botão 1/2 × simples/duplo/triplo), define rótulo + ação (lista suspensa) + parâmetros em JSON, salva/testa/limpa.
- **CONFIGURAÇÕES** — endereço BLE dos óculos, liga/desliga escuta passiva (ainda não calibrada, ver `07-roteiro-futuro.md`), e as **capacidades** (chaves de API — Groq, Tavily, Google/Gemini). Uma chave por serviço, usada por qualquer gesto que precisar dela.

## 12.5 Configurar seus próprios gestos

Na aba GESTOS: escolha um slot vazio (button1_triple e button2_triple estão livres hoje), escolha a ação na lista, ajuste os parâmetros (já vem um modelo pré-preenchido pra cada ação) e clique em Salvar. Tipos de ação disponíveis:

| Ação | O que faz |
|---|---|
| `open_jarvis_agent` | O agente unificado completo (o mesmo do botão 1 simples) |
| `jarvis_voice_agent` | Conversa via Gemini (multi-provedor — ver `06-referencia-acoes.md`) |
| `open_dashboard` | Abre o painel |
| `stop_conversation` | Encerra uma conversa em andamento |
| `run_command` | Executa um programa |
| `open_url` | Abre uma URL no navegador padrão |
| `key_shortcut` | Simula um atalho de teclado |
| `screenshot` | Tira print da tela |
| `voice_command` | Grava um áudio cru, sem IA |

Nenhuma dessas ações precisa de campo de chave de API no JSON — as credenciais (aba CONFIGURAÇÕES) são injetadas automaticamente.

## 12.6 Problemas comuns

| Sintoma | O que fazer |
|---|---|
| Óculos aparecem como desconectados | Eles desligam sozinhos após alguns minutos sem uso — só ligar de novo (o servidor reconecta sozinho, sem precisar reiniciar nada). |
| Cliquei o botão e nada aconteceu | Confira `AÇÕES REAIS` no Dashboard — se estiver em "MODO TESTE", nenhuma ação de verdade executa (só aparece no log). |
| Clique duplo não registrou | O clique físico precisa ser rápido mas não instantâneo — a janela de detecção é de 0.8s. Se ainda falhar, pode ser o hardware perdendo o segundo clique (raro). |
| Dashboard não abre / fica em branco | Confirme que o servidor está rodando (`Wy Glass - Servidor.lnk` ou veja se `http://127.0.0.1:8731/api/status` responde). |
| Busca não encontra nada | Confira se a chave Tavily está preenchida em CONFIGURAÇÕES — sem ela, cai só pra Wikipedia/DuckDuckGo, que são mais limitados. |
| Groq/Tavily/Gemini com erro de limite | Free tiers têm cota — esperar um pouco ou trocar de provedor no `button1_double` (Gemini) como alternativa. |

---

*Para detalhes técnicos de cada peça (protocolo BLE, arquitetura, agente unificado), ver `00-indice.md`.*
