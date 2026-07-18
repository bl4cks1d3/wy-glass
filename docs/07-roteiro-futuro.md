# 7. Roteiro futuro

## 7.1 Palavra de ativação (wake word) e detecção de palma — status: adiado, papel movido para o Open Jarvis

Chegou a ser implementado (`audio_capture.py` com stream de mic compartilhado + `passive_listener.py` com detector de palma dupla por heurística de pico de energia) e validado ao vivo — a captura funciona, mas a calibração do detector de palma exigiu mais ajuste fino do que o esperado (thresholds de RMS e janela de pareamento sensíveis ao ambiente).

Decisão: em vez de continuar afinando isso no Wy Glass, esse papel (gatilho hands-free) passou a ser coberto pelo **Open Jarvis** (ver `11-open-jarvis.md`), que já tem seu próprio `clap-trigger.py`. O código de `audio_capture.py`/`passive_listener.py` continua no repositório (`passive_listening.enabled: false` no `config.json`) como base pronta, caso valha a pena retomar wake word/palma no Wy Glass no futuro — a infraestrutura (stream de mic compartilhado, pause/resume durante fala) já existe e funciona, só a calibração do detector de palma ficou pendente.

**Se retomar**: bibliotecas candidatas pra wake word de verdade (não implementado ainda) seguem sendo [`openWakeWord`](https://github.com/dscripka/openWakeWord) ou [Porcupine](https://picovoice.ai/).

## 7.1.1 STT local (faster-whisper) — testado, rejeitado por enquanto

Testado como alternativa 100% offline ao Groq Whisper (que já é usado pro STT do agente unificado). Transcrição correta (`faster-whisper`, modelo `small`, CPU, int8), mas **muito lento nessa máquina**: ~80s pra carregar o modelo (uma vez, evitável se ficasse residente em memória) + ~18s só pra transcrever um "E aí" — comparado a ~1-2s do Groq via API. Sem GPU dedicada (só Iris Xe integrada), inviável pra uso em tempo real — mesma limitação já vista com Qwen2.5-VL no Ollama (ver `11-open-jarvis.md §11.4`).

**Se retomar**: só faz sentido com GPU dedicada. `faster-whisper` já está instalado (`pip install faster-whisper`), não foi removido — só não está conectado a nenhuma ação.

## 7.2 Múltiplos agentes / modelos

A arquitetura de `actions.py` já é propositalmente "plugável" — cada ação é uma função independente registrada em um dicionário (`ACTIONS`). Extensões possíveis sem redesenhar nada:

- Adicionar `openai_voice_agent` (usando a API da OpenAI) ou `claude_voice_agent` (Anthropic) como ações alternativas.
- Adicionar suporte a modelos locais via [Ollama](https://ollama.com/) — útil para funcionar 100% offline (trocando também o Gemini por STT+LLM+TTS local).
- Permitir múltiplos "agentes" configurados simultaneamente, cada botão/gesto chamando um agente diferente (ex: botão 1 = Gemini para perguntas gerais, botão 2 = um agente especializado em outra tarefa).

## 7.3 Versão Linux

A stack inteira já é multiplataforma por natureza:

| Componente | Windows | Linux |
|---|---|---|
| BLE | `bleak` (WinRT) | `bleak` (BlueZ via D-Bus) — mesma API, backend diferente |
| Áudio | `sounddevice` (PortAudio/WASAPI) | `sounddevice` (PortAudio/ALsA ou PulseAudio) |
| TTS | Piper (ONNX Runtime) | Piper (ONNX Runtime, mesmos binários) |
| Servidor | FastAPI/uvicorn | Idêntico |
| Execução em segundo plano | `pythonw.exe` + `.vbs` | Unidade `systemd --user` |

O trabalho real de portar não é reescrever, é **testar e ajustar** — principalmente:
- Confirmar que o Bluetooth clássico (A2DP/HFP) pareia e aparece como dispositivo de áudio da mesma forma no PulseAudio/PipeWire.
- BlueZ às vezes exige permissões extras (`bluetoothctl`, grupo `bluetooth`) que o Windows não pede.
- Trocar o mecanismo de "rodar oculto em segundo plano" por um serviço `systemd --user` com `WantedBy=default.target`.

## 7.4 Open source — feito

Repositório git próprio criado em `projects/cerebro-oculos/wy-glass/`, com `.gitignore` (exclui `config.json` real, gravações, screenshots, modelos `.onnx`, artefatos de build do Android), `config.example.json` com placeholders, e `LICENSE` (MIT). Commit inicial feito localmente — publicação no GitHub (criar repositório remoto + push) fica a cargo do usuário.

Pendente, se algum dia for relevante: generalizar o endereço BLE fixo pra um passo de "descoberta" na primeira execução, já que outra unidade do mesmo modelo pode ter endereço diferente.

## 7.5 Outras ideias soltas

- **Feedback tátil/sonoro de início/fim de gravação**: hoje não há nenhuma confirmação sonora de "comecei a escutar" — um beep curto ajudaria a UX.
- **Histórico de conversas**: persistir as interações (pergunta + resposta) em um log/arquivo para consulta posterior.
- **Interromper a fala do assistente**: hoje, uma vez que o TTS começa a tocar, não há como interromper apertando o botão — poderia ouvir por um clique durante a reprodução e cortar o áudio.
- **Explorar os outros dois serviços BLE não utilizados** (`ae00`/`ae01`/`ae02` e `cc353442-...`) — funcionalidade ainda não mapeada (câmera está descartada, esta unidade não tem — talvez OTA de firmware ou controle da lanterna).
