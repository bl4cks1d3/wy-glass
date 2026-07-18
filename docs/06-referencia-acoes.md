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

**Por que uma chave Groq extra (`stt_api_key`) pros provedores não-Gemini?** Só o Gemini aceita áudio diretamente. Os outros (Groq, OpenRouter, Mistral, Ollama) só recebem texto, então o áudio gravado precisa ser transcrito antes — isso usa o Whisper da Groq (grátis, rápido, e o próprio Whisper é open-source). Se `provider=groq`, a mesma chave serve pras duas coisas (transcrição + resposta), então `stt_api_key` pode ficar vazio.

### `stop_conversation`

Encerra o modo conversacional ativo (ver `jarvis_voice_agent.conversation_mode`).

| Parâmetro | Tipo | Descrição |
|---|---|---|
| `farewell_text` | string | Frase falada ao encerrar (opcional — vazio = encerra em silêncio) |
| `tts_model` | string | Modelo de voz usado para a frase de despedida |

## 6.3 Endpoints HTTP/WebSocket (para integração externa)

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
