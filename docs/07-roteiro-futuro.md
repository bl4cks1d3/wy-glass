# 7. Roteiro futuro

## 7.1 Palavra de ativação (wake word)

Hoje o gatilho é sempre o botão físico. Uma palavra de ativação (ex: "Wy Glass" ou "Ei, óculos") eliminaria a necessidade do clique.

**Como implementaria:**
- Bibliotecas candidatas: [`openWakeWord`](https://github.com/dscripka/openWakeWord) (open source, treina modelos customizados) ou [Porcupine](https://picovoice.ai/) (comercial, mais preciso, tem tier gratuito).
- Escutaria continuamente o microfone Bluetooth (já disponível como dispositivo de entrada padrão do Windows), rodando o modelo de detecção em um stream contínuo, sem custo de API (roda local).
- Ao detectar a palavra, dispararia a mesma função `jarvis_voice_agent` já existente — a integração seria só trocar o gatilho, não o pipeline de resposta.
- **Trade-off**: manter um stream de áudio sempre aberto consome CPU continuamente; teria que medir impacto real antes de decidir se vale a pena vs. manter o botão físico como gatilho.

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

## 7.4 Open source

O projeto não depende de nenhum código do fabricante (nem do APK, nem do firmware além do protocolo documentado aqui) — é seguro publicar. Sugestões antes de publicar:

- Remover a chave de API do Gemini do `config.json` versionado (usar variável de ambiente ou um `config.example.json` sem segredos).
- Adicionar uma licença (MIT ou Apache-2.0, dado que não há dependência de código proprietário de terceiros redistribuído).
- Considerar generalizar o endereço BLE / UUIDs fixos para um passo de "descoberta" na primeira execução, já que outra unidade do mesmo modelo pode ter endereço diferente (os UUIDs de serviço devem ser os mesmos entre unidades, já que vêm do firmware).

## 7.5 Outras ideias soltas

- **Feedback tátil/sonoro de início/fim de gravação**: hoje não há nenhuma confirmação sonora de "comecei a escutar" — um beep curto ajudaria a UX.
- **Histórico de conversas**: persistir as interações (pergunta + resposta) em um log/arquivo para consulta posterior.
- **Interromper a fala do assistente**: hoje, uma vez que o TTS começa a tocar, não há como interromper apertando o botão — poderia ouvir por um clique durante a reprodução e cortar o áudio.
- **Explorar os outros dois serviços BLE não utilizados** (`ae00`/`ae01`/`ae02` e `cc353442-...`) — podem esconder controle de câmera ou funcionalidades ainda não mapeadas.
