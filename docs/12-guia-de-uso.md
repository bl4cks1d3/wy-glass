# 12. Guia de uso

Guia prático do dia a dia. Para arquitetura/como foi construído, ver os outros documentos (`00-indice.md`). Este aqui é só "como eu uso isso".

---

## 12.1 Início rápido

1. Óculos ligados e pareados no Windows como dispositivo de áudio Bluetooth (uma vez só, `Configurações > Bluetooth e dispositivos`) — e o **rádio Bluetooth do PC ligado** (não só o dispositivo pareado; se o rádio estiver desligado, nada de voz funciona até religar).
2. Dois atalhos na área de trabalho:
   - **`Wy Glass - Servidor.lnk`** — sobe o servidor (se já não estiver rodando). Não abre nenhuma janela — roda oculto.
   - **`Wy Glass - Dashboard.lnk`** — abre o painel de controle. Se o servidor não estiver de pé, ele sobe sozinho antes de abrir o painel.
3. Depois disso, é só usar os botões físicos dos óculos, dizer **"Hey Jarvis"**, ou falar com o assistente.

Não precisa abrir nenhum arquivo `.py` nem terminal — os atalhos cobrem os dois casos de uso (rodar em segundo plano / abrir o painel visual). A wake word só liga depois que os óculos conectam de verdade (`/api/status` com `"connected": true`) — ela usa o mesmo microfone Bluetooth.

## 12.2 O que cada botão (ou a wake word) faz hoje

| Gesto | Ação |
|---|---|
| **Botão 1 (frente) · clique simples** | Acorda o Jarvis (agente unificado — Groq + busca + navegador + visão de tela). Grava sua pergunta, responde, e **encerra** (não fica em loop — clique de novo pra perguntar outra coisa). |
| **Botão 1 (frente) · clique duplo** | Mesmo agente unificado (Groq), em modo conversa contínua — fica ouvindo de novo depois de cada resposta, sem precisar clicar de novo, até você apertar o botão 2. |
| **Botão 1 (frente) · clique triplo** | Tradutor bidirecional (PT↔EN) — grava sua fala, traduz e fala em voz alta, direção decidida automaticamente. |
| **Botão 2 (trás) · clique simples** | Encerra uma conversa em andamento (relevante pro clique duplo do botão 1, que fica em loop) — e corta a fala do assistente na hora, se ele estiver falando. |
| **Botão 2 (trás) · clique duplo** | Abre o Dashboard. |
| **Dizer "Hey Jarvis"** | Mesmo fluxo do clique simples do botão 1 — sem precisar tocar nos óculos. Se você cadastrou sua voz (§12.7), só responde a você. |

Isso é configurável — ver §12.5 se quiser mudar o que cada gesto faz.

## 12.3 Conversando com o Jarvis (botão 1 clique simples, ou "Hey Jarvis")

Aperte o botão 1 (ou diga "Hey Jarvis"), espere a saudação ("Bom dia/Boa tarde/Boa noite, sankofa. O que você precisa?"), e fale. Ele consegue:

- **Responder perguntas gerais** — é uma conversa normal, sem gatilho especial. Ele lembra do que foi dito antes, dentro da mesma sessão.
- **Pesquisar na internet** — peça explicitamente ("pesquisa X", "busca Y"). Usa Tavily (se configurado) → Wikipedia → DuckDuckGo, nessa ordem, escolhendo a primeira fonte que responder.
- **Ver o clima** — perguntas com "tempo", "temperatura", "clima" vão direto pro wttr.in (dado ao vivo, mais confiável que busca genérica).
- **Câmbio/moedas** — "quanto tá o dólar", "cotação do euro" vão direto pro Frankfurter (taxas do Banco Central Europeu).
- **Criptomoedas** — "quanto tá o bitcoin" vai direto pro CoinGecko (preço em tempo real).
- **Feriados** — "próximo feriado" vai direto pro Nager.Date (feriados nacionais do Brasil).
- **Ver sua tela** — peça explicitamente ("olha minha tela", "o que você vê na tela", "visualiza minha tela"). Ele tira um print e descreve via visão do Groq.
- **Abrir uma página** — peça explicitamente ("abre o site X").
- **Notícias** — peça explicitamente ("quais as notícias de hoje").
- **Abrir o dashboard** — peça ("abre o dashboard", "mostra o painel") em vez de usar o botão.
- **Trocar de personalidade** — "vira o modo sério" / "fica brincalhão" / "modo professor" / "volta ao normal". Vale a partir da próxima resposta.
- **Traduzir** — "inicia tradução" (ou clique triplo no botão 1) ativa o tradutor: fala qualquer coisa em português ou inglês, ele responde já traduzido, na voz certa.
- **Encerrar a conversa contínua** (se estiver em modo loop) — "tchau", "até mais", "pode encerrar", ou clique no botão 2.

Ele só faz essas ações quando você pede claramente — perguntas soltas tipo "e aí" nunca disparam nada sozinhas. Alguns desses comandos (tradução, personas, encerrar) são reconhecidos por um classificador local (sem chamar nenhuma IA) — mais rápido, mas cai pro Groq normalmente se a frase não for bem reconhecida.

## 12.4 O Dashboard

Três abas:

- **STATUS** — conexão dos óculos, estado da conversa, tabela de gestos configurados (duplo-clique numa linha testa o gesto na hora), log de eventos ao vivo.
- **GESTOS** — editor completo: escolhe um dos 6 slots (botão 1/2 × simples/duplo/triplo), define rótulo + ação (lista suspensa) + parâmetros em JSON, salva/testa/limpa.
- **CONFIGURAÇÕES** — endereço BLE dos óculos, liga/desliga escuta passiva (wake word "Hey Jarvis" + detecção de palma opcional, ver §12.2 e `07-roteiro-futuro.md`), e as **capacidades** (chaves de API — Groq, Tavily, Google/Gemini). Uma chave por serviço, usada por qualquer gesto que precisar dela.

## 12.5 Configurar seus próprios gestos

Na aba GESTOS: escolha um slot (`button2_triple` é o único ainda livre por padrão hoje — os outros 5 já vêm mapeados), escolha a ação na lista, ajuste os parâmetros (já vem um modelo pré-preenchido pra cada ação) e clique em Salvar. Tipos de ação disponíveis:

| Ação | O que faz |
|---|---|
| `open_jarvis_agent` | O agente unificado (Groq) — some `conversation_mode: true` nos parâmetros pra virar loop contínuo, igual ao botão 1 duplo |
| `jarvis_voice_agent` | Pipeline alternativo, multi-provedor (Gemini/OpenRouter/Mistral/Ollama) — só faz sentido se precisar de um provedor específico nesse gesto; o padrão do Wy Glass é `open_jarvis_agent`/Groq em todo mundo (ver `06-referencia-acoes.md`) |
| `translator_agent` | Tradutor bidirecional (PT↔EN), turno único |
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
| "Hey Jarvis" não responde | Confirme que os óculos estão **conectados** (`/api/status` → `"connected": true`) — a wake word só liga depois disso, precisa do microfone dos óculos como dispositivo de áudio. Se o rádio Bluetooth do PC estiver desligado, nada disso funciona. |
| "Hey Jarvis" não responde, mas o botão funciona normalmente | Se você cadastrou sua voz (`enroll_voice.py`), confira se está falando parecido com como gravou o cadastro — o limiar (`speaker_match_threshold`, padrão 0.75) pode estar rejeitando por engano num dia de voz diferente (gripe, sussurrando, etc). Recadastre ou baixe o limiar no Dashboard. |
| Cliquei o botão e nada aconteceu | Confira `AÇÕES REAIS` no Dashboard — se estiver em "MODO TESTE", nenhuma ação de verdade executa (só aparece no log). |
| Clique duplo não registrou | O clique físico precisa ser rápido mas não instantâneo — a janela de detecção é de 0.8s. Se ainda falhar, pode ser o hardware perdendo o segundo clique (raro). |
| Dashboard não abre / fica em branco | Confirme que o servidor está rodando (`Wy Glass - Servidor.lnk` ou veja se `http://127.0.0.1:8731/api/status` responde). |
| Busca não encontra nada | Confira se a chave Tavily está preenchida em CONFIGURAÇÕES — sem ela, cai só pra Wikipedia/DuckDuckGo, que são mais limitados. |
| Groq/Tavily com erro de limite | Free tiers têm cota — esperar um pouco. |
| Tradução (PT→EN) sai só em português | Falta a voz `en_US-lessac-medium.onnx` em `tts_models/` — baixe (ver `05-instalacao.md` §5.3). Sem ela, só a metade idioma-estrangeiro→português funciona. |

## 12.7 Cadastrar sua voz (reconhecimento de locutor, opcional)

Por padrão, "Hey Jarvis" responde a qualquer voz. Pra restringir à sua:

1. Feche o servidor (ele também usa o microfone dos óculos — os dois brigando pelo mesmo dispositivo dá problema).
2. Rode `python enroll_voice.py` num terminal, na pasta do projeto — ele pede pra você falar 5 frases curtas.
3. Suba o servidor de novo.

Isso salva `voice_profile.npy` localmente (nunca sai da sua máquina). Pra recadastrar, é só rodar de novo — sobrescreve sem perguntar. O botão físico nunca passa por essa checagem.

---

*Para detalhes técnicos de cada peça (protocolo BLE, arquitetura, agente unificado), ver `00-indice.md`.*
