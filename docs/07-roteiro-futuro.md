# 7. Roteiro futuro

## 7.1 Palavra de ativação (wake word) — feito (2026-08-08)

Chegou a ficar adiada por um tempo (ver histórico abaixo) — a captura de palma dupla funcionava, mas a calibração exigiu mais ajuste fino do que o esperado, e o papel de gatilho hands-free passou temporariamente para o Open Jarvis. Retomada e concluída: [`openWakeWord`](https://github.com/dscripka/openWakeWord) (modelo pré-treinado `hey_jarvis`, 100% local/offline) integrado em `passive_listener.py`, escutando o mesmo stream de mic compartilhado (`audio_capture.py`) que já existia pra detecção de palma. Ao dizer "Hey Jarvis", dispara o mesmo fluxo do botão 1 clique simples — e o que é dito a seguir é roteado por tool-calling, então **não precisa de uma wake word por funcionalidade**: "Hey Jarvis, inicia tradução" já funciona hoje.

**Bug real encontrado e corrigido no caminho**: a primeira versão rodava o openWakeWord numa thread dedicada dentro do processo do `server.py` — e crashava silenciosamente na primeira detecção, porque `onnxruntime` (usado por baixo) conflita em nível de DLL com `bleak`/WinRT quando os dois estão carregados no mesmo *processo* (não é um problema de thread — o mesmo motivo já documentado pro Piper TTS, ver `04-arquitetura.md` §4.8). Corrigido isolando de verdade num subprocesso (`wakeword_worker.py`), mesmo padrão do `tts_worker.py`.

**Detalhes de configuração e limitações**: `06-referencia-acoes.md` §6.3.

### Histórico: detecção de palma (calibração ficou pendente)

`passive_listener.py` também tem um detector de palma dupla por heurística de pico de energia (`ClapDetector`) — implementado e validado ao vivo, mas a calibração (thresholds de RMS e janela de pareamento) é sensível ao ambiente e nunca foi totalmente afinada. Continua no repositório, desligado por padrão (`clap_detection.enabled: false`), como alternativa à wake word por voz pra quem preferir um gatilho não-verbal.

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

- ~~**Feedback tátil/sonoro de início/fim de gravação**~~ — feito: `jarvis.play_beep()`, tom curto sintético tocado no início de todo `record_audio_vad()` (cobre clique simples e cada volta do modo conversa). Falta só o "fim de gravação" (hoje só há confirmação de início).
- **Histórico de conversas**: persistir as interações (pergunta + resposta) em um log/arquivo para consulta posterior — hoje `smart_agent.conversations` só vive em memória, some ao reiniciar o servidor.
- ~~**Interromper a fala do assistente**~~ — feito: `jarvis.stop_speaking()`, chamado no clique do botão 2 durante a reprodução (`server.py::stop_conversation`) — corta o TTS na hora via comando `{"cmd": "stop"}` pro `tts_worker.py` persistente (ver `04-arquitetura.md` §4.8).
- ~~**Explorar os outros dois serviços BLE não utilizados**~~ — um confirmado, outro genuinamente sem resposta pública: `ae00`/`ae01`/`ae02` é o canal oficial de **OTA de firmware da Jieli** (SDK `jl_bt_ota`, protocolo RCSP, confirmado via análise do APK oficial + [`Jieli-Tech/Android-JL_OTA`](https://github.com/Jieli-Tech/Android-JL_OTA) público). Já `cc353442-.../c551c36a` **não é específico da Jieli nem deste dispositivo** — o mesmo par de UUIDs aparece sem decodificação em Huawei Band 8, Xiaomi Smart Band 8 Pro e Honor Choice Watch 2i, inclusive nos pedidos de suporte a esses aparelhos no Gadgetbridge (o projeto open-source mais ativo de engenharia reversa de wearables) — é algum SDK/componente de referência compartilhado por vários fabricantes, ainda sem decodificação pública conhecida em lugar nenhum. Ver `02-protocolo-ble.md` §2.1. Implementar um cliente RCSP de verdade (controle geral ou OTA) fica como possibilidade futura — sem objetivo concreto que justifique agora, e escrita nesses canais tem risco real de corromper firmware se malfeita.
- **`get_news` no app Android**: hoje só existe no PC (`browser_tools.fetch_news`, via Playwright/scrape) — não portado pro Kotlin por não haver headless browser no Android (ver `10-app-android.md` §10.18). Daria pra portar trocando a fonte por uma API JSON de notícias com chave própria (NewsAPI, GNews).
- ~~**Detectar intenção de encerrar por padrões além de tool-calling**~~ — feito (e reforçado em 2026-08-08): `smart_agent._FAREWELL_PATTERN` (regex determinístico pra "tchau"/"até mais"/etc, rede de segurança caso o Groq não chame `end_conversation`) já existia; agora `intent_classifier.classify()` (§7.9) também reconhece despedidas comuns e encerra sem nem chamar o Groq.
- **Monitorar deprecação de modelos Groq automaticamente**: `see_screen` ficou quebrado silenciosamente por um tempo (404) porque o modelo de visão usado (`llama-4-scout`) foi removido da Groq sem aviso no código. Um healthcheck periódico (`GET /openai/v1/models`, conferir se `GROQ_TEXT_MODEL`/`GROQ_VISION_MODEL` ainda estão na lista) evitaria descobrir isso só quando o usuário tentar usar.
- **`take_screenshot` e demais tools novas no app Android**: `AgentTools.kt` ainda só tem `search`/`open_url` — `end_conversation`, `take_screenshot` (não aplicável, sem tela pra "salvar" no sentido de print de PC) e o resto do roteiro de paridade seguem em `10-app-android.md` §10.18.

## 7.6 Modo conversa: encerrar por voz — feito

Até a v0.1.2, a única forma de encerrar o modo conversa contínua (clique duplo) era o clique físico do botão 2 — se despedir por voz ("tchau", "até mais") só fazia o modelo responder educadamente, sem parar o loop, deixando a conversa presa repetindo despedidas. Corrigido com uma nova tool `end_conversation` (`smart_agent.py`) que o Groq chama ao reconhecer uma despedida clara; `server.py::conversation_loop` checa a flag (`smart_agent.end_requested`) depois de cada turno e encerra o loop sozinho, sem precisar do botão físico.

## 7.7 Tool-calling, memória de conversa, personas e tradutor — feito

Todos implementados em `smart_agent.py`. Tool-calling e memória de conversa já existiam antes de uma pesquisa de mercado ter sido feita sem checar o código atual (erro corrigido em `09-pesquisa-features.md`) — o que faltava de fato era **personas trocáveis por voz** (`set_persona`, 4 modos: `padrao`/`serio`/`brincalhao`/`professor`) e **tradução em tempo real** (`translator_agent`, bidirecional PT↔EN, chamável por botão ou por voz via `start_translator`). Detalhes: `06-referencia-acoes.md` §6.2.

## 7.8 Reconhecimento de locutor e supressão de ruído — feito (2026-08-08)

**Reconhecimento de locutor** (`enroll_voice.py` + `speaker_verify_worker.py`, biblioteca `resemblyzer`): opcional, restringe a wake word à voz de quem cadastrou (`voice_profile.npy`, 100% local) — evita que TV ou outra pessoa disparem "Hey Jarvis" sem querer. Não afeta o clique físico do botão. Isolado em subprocesso pelo mesmo motivo da wake word (`torch`, usado por baixo do `resemblyzer`, tem o mesmo histórico de risco de conflito de DLL com `bleak`).

**Supressão de ruído** (`jarvis.reduce_noise_pcm`, biblioteca `noisereduce`, spectral gating): roda no clipe já gravado (depois do VAD), antes da transcrição — melhora o Whisper em ambiente com ruído de fundo. ~0.05s por chamada depois do custo único de import (~2-5s, a lib carrega `matplotlib`/`scipy.signal` por baixo mesmo sem usar plot nenhum). Não cobre o stream contínuo em tempo real da wake word — ver §7.1 dessa limitação.

Ambos batem numa peculiaridade real deste ambiente (Python 3.14, muito recente): `resemblyzer` declara `webrtcvad` como dependência, mas esse pacote tem extensão C sem wheel pronta pra 3.14 ainda — contornado com `pip install --no-deps` + um módulo stub (nunca exercitado de verdade, só satisfaz o `import`). Detalhes completos: `06-referencia-acoes.md` §6.4.

## 7.9 Classificador de intenção local (atalho antes do Groq) — feito (2026-08-08)

Motivação: melhorar a detecção de comandos de controle conhecidos (ex: "inicia tradução", "abre o dashboard") sem depender só do Groq — mais rápido (pula o round-trip de LLM pros casos óbvios) e mais determinístico. Cogitado usar [Wit.ai](https://wit.ai) (NLU da Meta) pra isso, mas é serviço em nuvem — contradiz a decisão de manter wake word e reconhecimento de locutor 100% locais. Implementado em vez disso com `scikit-learn` (TF-IDF + similaridade de cosseno) — **sem nenhuma dependência nova**, já estava instalado transitivamente via `openwakeword`.

`intent_classifier.py`: roda antes de `smart_agent.process_turn()` chamar o Groq — se o texto transcrito bate com confiança alta num dos ~9 intents de controle conhecidos (sem argumento livre: `start_translator`, `end_conversation`, `open_dashboard`, `take_screenshot`, `see_screen`, `set_persona` × 4 personas), executa direto. Qualquer coisa fora desses casos (busca, abrir URL, perguntas abertas) cai pro Groq tool-calling normal, sem nenhuma mudança de comportamento.

**Dois bugs reais encontrados testando antes de ligar em produção** (documentados no próprio módulo): (1) frases de treino escritas sem acento (convenção do resto do código) nunca batiam com a transcrição real do Whisper, que vem acentuada — corrigido normalizando acentos dos dois lados antes de vetorizar; (2) uma única palavra genérica compartilhada (ex: "abre") empurrava frases de domínios completamente diferentes pra cima do threshold ("abre o youtube" caindo como `start_translator`) — corrigido com bigramas (`ngram_range=(1,2)`) e uma margem mínima exigida entre o 1º e o 2º colocado, não só um score mínimo absoluto.
