# 6. Referência de ações e configuração

## 6.1 Estrutura de um gesto

Cada entrada em `config.json > gestures` segue este formato:

```json
{
  "label": "Texto exibido no painel",
  "action": "tipo_de_acao",
  "params": { "...": "parametros especificos da acao" },
  "reliability": "high"
}
```

Chaves de gesto disponíveis: `button1_single`, `button1_double`, `button1_triple`, `button2_single`, `button2_double`, `button2_triple` (clique simples/duplo/triplo em cada um dos 2 botões).

## 6.2 Tipos de ação

### `run_command`

Executa um programa ou comando.

```json
{ "action": "run_command", "params": { "command": "notepad.exe", "args": [] } }
```

### `open_url`

Abre uma URL no navegador padrão.

```json
{ "action": "open_url", "params": { "url": "https://google.com" } }
```

### `key_shortcut`

Simula um atalho de teclado (usa a biblioteca `keyboard`).

```json
{ "action": "key_shortcut", "params": { "keys": "ctrl+shift+s" } }
```

### `screenshot`

Tira um print da tela inteira e salva como PNG.

```json
{ "action": "screenshot", "params": { "folder": "D:\\glasses_controller\\screenshots" } }
```

### `voice_command`

Grava áudio (duração fixa) e salva como `.wav`, sem processar com IA.

```json
{ "action": "voice_command", "params": { "duration_seconds": 4, "folder": "D:\\glasses_controller\\recordings" } }
```

### `jarvis_voice_agent`

Pipeline completo de assistente de voz: grava (com detecção de silêncio) → provedor de IA escolhido → Piper TTS → toca a resposta. Desde a v0.5 suporta múltiplos provedores gratuitos/open-source além do Gemini — ver `jarvis.py` (`PROVIDER_CHAT_URLS`, `PROVIDER_DEFAULT_MODELS`) e §10.16 de `10-app-android.md` para o equivalente no app Android.

| Parâmetro | Tipo | Descrição |
|---|---|---|
| `provider` | string | `gemini` (padrão), `groq`, `openrouter`, `mistral` ou `ollama` |
| `google_api_key` | string | Chave de API do Gemini (AI Studio) — só usada quando `provider=gemini` |
| `api_key` | string | Chave de API do provedor escolhido (Groq/OpenRouter/Mistral) — ignorado para `ollama` |
| `stt_api_key` | string | Chave da Groq usada para transcrever o áudio (Whisper) quando `provider` não é `gemini` — pode repetir a `api_key` se `provider=groq` |
| `ollama_host` | string | IP/host do Ollama quando `provider=ollama` (padrão `127.0.0.1`) |
| `model` | string | Nome do modelo — vazio usa o padrão de cada provedor (ver `PROVIDER_DEFAULT_MODELS`) |
| `system_prompt` | string | Instrução de sistema / personalidade do assistente |
| `tts_model` | string | Nome do arquivo `.onnx` do modelo de voz Piper (em `tts_models/`) |
| `max_duration_seconds` | number | Teto de segurança para a gravação |
| `silence_duration_seconds` | number | Quanto silêncio contínuo encerra a gravação |
| `silence_threshold` | number | Limiar de energia (RMS) para considerar "silêncio" |
| `conversation_mode` | boolean | Se `true`, ao disparar entra em loop contínuo (grava→responde→grava...) até um gesto `stop_conversation` ser acionado |
| `denoise` | boolean | Supressão de ruído (ver caixa abaixo) — padrão `true` |

**Supressão de ruído** (`jarvis.reduce_noise_pcm`, `noisereduce` — spectral gating): roda depois do VAD (`record_audio_vad` já decidiu onde a fala começa/termina), no clipe final, antes de mandar pro Whisper — melhora a transcrição em ambiente com ruído de fundo. Compartilhado pelas três ações de voz (`jarvis_voice_agent`, `open_jarvis_agent`, `translator_agent`), parâmetro `denoise` (padrão `true`) em cada uma. Clipes muito curtos (<0.25s) são devolvidos sem alteração — não há contexto suficiente pra estimar o perfil de ruído. **Só se aplica ao clipe já gravado** — não ao stream contínuo em tempo real da wake word (isso exigiria um denoiser desenhado pra streaming, tipo RNNoise/DeepFilterNet, não implementado). Import tem custo único de ~2-5s no processo do `server.py` (a lib carrega `matplotlib`/`scipy.signal` por baixo, mesmo sem usar plot nenhum) — só na primeira vez que qualquer uma dessas três ações roda depois do servidor subir; chamadas seguintes ficam em ~0.05s.

**Por que uma chave Groq extra (`stt_api_key`) pros provedores não-Gemini?** Só o Gemini aceita áudio diretamente. Os outros (Groq, OpenRouter, Mistral, Ollama) só recebem texto, então o áudio gravado precisa ser transcrito antes — isso usa o Whisper da Groq (grátis, rápido, e o próprio Whisper é open-source). Se `provider=groq`, a mesma chave serve pras duas coisas (transcrição + resposta), então `stt_api_key` pode ficar vazio.

### `open_jarvis_agent`

Agente inteligente unificado (ver `11-open-jarvis.md`) — grava, transcreve (Groq Whisper), pensa com Groq (`openai/gpt-oss-20b`) com function calling nativo (busca/navegador/visão de tela/notícias/dashboard/**trocar personalidade** como ferramentas de verdade, não tags de texto), fala a resposta com Piper. Diferente de `jarvis_voice_agent`, não é multi-provedor — usa sempre Groq como cérebro. Implementado em `smart_agent.py` + `browser_tools.py`.

O histórico de conversa (`smart_agent.conversations`) é mantido em memória por `session_id` — turnos seguintes já lembram o que foi dito antes, sem precisar repetir contexto.

**Personas**: a ferramenta `set_persona` troca o tom do assistente por voz ("vira o modo sério", "fica brincalhão", "modo professor", "volta ao normal"), sem mexer no painel — vale a partir do próximo turno daquela sessão. Personas disponíveis em `smart_agent.PERSONAS`: `padrao` (sarcástico/seco, default), `serio` (direto e formal), `brincalhao` (leve, com piadas), `professor` (didático, explica o raciocínio).

**Tradutor por voz**: a ferramenta `start_translator` chama `actions.translator_agent` (ver abaixo) a partir de dentro da própria conversa — diga "inicia tradução"/"traduz isso pra mim" e o Jarvis grava a próxima fala e responde já traduzida. Como o `translator_agent` fala a tradução sozinho (na voz do idioma certo), `process_turn` não fala em cima — não há resposta dupla.

| Parâmetro | Tipo | Descrição |
|---|---|---|
| `groq_api_key` | string | Chave de API da Groq (obrigatório) |
| `tavily_api_key` | string | Chave da Tavily, opcional — melhora a qualidade da busca geral (ver §11.3 de `11-open-jarvis.md`); sem ela, a busca cai pra Wikipedia/DuckDuckGo |
| `session_id` | string | Identificador do histórico de conversa (mantido em memória, por processo) |
| `user_name` | string | Nome usado pelo agente pra se dirigir ao usuário |
| `user_role` | string | Atividade/papel do usuário, injetado no system prompt |
| `tts_model` | string | Nome do arquivo `.onnx` do modelo de voz Piper |
| `max_duration_seconds`, `silence_duration_seconds`, `silence_threshold` | number | Mesmos parâmetros de VAD do `jarvis_voice_agent` |
| `require_speaker_match` | boolean | Se `true`, só processa o comando se a voz gravada bater com `voice_profile.npy` (ver §6.4) — usado pelo gesto `wake_word_command`, não pelo clique físico do botão |
| `speaker_match_threshold` | number | Limiar de similaridade de cosseno (0-1) pra considerar a voz reconhecida (padrão 0.75) |
| `denoise` | boolean | Supressão de ruído (ver caixa em `jarvis_voice_agent` acima) — padrão `true` |

Primeira chamada de cada `session_id` dispara automaticamente uma saudação ("Jarvis activate") antes de gravar a pergunta do usuário.

### `translator_agent`

Grava uma fala em qualquer idioma (Whisper com detecção automática — não força `pt` como o resto do app) e fala a tradução em voz alta. **Bidirecional** (desde 2026-08-08): fala em português sai traduzida em inglês (voz `en_US-lessac-medium`), fala em qualquer outro idioma sai traduzida em português (voz `pt_BR-faber-medium`) — a direção é decidida pelo idioma que o Whisper detectou (`response_format=verbose_json`), não por configuração fixa. Turno único, sem sessão/histórico — pensado pra "o que essa pessoa acabou de falar". Implementado em `actions.py`; mapeado por padrão em `button1_triple` e também chamável por voz via a ferramenta `start_translator` do `open_jarvis_agent` (ex: "Hey Jarvis, inicia tradução").

| Parâmetro | Tipo | Descrição |
|---|---|---|
| `groq_api_key` | string | Chave de API da Groq (obrigatório) |
| `pt_tts_model` | string | Voz Piper usada quando a tradução sai em português (padrão `pt_BR-faber-medium.onnx`) |
| `en_tts_model` | string | Voz Piper usada quando a tradução sai em inglês (padrão `en_US-lessac-medium.onnx`) |
| `max_duration_seconds`, `silence_duration_seconds`, `silence_threshold` | number | Mesmos parâmetros de VAD das outras ações de voz |
| `denoise` | boolean | Supressão de ruído (ver caixa em `jarvis_voice_agent` acima) — padrão `true` |

### `stop_conversation`

Encerra o modo conversacional ativo (ver `jarvis_voice_agent.conversation_mode`).

| Parâmetro | Tipo | Descrição |
|---|---|---|
| `farewell_text` | string | Frase falada ao encerrar (opcional — vazio = encerra em silêncio) |
| `tts_model` | string | Modelo de voz usado para a frase de despedida |

## 6.3 Ativação por voz (wake word, sem botão)

Alternativa ao clique físico: `passive_listener.py` já escutava o microfone continuamente pra detectar palma dupla (`clap_detection`) — agora também roda `openWakeWord` (100% local, offline, sem custo de API) no mesmo stream, escutando a palavra **"Hey Jarvis"** (modelo pré-treinado `hey_jarvis`, baixado via `setup_dev.py`/`openwakeword.utils.download_models()`). Configurado em `config.json > passive_listening.wake_word`:

```json
"wake_word": {
  "enabled": true,
  "model": "hey_jarvis",
  "threshold": 0.5,
  "gesture": "wake_word_command"
}
```

| Parâmetro | Descrição |
|---|---|
| `enabled` | Liga/desliga a detecção |
| `model` | Nome do modelo openWakeWord (`hey_jarvis` é o único baixado hoje — outros pré-treinados existem: `alexa`, `hey_mycroft`, `hey_rhasspy`) |
| `threshold` | Score mínimo (0-1) pra considerar detectado — 0.5 é o padrão recomendado pela biblioteca |
| `gesture` | Qual gesto disparar ao detectar — por padrão `wake_word_command`, uma cópia de `button1_single` com `require_speaker_match: true` (§6.4); pode apontar pra `button1_single` direto se não quiser a checagem de voz |

Ao detectar a palavra, dispara o gesto configurado — **não** existe uma wake word por funcionalidade (ex: uma frase própria só pra tradução): a palavra apenas abre o microfone, e o que é dito a seguir é roteado por tool-calling (`smart_agent.TOOLS`, incluindo `start_translator`). Treinar wake words customizadas por frase em português exigiria gerar dataset sintético e treinar modelo próprio — não foi feito, ficou de fora do escopo de hoje.

**Detecção por borda, não por nível**: uma vez que o score cruza o `threshold`, dispara uma vez só — não dispara de novo a cada frame (80ms) enquanto a pessoa ainda está terminando de falar "Jarvis". Só rearma depois do score cair abaixo do threshold.

**Isolado em subprocesso** (`wakeword_worker.py`): o openWakeWord roda em processo separado, não na thread do `passive_listener` — `onnxruntime` (usado por baixo) conflita em nível de DLL com `bleak`/WinRT quando carregados no mesmo processo, mesmo problema documentado pro Piper TTS (§4.8 de `04-arquitetura.md`). A primeira versão disto tentou só uma thread separada e derrubava a thread inteira do `passive_listener` na primeira detecção — corrigido isolando em processo, igual ao TTS.

**Só ativa depois do BLE conectar**: a detecção de wake word roda no mesmo `AudioCaptureManager` compartilhado com o microfone Bluetooth clássico dos óculos — se `/api/status` mostrar `"connected": false`, a wake word ainda não está ouvindo (nada pra ouvir: o mic dos óculos ainda não é o dispositivo de áudio ativo).

## 6.4 Reconhecimento de locutor (só responde à sua voz)

Complementa a wake word: por padrão, "Hey Jarvis" dispara pra **qualquer voz** (TV, outra pessoa, etc.) — reconhecimento de locutor restringe isso à sua voz especificamente. Não afeta o botão físico (pressionar o botão já é, por si só, uma ação intencional — a checagem só se aplica ao gesto `wake_word_command`).

**Cadastro** (`enroll_voice.py`, rodado manualmente pelo usuário — precisa de microfone real, não dá pra automatizar):

```bash
python enroll_voice.py
```

Grava 5 frases curtas, calcula um embedding de voz ([resemblyzer](https://github.com/resemble-ai/Resemblyzer), rede neural pré-treinada — mesma família de modelo que produtos como o "Consent Mode" do Limitless usam) e salva em `voice_profile.npy` (100% local, nunca sai da máquina — está no `.gitignore`, é dado biométrico pessoal). Sem esse arquivo, a checagem **falha aberta**: qualquer voz é aceita, exatamente o comportamento de antes.

**Isolado em subprocesso** (`speaker_verify_worker.py`), mesmo motivo do wake word: usa `torch` por baixo (via resemblyzer), biblioteca nativa pesada com o mesmo histórico de risco de conflito de DLL com `bleak`. `jarvis.verify_speaker(wav_bytes, threshold)` fala com esse processo por um protocolo de 1 linha JSON por comando/resposta (`{"cmd": "verify", "wav_b64": ..., "threshold": ...}`), o mesmo padrão do `tts_worker.py`.

**Peculiaridade deste ambiente (Python 3.14, muito recente)**: `resemblyzer` declara `webrtcvad` como dependência, mas esse pacote tem extensão C que não compila aqui (falta Visual Studio, sem wheel pré-compilada pra 3.14 ainda). Instalado com `pip install --no-deps resemblyzer` (via `setup_dev.py > ensure_speaker_recognition()`) porque só usamos `VoiceEncoder.embed_utterance()`, que não depende de VAD nenhum — a única função que de fato chamaria `webrtcvad.Vad()` (`trim_long_silences`) nunca é usada (o VAD real já é feito por `jarvis.record_audio_vad` antes do áudio chegar aqui). `speaker_verify_worker.py` injeta um módulo stub de `webrtcvad` só pra satisfazer o `import` — nunca é de fato exercitado.

**Custo de latência**: carregar o modelo (torch) custa ~12s, mas só uma vez — o worker fica vivo pelo resto da execução do servidor, igual ao `tts_worker.py`. Cada verificação depois disso leva ~0.2s.

| Parâmetro (na gesture, não no `voice_profile.npy`) | Descrição |
|---|---|
| `require_speaker_match` | Liga a checagem pra essa gesture específica (ver `open_jarvis_agent` §6.2) |
| `speaker_match_threshold` | Limiar de similaridade de cosseno pra considerar a mesma pessoa (padrão 0.75 — mais alto = mais rígido, mais chance de rejeitar sua própria voz num dia de garganta ruim) |

## 6.5 Endpoints HTTP/WebSocket (para integração externa)

| Rota | Método | Descrição |
|---|---|---|
| `/api/config` | GET | Retorna a configuração atual completa |
| `/api/config` | POST | Substitui a configuração (corpo = JSON completo) |
| `/api/actions_enabled` | POST | Liga/desliga execução real de ações (`{"enabled": true/false}`) |
| `/api/status` | GET | Status de conexão BLE e do dispositivo |
| `/api/test/{gesture_key}` | POST | Dispara manualmente um gesto configurado (para testes) |
| `/ws` | WebSocket | Stream ao vivo de eventos: `raw`, `filtered`, `gesture`, `action_result`, `status`, `conversation`, `actions_enabled` |

### Tipos de mensagem no WebSocket

| `type` | Campos | Quando ocorre |
|---|---|---|
| `status` | `connected`, `message` | Mudança de estado da conexão BLE |
| `raw` | `hex`, `time` | Qualquer notificação BLE recebida (antes de classificar) |
| `gesture` | `gesture`, `label`, `raw`, `time`, `note` | Um gesto configurado foi identificado e disparado |
| `action_result` | `gesture`, `ok`, `message`, `time` | Resultado da execução de uma ação |
| `conversation` | `status` (`started`/`ending`/`ended`) | Mudança de estado do modo conversacional |
| `actions_enabled` | `enabled` | O toggle de ações reais foi alterado |
