# 9. Pesquisa de features — o que faria do Wy Glass um projeto legal

Pesquisa de mercado (Meta Ray-Ban, projetos open source) cruzada com o que nosso hardware permite, filtrada por um critério importante: **este é um projeto hobby, sem câmera em uso, focado inteiramente em voz e áudio.**

## 9.1 O que o mercado está fazendo (2026) — contexto

**Meta Ray-Ban** (referência comercial madura):
- Tradução ao vivo (áudio e visual) em tempo real, várias línguas
- Busca visual: "o que é isso que estou olhando" (landmark, objeto, placa)
- Tradução de texto/placas via câmera
- Navegação com direções por voz
- Legendas ao vivo em chamadas
- Resumo de mensagens (WhatsApp) por voz

**Projetos open source relevantes:**
- [**OpenGlass**](https://github.com/BasedHardware/OpenGlass) (BasedHardware) — mesma filosofia do Wy Glass: "transforme qualquer óculos em óculos de IA".
- [**VisionClaw**](https://github.com/Intent-Lab/VisionClaw) — assistente com **56+ skills via tool-calling** (busca web, mensageria, casa inteligente, notas, lembretes).
- [**OpenSourceSmartGlasses**](https://github.com/Mentra-Community/OpenSourceSmartGlasses) (Mentra) — plataforma aberta, foco em ser "extensível para makers".

Sources: [Meta Ray-Ban translation](https://skift.com/2026/03/31/meta-ray-ban-prescriptions-translation-travel/), [Meta AI glasses features](https://www.meta.com/ai-glasses/real-time-translation/), [OpenGlass](https://github.com/BasedHardware/OpenGlass), [VisionClaw](https://github.com/Intent-Lab/VisionClaw), [OpenSourceSmartGlasses](https://github.com/Mentra-Community/OpenSourceSmartGlasses)

## 9.2 Decisão de escopo: sem câmera, foco 100% em voz/áudio

Diferente do plano inicial desta pesquisa, o projeto **não vai explorar a câmera** — é um hobby pessoal, e o interesse está em construir algo divertido e útil em cima do que já funciona (microfone + alto-falante + 2 botões), não em abrir uma nova frente de engenharia reversa. Boa notícia: a feature mais alardeada do mercado (tradução ao vivo) na verdade **não depende de câmera nenhuma** — só de áudio.

## 9.3 Lista de features (todas aprovadas, aguardando priorização de implementação)

### A. Assistente mais "vivo"

| Feature | Descrição | Esforço |
|---|---|---|
| ~~**Tool-calling / function calling**~~ | ✅ **Implementado** — mas não pelo Gemini: `open_jarvis_agent` (`smart_agent.py`) já usa function calling nativo do Groq desde antes desta pesquisa (a pesquisa original não tinha checado o código-fonte atual). 7 ferramentas reais: busca, abrir URL, ver/tirar print de tela, notícias, abrir dashboard, trocar personalidade, encerrar conversa. | — |
| ~~**Memória de conversa**~~ | ✅ **Implementado** — `smart_agent.conversations` já mantém histórico por `session_id` (últimos 16 turnos), mesmo achado tardio de código já existente. | — |
| ~~**Personas trocáveis**~~ | ✅ **Implementado em 2026-08-08** — ferramenta `set_persona`, 4 personas (`padrao`/`serio`/`brincalhao`/`professor`) em `smart_agent.PERSONAS`. Ver §6.2 de `06-referencia-acoes.md`. | — |
| ~~**Palavra de ativação (wake word)**~~ | ✅ **Implementado em 2026-08-08** — `openWakeWord` (100% local/offline, modelo pré-treinado `hey_jarvis`) integrado em `passive_listener.py`, escutando o mesmo mic compartilhado (`audio_capture.py`) que já existia pra detecção de palma. Ao detectar "Hey Jarvis", abre o mesmo fluxo do botão 1 clique simples — grava o que foi dito e roteia por tool-calling (ver linha abaixo, `start_translator`). Ver §6.4 de `06-referencia-acoes.md`. | — |
| ~~**Todas as funcionalidades por intenção de voz**~~ | ✅ **Implementado em 2026-08-08** — em vez de mapear a wake word pra uma ação fixa, ela só abre o microfone; o que é dito depois é roteado pelo tool-calling que já existia (`smart_agent.TOOLS`), agora incluindo `start_translator` (ativa o tradutor por voz, ex: "Hey Jarvis, inicia tradução"). Nenhuma funcionalidade nova de roteamento foi necessária — só faltava dar ao tradutor um jeito de ser chamado como ferramenta. | — |

### B. Tradutor ao vivo (áudio → áudio)

| Feature | Descrição | Esforço |
|---|---|---|
| ~~**Tradução em tempo real**~~ | ✅ **Implementado parcialmente em 2026-08-08** — ação `translator_agent` (`button1_triple`): grava fala em qualquer idioma (Whisper com detecção automática), traduz e fala em português via Groq + Piper. Só cobre a direção idioma-estrangeiro→português (a volta exigiria baixar uma voz Piper adicional, ex. `en_US` — não feito ainda, pendente de decisão sobre o download). Ver §6.2 de `06-referencia-acoes.md`. | — |

### C. Automação de casa/PC por voz

| Feature | Descrição | Esforço |
|---|---|---|
| **Controle de mídia** | "Toca minha playlist" via API do Spotify (complementa o AVRCP nativo que já existe). | Baixo-médio |
| **Macros de setup** | "Abre meu setup de trabalho" → dispara uma sequência de `run_command`/`open_url` configurada. | Baixo |
| **Casa inteligente** | Integração com Home Assistant (se houver dispositivos smart home) via tool-calling. | Médio |

### D. Notificação / consciência ambiente

| Feature | Descrição | Esforço |
|---|---|---|
| **Leitura de notificações** | Ler em voz alta notificações do Windows (Discord, e-mail) quando chegam. | Médio (exige hook nas notificações do Windows) |
| **Sussurro periódico** | Um lembrete/hora/clima falado de tempos em tempos, sem precisar perguntar. | Baixo |

### E. Puro hobby / diversão

| Feature | Descrição | Esforço |
|---|---|---|
| **Modo walkie-talkie** | Push-to-talk entre dois Wy Glass (ou óculos + celular) — "brinquedo de rádio". | Médio-alto |
| **Modo jogo / trivia** | Perguntas e respostas, piadas, quando não tem nada sério pra fazer. | Baixo (é só um `system_prompt` diferente + gatilho) |
| **Efeitos sonoros customizados** | Um "bip" no ouvido quando chega mensagem, evento, etc. | Baixo |

## 9.4 Notas de implementação

- **Tool-calling**, **tradução ao vivo** e **personas** foram implementados em 2026-08-08 (ver §9.5) — o "cérebro" acabou sendo **Groq** (`smart_agent.py`, `openai/gpt-oss-20b` com function calling nativo), não o Gemini cogitado originalmente aqui; Piper continua sendo o TTS.
- **Leitura de notificações** e **walkie-talkie** continuam não implementadas — são as mais custosas tecnicamente (a primeira exige hook no sistema de notificações do Windows; a segunda exige um segundo dispositivo ou canal de transporte entre máquinas).
- **Modo jogo** e **macros de setup** também continuam não implementados — dariam pra construir em cima da mesma base de "perfis de comportamento" que já existe pras personas (`smart_agent.PERSONAS`).

Ver §9.5 pro que foi implementado e a pesquisa complementar que motivou; `07-roteiro-futuro.md` tem o detalhamento técnico de cada feature.

---

## 9.5 Pesquisa complementar — Instagram, TikTok e fóruns (comunidade maker)

Pesquisa adicional focada em redes sociais e comunidades (não documentação oficial), buscando o que devs/makers estão realmente construindo ou pedindo para AI wearables sem câmera.

### 9.5.1 Contexto de rede social

- **TikTok/Instagram em 2026 estão dominados por controvérsia de privacidade**, não por conteúdo de hacking construtivo: a onda viral é sobre pessoas gravadas sem consentimento com os óculos da Meta (investigação da BBC, TikToker investigado pela Police Scotland, banimento em eventos como DEF CON). Não achamos "tutoriais de hack" virais relevantes ao nosso hardware — o conteúdo que existe é sobre o produto comercial da Meta, não sobre BLE genérico.
- **Implicação prática para o Wy Glass**: mesmo sem câmera, se formos para um modo "sempre ouvindo" (§9.5.3), vale considerar um sinal sonoro (bip) quando a gravação está ativa — já está na lista como "Efeitos sonoros customizados" (§9.3-E), mas agora com motivação mais forte: é o padrão que produtos comerciais (Limitless "Consent Mode") adotam para mitigar exatamente esse problema.

### 9.5.2 Projetos open source encontrados (além dos já listados em §9.1)

| Projeto | O que é | Relevância pro Wy Glass |
|---|---|---|
| [**Omi** (BasedHardware)](https://github.com/BasedHardware/omi) | Pingente de IA 100% open source (firmware BLE + backend + app, MIT license, ~9.5k stars, 300k+ usuários). Escuta continuamente, transcreve e gera memórias/tarefas automaticamente — sem precisar de pergunta explícita. | Referência direta de arquitetura para um modo "memória passiva" (ver §9.5.3) — já resolveram o problema de sumarizar conversas do dia sem interação. |
| [**VisionClaw** (Intent-Lab)](https://github.com/Intent-Lab/VisionClaw) | Assistente para Ray-Ban Meta com **56+ skills via tool-calling** (busca web, WhatsApp/Telegram/iMessage, smart home, notas, lembretes, lista de compras) rodando sobre **Gemini Live** (function calling nativo) + **OpenClaw**. Tem cancelamento de tool-call em andamento (se você interrompe, a chamada em voo é cancelada). | É essencialmente o mesmo stack que já estamos usando (Gemini) aplicado a tool-calling real — boa referência de implementação para a feature "Tool-calling" que já está no nosso backlog (§9.3-A), incluindo o detalhe de cancelamento que combina com nossa interrupção de fala já existente. |
| [**OpenClaw**](https://github.com/Purple-Horizons/openclaw-voice) (e variantes: `openclaw-assistant` Android, `openclaw-voice-control` macOS) | Gateway local self-hosted (Node.js) que conecta apps de chat a agentes de IA, sem precisar de API key própria (usa suas credenciais Anthropic/OpenAI/etc). Várias implementações de voz da comunidade já existem em cima dele (wake word offline, TTS, overlay). | Pode servir de inspiração para desacoplar `actions.py`/`smart_agent.py` do Gemini como backend único — arquitetura plugável de "gateway de agente" já validada pela comunidade. |
| [**OpenSource-Ai-Glasses**](https://github.com/Iam5tillLearning/OpenSource-Ai-Glasses) | Plataforma de óculos IA standalone (Linux embarcado), com canal de texto por BLE e app Android de debug (envia comandos/texto pros óculos via BLE). | Ideia pontual: um "canal de texto por BLE" para debug/comandos rápidos sem passar pelo microfone — daria pra prototipar no nosso `/test` panel. |

### 9.5.3 Feature nova identificada: modo "memória passiva" (always-listening + sumarização)

Diferente do que já estava no backlog (que assume interação por turno, iniciada por botão), a pesquisa em pingentes de IA (Omi, Plaud NotePin, Limitless, Bee) revela um **padrão de produto inteiro que não estava mapeado**: em vez de "pergunta → resposta", o dispositivo escuta passivamente e só produz valor depois (resumo do dia, itens de ação extraídos, lembrete do que foi dito). É um modo de uso diferente do assistente conversacional que já temos.

| Feature | Descrição | Esforço |
|---|---|---|
| **Modo "memória passiva"** | Gravação contínua em background (não só no modo conversacional), com transcrição + sumarização periódica via Gemini (ex.: "resume o que ouvi na última hora"). Complementa, não substitui, o modo conversacional por botão. | Médio-alto (exige VAD contínuo + storage + gestão de privacidade/consentimento) |
| **Sessão contínua sem repetir gatilho** ("Live AI" da Meta) | Hoje cada pergunta no modo conversacional já mantém a sessão aberta até o botão de parar — mas vale considerar um teto de tempo tipo o da Meta (sessões de até 30min, sem precisar re-clicar), como salvaguarda de bateria/API. | Baixo (já é quase isso, só falta o teto configurável) |

### 9.5.4 Correção de premissa sobre wake word

O backlog original (§9.3-A) cita `openWakeWord` e `Porcupine` como opções equivalentes. A pesquisa mostrou uma ressalva técnica: **ambas rodam bem no nosso caso porque o processamento acontece no PC**, não num microcontrolador. Para wearables com MCU embarcado (ESP32 etc.), a comunidade recomenda `microWakeWord` em vez de `openWakeWord` por ser leve o suficiente pra hardware fraco — mas essa limitação **não se aplica ao Wy Glass**, já que o áudio chega via Bluetooth clássico e é processado inteiramente no PC. Ou seja: `openWakeWord` continua sendo a escolha certa, sem necessidade de considerar alternativas "leves".

### 9.5.5 Nota sobre stack de voz local/offline (fallback ao Gemini)

A pesquisa em comunidades de Home Assistant Voice (2026) mostra um consenso de stack para assistente de voz 100% local: **faster-whisper** (transcrição, 4-8x mais rápido que Whisper padrão) + **Piper** (que já usamos) + LLM local (Qwen3, GPT-OSS 20B, Gemma 4 26B). O ponto-chave de performance é fazer streaming em cada etapa — um build ingênuo fica em 3-5s de latência contra 400-700ms de assistentes comerciais.

Isso é relevante como **mitigação direta da limitação já documentada em §6** ("chave gratuita do Gemini tem limite de requisições por minuto"): um fallback local (Ollama + faster-whisper) quando a API do Gemini falha ou atinge rate limit, sem trocar toda a arquitetura.

---

Sources: [BBC/Meta glasses privacy](https://newsmeter.in/fact-check/viral-meta-ai-glasses-video-triggers-trolling-raises-broader-privacy-concerns-770049), [Omi (BasedHardware)](https://github.com/BasedHardware/omi), [VisionClaw](https://github.com/Intent-Lab/VisionClaw), [VisionClaw arxiv](https://arxiv.org/html/2604.03486v2), [OpenClaw voice](https://github.com/Purple-Horizons/openclaw-voice), [OpenSource-Ai-Glasses](https://github.com/Iam5tillLearning/OpenSource-Ai-Glasses), [Meta Live AI](https://www.meta.com/blog/ray-ban-meta-v11-software-update-live-ai-translation-shazam/), [openWakeWord](https://github.com/dscripka/openWakeWord), [microWakeWord / Home Assistant Voice](https://www.home-assistant.io/blog/2024/02/21/voice-chapter-6/), [Home Assistant local voice 2026](https://botmonster.com/smart-home/build-private-local-ai-voice-assistant-2026/), [Best AI wearable pendants 2026](https://www.layer3labs.io/guides/best-ai-wearable-pendants-2026), [Limitless pendant](https://www.aol.com/limitless-pendant-ai-device-wear-204536299.html)
