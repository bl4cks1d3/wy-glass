# @planner-life/voice

Texto-para-fala local em portugues usando o [Piper](https://github.com/rhasspy/piper)
(TTS neural, roda offline, sem custo por requisicao -- por isso preferido
aqui em vez de uma API de voz paga). Expoe um servico NestJS com um unico
endpoint: `POST /speak { text }` retornando `audio/wav`.

O binario do Piper e o modelo de voz **nao ficam no git** (somam ~85MB e
sao binarios) -- ficam em `vendor/`, que e gitignored. Rode o setup abaixo
depois de clonar o repositorio ou trocar de maquina.

## Setup (Windows -- o que ja esta configurado neste projeto)

```bash
mkdir -p packages/voice/vendor/models
cd packages/voice/vendor

# Binario do Piper para Windows
curl -L -o piper_windows_amd64.zip \
  https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip
unzip piper_windows_amd64.zip
rm piper_windows_amd64.zip

# Voz pt_BR "faber" (medium) -- outras vozes pt_BR disponiveis: edresson
# (low), cadu (medium), jeff (medium). Catalogo completo em
# https://huggingface.co/rhasspy/piper-voices/tree/main/pt/pt_BR
curl -L -o models/pt_BR-faber-medium.onnx \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx
curl -L -o models/pt_BR-faber-medium.onnx.json \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx.json
```

Resultado esperado:

```
packages/voice/vendor/
├── piper/
│   ├── piper.exe
│   └── ... (dlls e espeak-ng-data/)
└── models/
    ├── pt_BR-faber-medium.onnx
    └── pt_BR-faber-medium.onnx.json
```

## Setup no Raspberry Pi / Linux

O Piper publica binarios prontos para `armv7l` (Raspberry Pi 32-bit) e
`aarch64` (64-bit) nas mesmas [releases do GitHub](https://github.com/rhasspy/piper/releases).
Baixe o tarball correspondente, extraia em `vendor/piper/` e aponte
`PIPER_BIN` no `.env` para o binario `piper` (sem `.exe`). O modelo de voz
(`.onnx` + `.onnx.json`) e o mesmo em qualquer plataforma.

Para o Raspberry Pi 3 (1GB RAM), prefira uma voz "low" em vez de "medium"
-- roda mais rapido com menos memoria.

## Configuracao (.env na raiz do projeto)

- `VOICE_PORT` - porta do servico (default 4200)
- `PIPER_BIN` - caminho para o executavel do Piper (default: `vendor/piper/piper.exe`)
- `PIPER_MODEL` - caminho para o modelo `.onnx` (default: `vendor/models/pt_BR-faber-medium.onnx`)

## Uso

```bash
pnpm dev:voice                 # sobe o servico em http://localhost:4200
pnpm --filter @planner-life/voice cli -- "Ola, isso e um teste" saida.wav
```
