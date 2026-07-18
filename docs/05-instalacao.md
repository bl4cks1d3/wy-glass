# 5. Guia de instalação e configuração

## 5.1 Pré-requisitos

- Windows 10/11 (o projeto usa `pythonw.exe` e um script `.vbs` para rodar oculto — em Linux/macOS o equivalente seria um serviço `systemd`/`launchd`, ver [07-roteiro-futuro.md](07-roteiro-futuro.md))
- Python 3.10+
- Óculos já pareados no Windows como dispositivo de áudio Bluetooth clássico (`Configurações > Bluetooth e dispositivos > Adicionar dispositivo`)
- Uma chave de API do Google Gemini (gratuita em [aistudio.google.com/apikey](https://aistudio.google.com/apikey))

## 5.2 Dependências Python

**Forma recomendada — script de setup**, que instala tudo, valida que cada pacote realmente importa (não só que o `pip` disse "Successfully installed"), baixa o modelo de voz Piper se faltar, e cria o `config.json` se ainda não existir:

```bash
python setup_dev.py
```

Rode `python setup_dev.py --check` a qualquer momento pra só ver o status (sem instalar/baixar nada) — útil pra conferir o que falta sem repetir uma instalação já feita. Ambos os modos são idempotentes: rodar de novo com tudo já instalado não reinstala nada, só confirma.

O que ele cobre, na ordem: versão do Python (mínimo 3.10), os pacotes de `requirements.txt`, o navegador Chromium do Playwright (usado pelo `open_jarvis_agent` — busca/navegador/notícias, ver `11-open-jarvis.md`), o modelo de voz Piper (§5.3) e o `config.json` (§5.5, copiado de `config.example.json` na primeira vez — ainda precisa preencher endereço BLE e chaves de API manualmente depois). Não cobre o lado Android (SDK/Gradle/JDK) — isso é `docs/10-app-android.md` §10.20.

**Instalação manual** (equivalente ao que o script faz, se preferir rodar passo a passo ou não puder rodar o script):

```bash
pip install -r requirements.txt
playwright install chromium
```

`playwright` e `beautifulsoup4` (dentro de `requirements.txt`) são usados só pelo `open_jarvis_agent`. `pyinstaller` só é necessário pra gerar os executáveis (§5.9) — não é preciso pra rodar o servidor via `python server.py`.

**Se aparecer `ModuleNotFoundError` mesmo depois de instalar**: confirme que está usando o mesmo Python que o `pip install` usou (`python --version` vs o Python apontado por `pip --version`) — numa máquina com mais de uma instalação do Python (ex: uma pelo instalador oficial, outra pela Microsoft Store), é fácil instalar num interpretador e rodar `server.py` com outro. Todo o desenvolvimento deste projeto foi feito com o Python instalado em `%LOCALAPPDATA%\Programs\Python\Python3XX\python.exe` (`py -0p` lista todas as instalações encontradas no sistema) — `setup_dev.py` sempre usa o mesmo interpretador com que foi chamado (`sys.executable`), então rodá-lo já evita essa armadilha.

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

**No dia a dia**: use os atalhos "Wy Glass - Servidor" / "Wy Glass - Dashboard" (área de trabalho) — o Dashboard sobe o servidor sozinho se ele ainda não estiver rodando, não precisa abrir os dois manualmente. Ver `12-guia-de-uso.md` §12.1 para o fluxo completo do dia a dia (botões físicos, comandos de voz, abas do Dashboard).

**Em primeiro plano, direto do source (para testar/depurar)**:

```bash
python server.py
```

**Em segundo plano, sem janela de console (Windows), direto do source:**

```bash
cscript //nologo start_hidden.vbs
```

O servidor sobe em `http://127.0.0.1:8731`:

- `/` — página de apresentação
- `/deck` — painel de controle web legado (configurar gestos, ligar/desligar ações reais) — o Dashboard nativo (Tkinter, `dashboard.py`) é a forma recomendada hoje, mas essa rota continua funcionando
- `/test` — painel de diagnóstico (feed bruto do BLE)
- `/api/status` — JSON com `connected`, `device_address`, `actions_enabled` e `app_version` (§5.8)

## 5.7 Modo de teste seguro

Por padrão, recomenda-se deixar `actions_enabled: false` (ou desligar pelo toggle "Ações reais" no painel) ao configurar algo novo — isso permite ver a classificação dos eventos e testar gestos sem disparar ações de verdade, evitando surpresas (programas abrindo sozinhos, etc.) enquanto se ajusta a configuração.

## 5.8 Conectar aos óculos com um clique

A aba STATUS do Dashboard tem um botão **CONECTAR** (vira **RECONECTAR** assim que a conexão sobe) no painel "DISPOSITIVO" — chama `POST /api/reconnect`, que derruba o cliente BLE atual (se houver) e reinicia o loop de conexão imediatamente, em vez de esperar o próprio backoff automático do `ble_manager()`. Serve pra dois casos:

1. **Forçar uma tentativa imediata** — o servidor já reconecta sozinho em loop infinito (não é preciso reiniciar nada se os óculos caírem), mas esse botão pula a espera do próximo ciclo automático.
2. **Retomar a conexão do celular** — o chip BLE dos óculos só aceita um central por vez (ver `10-app-android.md` §10.9). Se o app Android estiver segurando a conexão, feche-o (ou desligue o Bluetooth do celular) e clique em CONECTAR no Dashboard pra reclamar a conexão pro PC.

## 5.9 Versão e build dos executáveis (`launchers/release.py`)

O número de versão do app vive num arquivo `VERSION` na raiz (lido por `version.py`) — aparece no `/api/status` (`app_version`) e no cabeçalho do Dashboard. `WyGlass.exe`/`WyGlassDashboard.exe` (em `dist/`) são só um trampolim: eles não embutem `server.py`/`dashboard.py`, apenas chamam o Python real apontando pra esses arquivos (ver docstring de `launchers/launch_server.py`) — então editar o código do app nunca exige recompilar o `.exe`.

Pra atualizar a versão (e, por padrão, recompilar os dois executáveis junto — rápido, sem dependências pesadas nesses launchers-trampolim):

```bash
python launchers/release.py                 # bump patch: 0.1.0 -> 0.1.1
python launchers/release.py --minor         # bump minor: 0.1.1 -> 0.2.0
python launchers/release.py --major         # bump major: 0.2.0 -> 1.0.0
python launchers/release.py --set 1.2.3     # versão explícita
python launchers/release.py --no-build      # só bump, sem recompilar os .exe
```

Os `.exe` só *precisam* ser recompilados de novo se o próprio launcher-trampolim mudar (raro) ou no primeiro setup — mesmo assim o script recompila a cada bump por padrão, pra nunca deixar o `dist/` com um binário de versão anterior por esquecimento.
