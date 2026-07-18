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
Botão físico (BLE notify) ──► server.py (FastAPI + Bleak)
                                    │
                      classifica: heartbeat? telemetria? clique real?
                                    │
                     conta cliques (simples/duplo/triplo) por botão
                                    │
                          dispara a ação configurada
                                    │
                    ┌───────────────┴────────────────┐
              ação simples                    modo conversacional
           (roda 1x em thread)          (loop: grava→pergunta→fala→repete
                                          até o botão de parar ser clicado)
```

### 3.1 Stack técnica

- **Python 3.14** + [`bleak`](https://github.com/hbldh/bleak) (BLE, multiplataforma — Windows/Linux/macOS)
- **FastAPI** + `uvicorn` + WebSocket (painel web + eventos ao vivo)
- **`sounddevice`** (gravação/reprodução via PortAudio — usa o áudio Bluetooth clássico já pareado como dispositivo padrão do Windows)
- **Google Gemini** (`generativelanguage.googleapis.com`, REST direto) — entende áudio nativamente, sem STT separado
- **Piper TTS** (offline, local, modelo neural `pt_BR-faber-medium` baixado do Hugging Face) — roda em subprocesso isolado para evitar conflito de DLL nativa com o resto do processo

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
| `jarvis_voice_agent` | **Pipeline completo**: grava (com VAD) → Gemini → Piper TTS → toca resposta |
| `stop_conversation` | Encerra o modo conversacional (com frase de despedida opcional) |

### 3.4 Mapeamento atual (v1)

- **Botão 1 · clique simples** → inicia o **Wy Glass** em modo conversacional (grava, pergunta ao Gemini, responde por voz, e volta a escutar automaticamente)
- **Botão 2 · clique simples** → encerra a conversa

### 3.5 Gravação inteligente (VAD)

Em vez de gravar por um tempo fixo, o Wy Glass grava por energia (RMS) do áudio: começa a contar silêncio só depois de detectar fala, e para automaticamente após ~1s de silêncio contínuo (configurável), com um teto de segurança de 15s.

### 3.6 Modo de execução

O servidor roda como processo oculto (`pythonw.exe`, sem janela de console), independente de qualquer aba de navegador aberta. Reinício manual via `start_hidden.vbs`.

---

## 4. O que já é possível fazer com os óculos hoje

- Conversar com uma IA (Gemini) por voz, sem tocar no celular, usando só o botão físico
- Qualquer clique do botão pode disparar **qualquer ação de PC**: abrir programas, tirar screenshot, simular atalhos, abrir sites
- Clique simples/duplo/triplo em cada um dos 2 botões = até **6 gestos independentes** configuráveis
- Modo conversacional contínuo (liga com um botão, desliga com o outro)
- Painel web para reconfigurar tudo sem mexer em código
- Modo de teste seguro (ações reais desligadas) para explorar sem efeitos colaterais

## 5. Possibilidades futuras (ainda não implementadas)

- **Palavra de ativação (wake word)**: hoje o gatilho é sempre o botão físico. Daria para adicionar detecção de palavra de ativação (ex: bibliotecas como `openWakeWord` ou `Porcupine`) escutando continuamente o microfone Bluetooth, eliminando a necessidade do clique.
- **Múltiplos agentes/modelos**: a arquitetura de `actions.py` já é plugável — dá para adicionar outros backends de IA (OpenAI, Claude, modelos locais via Ollama) como novos tipos de ação, ou até deixar configurável qual "agente" cada botão chama.
- **Versão Linux**: toda a stack (Bleak, sounddevice, Piper, FastAPI) já é multiplataforma — a base do trabalho é testar/empacotar no Linux (BlueZ), não reescrever.
- **Open source**: o projeto é 100% código nosso (nenhuma dependência do APK/firmware do fabricante além do protocolo BLE documentado aqui) — pronto para publicar.

## 6. Limitações conhecidas

- O chip BLE aceita **apenas uma conexão de controle por vez** — o app oficial do celular e o Wy Glass não podem controlar os óculos ao mesmo tempo.
- A chave gratuita do Gemini (AI Studio) tem limite de requisições por minuto; o Wy Glass já trata isso com retry automático, mas uso muito intenso pode esbarrar no limite.
- O clique do botão também aciona AVRCP nativo do Windows (play/pause de mídia) — efeito colateral do próprio hardware, não é algo que controlamos por software.

---

*Wy Glass v1 — projeto pessoal de hardware hacking.*
