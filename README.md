# Wy Glass

Óculos inteligentes genéricos (revenda "Microwear W AI 4") reprogramados via engenharia reversa de Bluetooth Low Energy, para funcionar como um assistente de IA por voz conectado diretamente ao PC — sem depender do app oficial do fabricante.

📚 **Estudo técnico completo, com metodologia de engenharia reversa passo a passo, arquitetura detalhada e roteiro futuro: [`docs/00-indice.md`](docs/00-indice.md)**

---

## 1. O hardware

| Item | Valor |
|---|---|
| Nome comercial | Microwear W AI 4 |
| Nome interno do firmware | `LNJ-W03` (versão `0.2.6`) |
| App oficial (não utilizado por nós) | MActive Pro (`com.njj.mactivepro`) — app genérico do fabricante, reaproveitado de outros produtos (inclusive navegação veicular) |
| Chipset Bluetooth | Baseado em Jieli (evidenciado por bibliotecas `libjl_opus.so` / `libjl_speex.so` no APK) |
| Conectividade | Bluetooth 5.3 — **dual**: BLE (controle) + Bluetooth clássico A2DP/HFP (áudio) |
| Botões físicos | 2 — "Frente" (perto da lente) e "Trás" (haste) |
| Câmera | Não — esta unidade não tem câmera, só lanterna (o manual do fabricante menciona gravação de foto/vídeo, mas isso não se aplica a este hardware) |
| Áudio | Alto-falante open-ear + microfone, via perfil clássico A2DP/HFP |

### 1.1 Tabela de funções dos botões (manual oficial do fabricante)

**Botão da Frente:**

| Função | Gesto |
|---|---|
| Ligar/Desligar | Toque curto |
| Atender/encerrar chamada | Clique |
| Próxima música | Clique duplo |
| **Despertar assistente de IA** | **Clique simples** |
| Gravação (foto/vídeo) — do manual, não se aplica (sem câmera nesta unidade) | Segurar 2s |

**Botão de Trás:**

| Função | Gesto |
|---|---|
| Lanterna | Segurar (liga/desliga) |
| Atender chamada | Clique |
| Play/pause música | Clique |
| Música anterior | Clique duplo |

> Achado importante: o gatilho oficial do assistente de IA é um **clique simples**, não uma pressão longa como presumimos no início do projeto. Isso bate exatamente com o sinal confiável que decodificamos por engenharia reversa (ver §2).

---

## 2. Protocolo BLE (engenharia reversa)

Capturado via `btsnoop_hci.log` do Android e confirmado ao vivo conectando direto do PC com [`bleak`](https://github.com/hbldh/bleak).

- **Endereço BLE** (desta unidade): `53:88:97:31:A5:3A`
- **Serviço vendor**: `000001ff-3c17-d293-8e48-14fe2e4da212`
- **Characteristic de escrita** (PC → óculos): `0000ff02-0000-1000-8000-00805f9b34fb` (write-without-response)
- **Characteristic de notificação** (óculos → PC): `0000ff03-0000-1000-8000-00805f9b34fb` (notify)

Todo pacote começa com o byte mágico `0xBC`.

| Padrão (hex) | Significado |
|---|---|
| `bc 03 03 01 01 01` | **Clique no botão 1 (Frente)** — sinal confiável, 100% reprodutível |
| `bc 03 03 01 02 02` | **Clique no botão 2 (Trás)** — mesmo formato, identificador do botão no 5º/6º byte |
| `bc 07 03 01 XX XX` | Heartbeat/status periódico automático (~60s) — **não é clique**, ignorar |
| `bc 09 03 ...` | Telemetria interna (contadores crescentes, provável uso/bateria) — **não é clique** |
| `bc 01 03 ...` | Resposta de info do dispositivo (contém string tipo `LNJ-W03-0.2.6`) |

### Armadilhas que já caímos (documentadas para não repetir)

- O canal `bc07` (heartbeat) tem o **mesmo formato genérico** de um evento de clique e por um bom tempo foi confundido com clique real — causava "cliques fantasma" a cada ~60s.
- O sinal `bc0303` foi inicialmente interpretado como "iniciar modo de voz por pressão longa", mas na verdade é simplesmente **o evento de clique do botão**, com o botão identificado pelo próprio payload (01 = frente, 02 = trás) — não existe distinção de duração de pressão no protocolo.
- O botão físico também aciona **AVRCP nativo** (play/pause de mídia) via Bluetooth clássico, em paralelo e independente do canal BLE — por isso um clique no botão 2 também pausa/toca qualquer mídia tocando no Windows.

---

## 3. Arquitetura do Wy Glass

```
Botão físico (BLE notify)  ──┐
Wake word "Hey Jarvis"       ├──► server.py (FastAPI + Bleak)
(mic compartilhado)        ──┘         │
                          classifica: heartbeat? telemetria? clique real? wake word?
                                        │
                       conta cliques (simples/duplo/triplo) por botão
                                        │
                              dispara a ação configurada
                                        │
                      ┌─────────────────┴──────────────────┐
                ação simples                        modo conversacional
             (roda 1x em thread)              (loop: grava→pergunta→fala→repete
                                                até o botão de parar ser clicado)
                                        │
                          tool-calling decide o que fazer:
              search · open_url · see_screen · take_screenshot · get_news ·
              open_dashboard · set_persona · start_translator · end_conversation
```

### 3.1 Stack técnica

- **Python 3.14** + [`bleak`](https://github.com/hbldh/bleak) (BLE, multiplataforma — Windows/Linux/macOS)
- **FastAPI** + `uvicorn` + WebSocket (painel web + eventos ao vivo)
- **`sounddevice`** (gravação/reprodução via PortAudio — usa o áudio Bluetooth clássico já pareado como dispositivo padrão do Windows)
- **Groq** (`openai/gpt-oss-20b`, function calling nativo) — cérebro padrão do assistente unificado, com Whisper da Groq pra transcrição; **Google Gemini** continua disponível como pipeline alternativo multi-provedor (`jarvis_voice_agent`)
- **Piper TTS** (offline, local, modelos neurais `pt_BR-faber-medium` e `en_US-lessac-medium`, baixados do Hugging Face) — roda em **processo persistente** (`tts_worker.py`), isolado do processo principal por conflito de DLL com `bleak`/WinRT (ver `docs/04-arquitetura.md` §4.8)
- **openWakeWord** (100% local/offline) — detecção da palavra de ativação "Hey Jarvis", também em processo persistente (`wakeword_worker.py`), mesmo motivo de isolamento
- **resemblyzer** — reconhecimento de locutor opcional (só responde à sua voz), processo persistente (`speaker_verify_worker.py`)
- **noisereduce** — supressão de ruído (spectral gating) na gravação, antes da transcrição

### 3.2 Páginas do painel

| Rota | Função |
|---|---|
| `/` | Landing page de apresentação do projeto (v1) |
| `/deck` | Painel de controle — mapeia gestos → ações, liga/desliga execução real |
| `/test` | Painel de diagnóstico — feed bruto do BLE classificado ao vivo, contador por tipo, marcação manual |

### 3.3 Tipos de ação disponíveis hoje

| Ação | O que faz |
|---|---|
| `run_command` | Executa um programa/comando qualquer |
| `open_url` | Abre uma URL no navegador padrão |
| `key_shortcut` | Simula um atalho de teclado |
| `screenshot` | Tira print da tela e salva em arquivo |
| `voice_command` | Grava áudio e salva em `.wav` (sem IA) |
| `jarvis_voice_agent` | Pipeline multi-provedor (Gemini/Groq/OpenRouter/Mistral/Ollama) — alternativa ao agente unificado, um turno sem tools |
| `open_jarvis_agent` | **Agente unificado (padrão)**: grava → Groq Whisper → Groq com tool-calling (busca, abrir URL, ver/tirar print de tela, notícias, abrir dashboard, trocar personalidade, iniciar tradutor, encerrar conversa) → fala a resposta com Piper. Memória de conversa entre turnos. |
| `translator_agent` | Grava fala em qualquer idioma, traduz e fala em voz alta — bidirecional (PT↔EN), direção decidida automaticamente pelo idioma detectado |
| `stop_conversation` | Encerra o modo conversacional (com frase de despedida opcional) |
| `open_dashboard` | Abre o painel de controle |

Detalhes de parâmetros de cada ação: [`docs/06-referencia-acoes.md`](docs/06-referencia-acoes.md).

### 3.4 Mapeamento atual

- **Botão 1 · clique simples** → `open_jarvis_agent` (um turno)
- **Botão 1 · clique duplo** → `live_agent` — liga/desliga o **modo Live** (voz realtime, §3.8). O mapeamento antigo (modo conversa clássico) fica guardado em `config.json > gestures_disabled`
- **Botão 1 · clique triplo** → `translator_agent`
- **Botão 2 · clique simples** → encerra a conversa
- **Botão 2 · clique duplo** → abre o dashboard
- **Wake word "Hey Jarvis"** → mesmo fluxo do botão 1 clique simples, com verificação opcional de locutor (ver §3.7)

### 3.5 Gravação inteligente (VAD) e supressão de ruído

Em vez de gravar por um tempo fixo, o Wy Glass grava por energia (RMS) do áudio: começa a contar silêncio só depois de detectar fala, e para automaticamente após ~1s de silêncio contínuo (configurável), com um teto de segurança de 15s. Depois de gravado, o clipe passa por supressão de ruído (`noisereduce`, spectral gating) antes de ir pro Whisper — melhora a transcrição em ambiente com ruído de fundo.

### 3.6 Modo de execução

O servidor roda como processo oculto (`pythonw.exe`, sem janela de console), independente de qualquer aba de navegador aberta. Reinício manual via `start_hidden.vbs`.

### 3.7 Ativação por voz e reconhecimento de locutor

Além do botão físico, é possível ativar o assistente dizendo **"Hey Jarvis"** — detecção 100% local via `openWakeWord`, sem custo de API enquanto a palavra não é dita. Opcionalmente, dá pra restringir isso à sua voz especificamente (`python enroll_voice.py` cadastra um perfil local, `voice_profile.npy`, nunca enviado a lugar nenhum) — sem cadastro, qualquer voz aciona a wake word normalmente. O botão físico nunca passa por essa checagem (pressionar o botão já é, por si só, intencional). Detalhes: `docs/06-referencia-acoes.md` §6.3-6.4.

### 3.8 Modo Live — voz realtime, agentes e interface orbital

```
mic dos óculos ──stream PCM 16k──► Gemini Live (gemini-3.8-live, speech-to-speech)
                                       │  barge-in · transcrição ao vivo · tool calling
alto-falante ◄──stream PCM 24k─────────┤
                                       ├─► skills/ + MCP (mesmas tools do agente clássico)
                                       └─► delegate_task ─┬─► Pesquisador / Operador / Generalista
                                                          │     (smart_agent.run_agent_task via 9router · OmniRoute · Groq)
                                                          └─► Claude (Claude Code CLI headless, assinatura)
```

- **`live_agent.py`** — sessão full-duplex com a Gemini Live API em thread/event loop próprios (mesmo isolamento do `mcp_client.py`). Gate anti-eco pros óculos open-ear: enquanto o modelo fala, só passa áudio do mic acima de `live.barge_in_rms`. Renova a sessão sozinho (`session_resumption` + `context_window_compression`).
- **Agentes** — o modelo de voz delega tarefas de vários passos via `delegate_task`. Os agentes de texto rodam pelo gateway configurado; o agente **Claude** chama `claude -p` com o login da sua assinatura (`claude_code_agent.py`; `ANTHROPIC_API_KEY` é removida do ambiente pra não cair na cobrança por API). Por padrão só ferramentas de leitura + web (`claude_code.allowed_tools`).
- **9router** — gateway OpenAI-compatible local (`npm i -g 9router && 9router`, dashboard em `localhost:20128`). Ligue em `config.json > nine_router.enabled` e escolha o `model` (combo ou `provedor/modelo` do dashboard). Tem precedência sobre o OmniRoute (mesma porta). Saúde em `GET /api/gateway/health`. Não use o provedor "Claude Code" OAuth do 9router: rotear o token da assinatura por proxy de terceiro viola os termos; pra Claude, use o agente Claude acima.
- **Interface `/orb`** — orbe estilo Siri/visionOS que reage ao nível do mic (ouvindo) e da voz (falando), anéis orbitais 3D com os agentes/tools como satélites que acendem quando trabalham, legendas ao vivo e feed de atividade. Espaço liga/desliga. Abre como janela de app pelo ícone da bandeja (**Abrir Wy Glass Live**).

| Endpoint | Função |
|---|---|
| `GET /orb` | Interface Live |
| `GET /api/live` | Estado, modelo, voz, gateway, agentes disponíveis |
| `POST /api/live/start` · `/api/live/stop` | Liga/desliga a sessão |
| `GET /api/gateway/health` | Testa 9router/OmniRoute listando modelos |

- **Modo pausa** — "espera um minutinho" (ou qualquer frase de `live.pause_phrases`, ou um pedido livre que o modelo entende e atende com a tool `pausar_conversa`, ou o **botão 1** dos óculos, ou o botão ⏸ do orb) coloca o Live em espera: o microfone para de ir pro Gemini e passa a alimentar só o [wake_spotter.py](wake_spotter.py), reconhecimento **100% local** (Vosk, `models/vosk-model-small-pt-0.3`). A conversa volta ao ouvir qualquer frase de `live.wake_phrases` ("e aí óculos", "hey jarvis", "pode continuar"…), com som de saída/entrada nos óculos. Nomes fora do vocabulário do modelo ("sankofa") funcionam depois de **calibrar com a sua voz** (Ajustes → Voz Live → Calibrar: o jeito que o Vosk te ouve vira apelido em `live.wake_aliases`). Pausa acima de `live.pause_timeout_min` (30) encerra o Live. Testado ponta a ponta com o Gemini e mic simulado: a conversa durante a pausa não gerou nenhuma transcrição no Gemini.
- **Painéis estruturados** ([orb-cards.js](static/orb-cards.js)) — o resultado das ferramentas de dados abre um painel ao lado do orbe (folha inferior no celular), com renderizador por fonte: Current Brain (contexto com métricas, lacunas e mapa de conhecimento; GitHub em alta; conteúdo por prioridade; marcos por tecnologia), Planner Life (coleções, registros em tabela, automações), Brain Office (Hoje, agentes, mural, respostas dos setores) e `ler_dados_da_vida`; o resto cai num renderizador genérico de JSON. A tool `mostrar_na_tela` deixa o agente montar o próprio painel (`lista`, `tabela`, `metricas`, `linha_do_tempo`, `passos`, `texto`) e falar só o resumo. Histórico navegável dos últimos 30 painéis. A voz recebe só as tools da allowlist de cada MCP; o agente Cérebro recebe todas, menos as `delete_*`.
- **Painel de ajustes** (botão de controles no dock ou `Ctrl+,`) — estilo Ajustes do macOS, autosave em `config.json` via `POST /api/config`: Perfil, Voz Live, Agentes (9router com teste de conexão, Claude Code, OmniRoute), Gestos (ação, parâmetros JSON, testar), Ferramentas (liga/desliga cada skill/MCP), Óculos (status BLE, reconectar, ações reais, bateria, escuta passiva) e Chaves de API.
- **Perfil** — `config.json > user_profile` (`user_name`, `user_role`, `user_context`) é a fonte única do perfil, injetado em toda ação e no Live (antes ficava repetido nos params de cada gesto). Persona padrão: **parceiro técnico**; o Jarvis sarcástico clássico virou a persona `mordomo` ("modo mordomo").

- **Brain Office** — `config.json > brain_office` aponta pro monorepo `brain-agents` (código em `services/`, dados em `data/`). A skill `ler_dados_da_vida` é a porta da ferramenta `mcp__escritorio__ler_dados_da_vida` do Brain Office: lê `planner.db` e `brain.db` direto, somente leitura, e funciona com o Brain Office e o Planner Core desligados. A ponte com o escritório em si é a skill `escritorio` ([brain_office.py](brain_office.py)), que fala com a API REST do painel (`/api/brain/*`, porta 3456 do `npm run office`, token de `~/.pixel-agents/brain/token`): `ligar` (sobe o escritório, que sobe o Planner Core), `status`, `perguntar` (com setor ou pela recepção, que escolhe o setor; espera a resposta do agente até ~2,5 min), `ultima_resposta`, `hoje`, `mural`, `lembrete`/`lembretes`/`cancelar_lembrete`, `pendencias`/`aprovar`/`negar` (pedidos de permissão dos agentes, só com o sim falado) e `brief`. O agente **Cérebro** recebe `escritorio` + `ler_dados_da_vida` + os MCPs.
- **MCPs do ecossistema brain** — `config.json > mcp_servers` conecta o **current-brain** (rodando de `brain-agents/services/brain` com o banco `data/brain/brain.db`, o mesmo do Brain Office) e o **planner-life** (de `brain-agents/services/planner`, mesmo caminho do Claude global). Cada servidor declara `tools` (allowlist): o brain expõe 45 tools, o modelo de voz recebe só 13 (contexto, busca, metas, links, repos, criadores); o planner, 5 (sem exclusões por voz). Pro resto, o Jarvis delega ao agente **Cérebro**. Campos por servidor: `command`, `args`, `env`, `cwd`, `tools`, `exclude_tools`, `connect_timeout`. Painel → Servidores MCP liga/desliga servidor e tool e reconecta (`GET /api/mcp`, `POST /api/mcp/reconnect`). O planner-life precisa do Planner Core rodando em `:4000` (`pnpm dev:core`).

- **Controle do PC** ([pc_control.py](pc_control.py) + `skills/pc_*.py`) — `pc_apps` (abrir/fechar/focar/listar; resolve apelidos, protocolos `spotify:`/`whatsapp:` e atalhos do Menu Iniciar), `pc_window` (minimizar, maximizar, encaixar, área de trabalho), `pc_keyboard` (digitar com acentos, atalhos, clipboard), `pc_media` (play/pause, faixas, volume exato via pycaw), `pc_click` (clique por descrição: print → Gemini aponta o elemento em coordenada 0-1000 → pyautogui clica; `gemini-3.5-flash-lite` sem raciocínio, ~4s, com fallback) e `pc_system` (bloquear, status; desligar/reiniciar/suspender só com `confirmed=true` depois do sim falado, e desligar espera 30s cancelável). Fechar app manda `WM_CLOSE`, nunca mata processo. O agente **Operador** recebe todas as `pc_*` para sequências longas.

Config (`config.json`): `user_profile`, `mcp_servers`, `live` (`model`, `voice`, `barge_in_rms`, `silence_ms`), `nine_router` (`enabled`, `base_url`, `api_key`, `model`), `claude_code` (`enabled`, `exe`, `cwd`, `allowed_tools`, `permission_mode`, `model`, `timeout_seconds`).

---

## 4. O que já é possível fazer com os óculos hoje

- Conversar com uma IA (Groq, com fallback multi-provedor) por voz, sem tocar no celular — usando o botão físico **ou** a palavra de ativação "Hey Jarvis"
- Tool-calling de verdade: pesquisar, abrir sites, ver/tirar print da tela, notícias, abrir o dashboard, trocar a personalidade do assistente e iniciar o tradutor — tudo por linguagem natural, sem tags de ação
- Memória de conversa entre turnos (dentro da mesma sessão)
- Personas trocáveis por voz (`padrao`, `serio`, `brincalhao`, `professor`)
- Tradução em tempo real, bidirecional (PT↔EN), por botão ou por voz ("Hey Jarvis, inicia tradução")
- Reconhecimento de locutor opcional — a wake word pode responder só à sua voz
- Supressão de ruído automática na gravação, antes da transcrição
- Qualquer clique do botão pode disparar **qualquer ação de PC**: abrir programas, tirar screenshot, simular atalhos, abrir sites
- Clique simples/duplo/triplo em cada um dos 2 botões = até **6 gestos independentes** configuráveis
- Modo conversacional contínuo (liga com um botão, desliga com o outro)
- Painel web para reconfigurar tudo sem mexer em código
- Modo de teste seguro (ações reais desligadas) para explorar sem efeitos colaterais

## 5. Possibilidades futuras (ainda não implementadas)

- **Wake words customizadas por frase/idioma**: hoje só existe uma wake word ("Hey Jarvis", modelo pré-treinado do openWakeWord) — treinar frases próprias em português exigiria gerar dataset sintético e treinar modelo próprio.
- **Tradução PT→outro idioma além de inglês**: bidirecional hoje é só PT↔EN (única voz Piper adicional instalada) — outros idiomas exigiriam baixar mais vozes.
- **Supressão de ruído em tempo real no stream da wake word**: hoje a supressão só roda no clipe já gravado (depois do VAD), não no áudio contínuo escutado pela wake word — exigiria um denoiser desenhado pra streaming (RNNoise, DeepFilterNet).
- **Versão Linux**: toda a stack (Bleak, sounddevice, Piper, FastAPI, openWakeWord, resemblyzer) já é multiplataforma — a base do trabalho é testar/empacotar no Linux (BlueZ), não reescrever.
- **Open source**: o projeto é 100% código nosso (nenhuma dependência do APK/firmware do fabricante além do protocolo BLE documentado aqui) — pronto para publicar.

## 6. Limitações conhecidas

- O chip BLE aceita **apenas uma conexão de controle por vez** — o app oficial do celular e o Wy Glass não podem controlar os óculos ao mesmo tempo.
- As chaves gratuitas (Groq, Gemini) têm limite de requisições por minuto; o Wy Glass já trata isso com retry automático, mas uso muito intenso pode esbarrar no limite.
- O clique do botão também aciona AVRCP nativo do Windows (play/pause de mídia) — efeito colateral do próprio hardware, não é algo que controlamos por software.
- A wake word e o reconhecimento de locutor só ficam ativos depois que o Bluetooth conecta de verdade (dependem do microfone dos óculos como dispositivo de áudio) — se o rádio Bluetooth do PC estiver desligado, nada disso funciona até reconectar.
- Ambiente de desenvolvimento roda em Python 3.14 (recente) — algumas dependências de reconhecimento de locutor (`webrtcvad`, transitiva do `resemblyzer`) não têm wheel pré-compilada ainda nessa versão; contornado com instalação `--no-deps` + stub (ver `docs/06-referencia-acoes.md` §6.4).

---

*Wy Glass — projeto pessoal de hardware hacking.*
