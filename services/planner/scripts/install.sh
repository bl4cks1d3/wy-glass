#!/usr/bin/env bash
# Instalador do Planner Life para Linux, macOS e Raspberry Pi.
# (No Windows use scripts/install.ps1.) Pode ser rodado de novo sem problema.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MIN_NODE_MAJOR=22
MIN_NODE_MINOR=5
PIPER_RELEASE="2023.11.14-2"

CHECK_ONLY=0
WITH_VOICE=0
NO_DESKTOP=0
ASSUME_YES=0

usage() {
  cat <<'EOF'
Uso: scripts/install.sh [opcoes]

  --check        so verifica os pre-requisitos, sem instalar nada
  --with-voice   baixa o Piper e a voz pt-BR (~85 MB) para o TTS local
  --no-desktop   nao instala o app Electron (pula o download de ~100 MB)
  --yes          nao faz perguntas (usa os padroes; nao pede chave de IA)
  -h, --help     mostra esta ajuda
EOF
}

for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=1 ;;
    --with-voice) WITH_VOICE=1 ;;
    --no-desktop) NO_DESKTOP=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "opcao desconhecida: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

step() { printf '\n==> %s\n' "$1"; }
ok()   { printf '  [ok] %s\n' "$1"; }
warn() { printf '  [aviso] %s\n' "$1"; }
fail() { printf '  [erro] %s\n' "$1" >&2; exit 1; }

interactive() { [ "$ASSUME_YES" -eq 0 ] && [ -t 0 ]; }

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
  Linux|Darwin) ;;
  MINGW*|MSYS*|CYGWIN*) warn "Windows detectado: prefira scripts/install.ps1 (PowerShell). Seguindo mesmo assim." ;;
  *) fail "sistema nao suportado: $OS" ;;
esac

# Troca (ou acrescenta) KEY=valor no .env sem interpretar o valor (chaves podem ter \ & / $).
set_env() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  ENV_VALUE="$value" awk -v k="$key" '
    index($0, k "=") == 1 { print k "=" ENVIRON["ENV_VALUE"]; found = 1; next }
    { print }
    END { if (!found) print k "=" ENVIRON["ENV_VALUE"] }
  ' .env > "$tmp"
  cat "$tmp" > .env
  rm -f "$tmp"
}

env_value() {
  grep -E "^$1=" .env 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '\r'
}

# ---------------------------------------------------------------- pre-requisitos
step "Verificando pre-requisitos"

command -v node >/dev/null 2>&1 || fail "Node.js nao encontrado. Instale a versao ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}+ (https://nodejs.org ou 'nvm install 22') e rode de novo."
NODE_VERSION="$(node -v | sed 's/^v//')"
NODE_MAJOR="${NODE_VERSION%%.*}"
NODE_MINOR="$(echo "$NODE_VERSION" | cut -d. -f2)"
if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ] || { [ "$NODE_MAJOR" -eq "$MIN_NODE_MAJOR" ] && [ "$NODE_MINOR" -lt "$MIN_NODE_MINOR" ]; }; then
  fail "Node.js $NODE_VERSION e antigo demais: o Core usa node:sqlite e exige ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}+."
fi
ok "Node.js $NODE_VERSION"

if ! command -v pnpm >/dev/null 2>&1; then
  if [ "$CHECK_ONLY" -eq 1 ]; then
    warn "pnpm nao encontrado (o instalador tentaria ativar via corepack)"
  else
    warn "pnpm nao encontrado, ativando via corepack..."
    if command -v corepack >/dev/null 2>&1; then
      corepack enable >/dev/null 2>&1 || true
      corepack prepare pnpm@latest --activate >/dev/null 2>&1 || true
    fi
    command -v pnpm >/dev/null 2>&1 || fail "Nao consegui ativar o pnpm. Instale com 'npm install -g pnpm' (pode exigir sudo) e rode de novo."
  fi
fi
command -v pnpm >/dev/null 2>&1 && ok "pnpm $(pnpm -v)"

command -v git >/dev/null 2>&1 && ok "git $(git --version | awk '{print $3}')" || warn "git nao encontrado (so necessario para atualizar o projeto)"

if command -v claude >/dev/null 2>&1; then
  ok "Claude Code CLI encontrado (Terminal e Pesquisa vao funcionar)"
else
  warn "Claude Code CLI nao encontrado: a aba Terminal e a pesquisa por tema precisam dele (npm install -g @anthropic-ai/claude-code, depois 'claude' para autenticar). O resto funciona sem."
fi

if [ "$WITH_VOICE" -eq 1 ]; then
  command -v curl >/dev/null 2>&1 || fail "curl e necessario para baixar o Piper."
  command -v tar >/dev/null 2>&1 || fail "tar e necessario para extrair o Piper."
fi

if [ "$CHECK_ONLY" -eq 1 ]; then
  step "Modo --check: nada foi instalado."
  exit 0
fi

# ---------------------------------------------------------------- dependencias
step "Instalando dependencias (pnpm install)"
if [ "$NO_DESKTOP" -eq 1 ]; then
  pnpm install --filter '!@planner-life/desktop'
else
  pnpm install
fi
ok "dependencias instaladas"

# ---------------------------------------------------------------- .env
step "Configurando o .env"
if [ -f .env ]; then
  ok ".env ja existe, mantido como esta"
else
  cp .env.example .env
  ok ".env criado a partir do .env.example"

  if interactive; then
    echo
    echo "  O chat precisa de uma chave de IA. Groq e Gemini tem free tier."
    echo "  Groq:   https://console.groq.com/keys"
    echo "  Gemini: https://aistudio.google.com/apikey"
    echo "  (Enter pula; voce pode preencher depois na aba Configuracoes.)"
    read -rsp "  Chave do Groq: " GROQ_INPUT; echo
    if [ -n "$GROQ_INPUT" ]; then
      set_env GROQ_API_KEY "$GROQ_INPUT"
      ok "GROQ_API_KEY gravada no .env"
    else
      read -rsp "  Chave do Gemini: " GEMINI_INPUT; echo
      if [ -n "$GEMINI_INPUT" ]; then
        set_env GEMINI_API_KEY "$GEMINI_INPUT"
        ok "GEMINI_API_KEY gravada no .env"
      else
        warn "nenhuma chave informada: o chat so funciona depois de configurar uma."
      fi
    fi
    unset GROQ_INPUT GEMINI_INPUT
  else
    warn "modo sem perguntas: preencha uma chave de IA no .env ou na aba Configuracoes."
  fi
fi
chmod 600 .env 2>/dev/null || true

# ---------------------------------------------------------------- shared
step "Compilando o pacote compartilhado"
pnpm --filter @planner-life/shared build
ok "@planner-life/shared compilado"

# ---------------------------------------------------------------- voz (opcional)
download() {
  local progress="-sS"
  [ -t 1 ] && progress="--progress-bar"
  curl -fL "$progress" -o "$1" "$2"
}

install_voice() {
  local vendor="$ROOT/packages/voice/vendor" asset model_dir model_name model_path bin_path
  case "$OS/$ARCH" in
    Linux/x86_64)              asset="piper_linux_x86_64.tar.gz" ;;
    Linux/aarch64|Linux/arm64) asset="piper_linux_aarch64.tar.gz" ;;
    Linux/armv7l)              asset="piper_linux_armv7l.tar.gz" ;;
    Darwin/x86_64)             asset="piper_macos_x64.tar.gz" ;;
    Darwin/arm64)              asset="piper_macos_aarch64.tar.gz" ;;
    *) warn "sem binario do Piper para $OS/$ARCH; pulando a voz."; return 0 ;;
  esac
  case "$OS" in MINGW*|MSYS*|CYGWIN*) warn "no Windows use scripts/install.ps1 -WithVoice"; return 0 ;; esac

  # Raspberry Pi: a voz "low" roda bem mais leve que a "medium".
  case "$ARCH" in
    armv7l|aarch64|arm64) model_dir="edresson/low"; model_name="pt_BR-edresson-low" ;;
    *)                    model_dir="faber/medium"; model_name="pt_BR-faber-medium" ;;
  esac

  mkdir -p "$vendor/models"
  bin_path="$vendor/piper/piper"
  if [ ! -x "$bin_path" ]; then
    echo "  baixando Piper ($asset)..."
    download "$vendor/piper.tar.gz" \
      "https://github.com/rhasspy/piper/releases/download/${PIPER_RELEASE}/${asset}"
    tar -xzf "$vendor/piper.tar.gz" -C "$vendor"
    rm -f "$vendor/piper.tar.gz"
  fi
  model_path="$vendor/models/${model_name}.onnx"
  if [ ! -f "$model_path" ]; then
    echo "  baixando a voz ${model_name}..."
    local base="https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/${model_dir}/${model_name}"
    download "$model_path" "${base}.onnx"
    download "${model_path}.json" "${base}.onnx.json"
  fi
  [ -x "$bin_path" ] || fail "binario do Piper nao encontrado em $bin_path apos a extracao."
  # o default do servico aponta para piper.exe; fora do Windows precisa do caminho real
  set_env PIPER_BIN "$bin_path"
  set_env PIPER_MODEL "$model_path"
  ok "Piper e voz ${model_name} instalados; PIPER_BIN e PIPER_MODEL gravados no .env"
}

if [ "$WITH_VOICE" -eq 1 ]; then
  step "Instalando a voz local (Piper)"
  install_voice
elif interactive; then
  echo
  read -rp "Baixar a voz local (Piper, ~85 MB) agora? [s/N] " REPLY
  case "$REPLY" in
    s|S|y|Y) step "Instalando a voz local (Piper)"; install_voice ;;
    *) warn "voz pulada (rode de novo com --with-voice quando quiser)" ;;
  esac
fi

# ---------------------------------------------------------------- pasta de dados
mkdir -p data
ok "pasta data/ pronta (banco SQLite e vault local ficam aqui)"

# ---------------------------------------------------------------- fim
cat <<EOF

Instalacao concluida.

Proximos passos:
  pnpm dev            # core :4000, agent :4100, voice :4200, web :4300
  pnpm dev:p2p        # (opcional) no P2P, em outro terminal
  pnpm desktop        # (opcional) app em janela, sobe tudo sozinho

Abra http://localhost:4300

Pendencias:
EOF
[ -z "$(env_value GROQ_API_KEY)$(env_value GEMINI_API_KEY)$(env_value ANTHROPIC_API_KEY)" ] \
  && echo "  - configurar uma chave de IA (aba Configuracoes ou .env)"
[ -z "$(env_value GOOGLE_CLIENT_ID)" ] \
  && echo "  - (opcional) Google: preencher GOOGLE_CLIENT_ID/SECRET, ver docs/CONFIGURATION.md secao 4"
command -v claude >/dev/null 2>&1 \
  || echo "  - (opcional) instalar o Claude Code CLI para Terminal e Pesquisa"
echo "  Documentacao: docs/README.md"
exit 0
