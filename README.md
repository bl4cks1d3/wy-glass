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
- **Botão 1 · clique duplo** → `open_jarvis_agent` em modo conversacional contínuo
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
