# 5. Guia de instalação e configuração

## 5.1 Pré-requisitos

- Windows 10/11 (o projeto usa `pythonw.exe` e um script `.vbs` para rodar oculto — em Linux/macOS o equivalente seria um serviço `systemd`/`launchd`, ver [07-roteiro-futuro.md](07-roteiro-futuro.md))
- Python 3.10+
- Óculos já pareados no Windows como dispositivo de áudio Bluetooth clássico (`Configurações > Bluetooth e dispositivos > Adicionar dispositivo`)
- Uma chave de API do Google Gemini (gratuita em [aistudio.google.com/apikey](https://aistudio.google.com/apikey))

## 5.2 Dependências Python

```bash
pip install bleak fastapi uvicorn websockets python-multipart
pip install sounddevice numpy pillow keyboard
pip install requests
pip install piper-tts
```

## 5.3 Baixar um modelo de voz (Piper / Hugging Face)

```bash
mkdir tts_models
cd tts_models
curl -sL -o pt_BR-faber-medium.onnx \
  "https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx"
curl -sL -o pt_BR-faber-medium.onnx.json \
  "https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx.json"
```

Outras vozes em português (e outros idiomas) disponíveis em [huggingface.co/rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices).

## 5.4 Descobrir o endereço BLE do seu dispositivo

Se for uma unidade diferente da documentada aqui, descubra o endereço:

```python
import asyncio
from bleak import BleakScanner

async def scan():
    devices = await BleakScanner.discover(timeout=10.0)
    for d in devices:
        print(d.address, d.name)

asyncio.run(scan())
```

Procure pelo nome anunciado pelo dispositivo (ex: `W AI 4`) e copie o endereço para `config.json`.

> Se o dispositivo já estiver conectado ao celular via BLE, ele para de anunciar e não aparece no scan — desligue o Bluetooth do celular (ou feche o app oficial) antes de escanear.

## 5.5 Configurar `config.json`

Copie `config.example.json` para `config.json` (este último está no `.gitignore` — nunca é versionado, porque carrega chaves de API em texto puro) e preencha os campos:

```json
{
  "device_address": "SEU:ENDERECO:AQUI",
  "device_name": "Wy Glass",
  "notify_char_uuid": "0000ff03-0000-1000-8000-00805f9b34fb",
  "actions_enabled": true,
  "gestures": {
    "button1_single": {
      "label": "Botão 1 · Despertar Wy Glass",
      "action": "jarvis_voice_agent",
      "params": {
        "google_api_key": "SUA_CHAVE_AQUI",
        "model": "gemini-2.5-flash",
        "max_duration_seconds": 15,
        "silence_duration_seconds": 1,
        "silence_threshold": 300,
        "system_prompt": "Voce e um assistente de voz util...",
        "tts_model": "pt_BR-faber-medium.onnx",
        "conversation_mode": true
      },
      "reliability": "high"
    },
    "button2_single": {
      "label": "Botão 2 · Encerrar conversa",
      "action": "stop_conversation",
      "params": {
        "farewell_text": "Até mais!",
        "tts_model": "pt_BR-faber-medium.onnx"
      },
      "reliability": "high"
    }
  }
}
```

Ver [06-referencia-acoes.md](06-referencia-acoes.md) para todos os tipos de ação e parâmetros disponíveis.

## 5.6 Rodar o servidor

**Em primeiro plano (para testar/depurar):**

```bash
python server.py
```

**Em segundo plano, sem janela de console (Windows):**

```bash
cscript //nologo start_hidden.vbs
```

O servidor sobe em `http://127.0.0.1:8731`:

- `/` — página de apresentação
- `/deck` — painel de controle (configurar gestos, ligar/desligar ações reais)
- `/test` — painel de diagnóstico (feed bruto do BLE)

## 5.7 Modo de teste seguro

Por padrão, recomenda-se deixar `actions_enabled: false` (ou desligar pelo toggle "Ações reais" no painel) ao configurar algo novo — isso permite ver a classificação dos eventos e testar gestos sem disparar ações de verdade, evitando surpresas (programas abrindo sozinhos, etc.) enquanto se ajusta a configuração.
