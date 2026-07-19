# 4. Arquitetura do software

## 4.1 Visão geral

```
┌─────────────┐     BLE notify (bc0303)     ┌──────────────────────────┐
│  Óculos      │ ───────────────────────────▶│  server.py (FastAPI)     │
│  (Wy Glass)  │                              │                          │
│              │◀──── Bluetooth clássico ────│  sounddevice (áudio)     │
└─────────────┘   (A2DP/HFP, já pareado)     └──────────────────────────┘
                                                        │
                                    classifica evento (heartbeat? clique?)
                                                        │
                                    conta cliques por botão (debounce)
                                                        │
                                          dispara a ação configurada
                                                        │
                              ┌─────────────────────────┴─────────────────────────┐
                        ação única                                     modo conversacional
                    (roda em thread separada,                    (loop assíncrono: grava→pergunta→
                     não trava o loop principal)                   fala→repete, até sinal de parada)
```

## 4.2 Arquivos do projeto

| Arquivo | Responsabilidade |
|---|---|
| `server.py` | Servidor FastAPI: conexão BLE persistente, classificação de eventos, contagem de cliques, WebSocket, rotas HTTP |
| `actions.py` | Dispatcher de ações — cada tipo de ação (`run_command`, `screenshot`, etc.) é uma função pura |
| `jarvis.py` | Pipeline de IA: gravação com VAD, chamada ao Gemini, síntese de voz |
| `tts_worker.py` | Processo isolado que roda a síntese de voz (Piper) — separado para evitar conflito de DLL nativa |
| `config.json` | Configuração persistente: endereço do dispositivo, mapeamento de gestos, chaves de API |
| `static/index.html` | Painel de controle (`/deck`) |
| `static/test.html` | Painel de diagnóstico (`/test`) |
| `static/landing.html` | Página de apresentação (`/`) |
| `start_hidden.vbs` | Inicia o servidor sem janela de console (`pythonw.exe`) |
| `tts_models/` | Modelos de voz Piper (`.onnx` + `.onnx.json`) baixados do Hugging Face |

## 4.3 Ciclo de vida da conexão BLE

`server.py` mantém um loop (`ble_manager`) que:

1. Escaneia o endereço configurado.
2. Conecta via `bleak.BleakClient`.
3. Assina a characteristic de notificação.
4. Espera até desconectar (`disconnected_callback`).
5. Ao desconectar (por qualquer motivo — fora de alcance, erro, desligou), espera alguns segundos e tenta reconectar automaticamente, indefinidamente.

Isso significa que o Wy Glass se recupera sozinho de: óculos desligados/religados, saída de alcance, erros transitórios de pilha Bluetooth do Windows.

## 4.4 Classificação de eventos e por que rodar em thread

Cada notificação BLE passa por `classify_button()`, que checa se o payload bate com o padrão `bc030301XX` (clique de botão). Qualquer outro prefixo (`bc07`, `bc09`, etc.) é ignorado — não dispara nenhuma ação.

**Detalhe crítico de design**: a ação disparada (gravar áudio, chamar o Gemini, sintetizar voz) é uma sequência de chamadas **bloqueantes** (não-assíncronas). Rodar isso diretamente dentro do loop de eventos do `asyncio` congelaria o servidor inteiro por 10-25 segundos a cada interação — inclusive impedindo o botão de "parar conversa" de ser processado a tempo. A solução foi mover a execução da ação para uma thread separada via `loop.run_in_executor(None, ...)`, mantendo o loop principal (BLE, WebSocket) sempre responsivo.

## 4.5 Contagem de cliques (simples/duplo/triplo)

Não existe distinção de "clique duplo" no protocolo do hardware — cada clique gera exatamente um evento `bc0303`. A distinção simples/duplo/triplo é feita **inteiramente em software**:

1. Ao receber um clique, incrementa um contador para aquele botão e (re)inicia um timer de ~450ms.
2. Se outro clique chegar antes do timer disparar, o contador soma e o timer reinicia.
3. Quando o timer finalmente dispara sem novos cliques, o contador final decide qual gesto foi feito: 1 → simples, 2 → duplo, 3 → triplo (4+ é ambíguo e ignorado).

## 4.6 Modo conversacional

Implementado como uma tarefa assíncrona (`conversation_loop`) que:

1. Marca `state.conversation_active = True`.
2. Em loop, roda a ação `jarvis_voice_agent` (grava → pergunta → fala) via thread.
3. Repete enquanto `conversation_active` continuar `True`.
4. Para quando outro gesto configurado com a ação especial `stop_conversation` for disparado (seta a flag para `False` e, opcionalmente, fala uma frase de despedida).

## 4.7 Pipeline do Jarvis (`jarvis.py`)

```
record_audio_vad()  →  pcm_to_wav_bytes()  →  ask_gemini()  →  speak() [subprocesso]
```

- **`record_audio_vad`**: grava em blocos pequenos (~30ms), calcula RMS de cada bloco, e para automaticamente após um período configurável de silêncio contínuo seguindo fala detectada. Teto de segurança (`max_duration_seconds`) evita gravação infinita.
- **`ask_gemini`**: manda o áudio (WAV, base64) direto para a API REST do Gemini (`generateContent`), sem necessidade de transcrição separada — o modelo entende áudio nativamente. Tem retry com backoff exponencial para erros 429 (limite de requisições).
- **`speak`**: delega a síntese de voz para `tts_worker.py`, rodado como **subprocesso** — necessário porque o `onnxruntime` (usado pelo Piper) conflita com outras bibliotecas nativas já carregadas no processo principal (bleak/WinRT), causando falha de carregamento de DLL se rodado no mesmo processo.

## 4.8 Por que subprocesso para o TTS?

Durante o desenvolvimento, descobrimos que rodar o Piper TTS (via `onnxruntime`) no mesmo processo Python que já tinha carregado `bleak` (WinRT/COM) e outras bibliotecas nativas causava uma falha de inicialização de DLL — mas funcionava perfeitamente quando testado isoladamente. A causa raiz é um conflito de DLL entre bibliotecas nativas diferentes carregadas no mesmo processo ("DLL hell" clássico do Windows). A solução mais simples e robusta foi isolar a síntese de voz em um processo Python novo a cada chamada, evitando o conflito por completo, ao custo de ~1-2s de overhead de inicialização do interpretador.

## 4.9 Áudio de saída via Bluetooth clássico

O Wy Glass não decodifica o codec de áudio proprietário do canal BLE — em vez disso, toda entrada/saída de áudio usa o **Bluetooth clássico (A2DP/HFP)**, que já funciona nativamente no Windows como um dispositivo de som comum. Isso significa:

- `sounddevice.rec()` grava do microfone do dispositivo Bluetooth padrão do Windows.
- `sounddevice.play()` toca no alto-falante do dispositivo Bluetooth padrão do Windows.
- Nenhuma decodificação de codec proprietário foi necessária.

Um detalhe de robustez: áudio via Bluetooth clássico tem mais latência de buffer que um alto-falante local — sem cuidado, o processo pode "fechar" o stream de áudio antes do buffer terminar de ser transmitido, cortando o final da fala. A correção foi adicionar um pequeno trecho de silêncio no final do áudio sintetizado, mais uma pausa extra após `sd.wait()`, dando tempo à pilha Bluetooth de esvaziar o buffer por completo.

## 4.10 Saudação ao conectar + bug: reconexão BLE quebrando depois da primeira

Desde a v0.1.2, toda vez que a conexão BLE sobe (primeira vez ou reconexão automática), o Wy Glass fala uma saudação (`smart_agent.greeting_text()` — mesma frase determinística "Bom dia/Boa tarde/Boa noite, {nome}..." usada na ativação por voz, sem chamar o Groq) como confirmação audível, sem precisar apertar nenhum botão. Implementado em `_speak_connect_greeting()`/`_connect_greeting_blocking()`, disparado como uma task solta logo após `state.connected = True` em `ble_manager()`.

**Bug descoberto no processo (e corrigido na mesma versão)**: depois que a escuta passiva (`passive_listening.enabled`) disparava pela primeira vez, toda reconexão BLE seguinte passava a falhar com `bleak.exc.BleakError: Thread is configured for Windows GUI but callbacks are not working` — um erro *diferente* do conflito de DLL do onnxruntime (§4.8), embora do mesmo gênero (conflito de inicialização de biblioteca nativa do Windows).

**Causa raiz**: `passive_listener.py` importava `audio_capture` (que importa `sounddevice`) no **topo do arquivo**. `PassiveListener.start()` é chamado direto (síncrono) de dentro da coroutine `ble_manager()` — ou seja, o `import passive_listener` (e a cadeia de imports que ele dispara) rodava na **thread do event loop asyncio**. A inicialização do backend WASAPI do `sounddevice`/PortAudio no Windows deixa a *thread que fez o import* presa em COM modo STA ("apartamento de thread única", o modo usado por aplicações com janela/GUI). O `bleak` (via WinRT) exige MTA (COM multi-thread) nessa mesma thread do event loop pra escanear dispositivos — uma vez que a thread já está em STA, toda chamada `BleakScanner.find_device_by_address()` seguinte (ou seja, toda reconexão) falha, permanentemente, até reiniciar o processo inteiro.

Isso ficou mascarado por muito tempo porque só se manifesta depois que *algo* importa `sounddevice` na thread do event loop pela primeira vez — o que só passou a acontecer de forma consistente com a escuta passiva ativada, e só na segunda tentativa de conexão em diante (a primeira sempre funciona, o dano só afeta reconexões futuras).

**Correção**: mover o `import audio_capture` de `passive_listener.py` pro **dentro** de `PassiveListener._run()` — o método que já roda numa `threading.Thread` dedicada, não na thread do event loop. Mesmo cuidado replicado nas duas novas funções que falam (`_speak_blocking`, usada por `stop_conversation`; `_connect_greeting_blocking`, usada pela saudação de conexão): o `import jarvis` (que também importa `sounddevice`) agora está sempre dentro da função passada pra `loop.run_in_executor(...)`, nunca solto no corpo de uma `async def` chamada direto na thread do event loop.

**Lição geral pro resto do código**: qualquer `import` que puxe `sounddevice` (`jarvis.py`, `audio_capture.py`) só pode acontecer dentro de uma função que roda via `run_in_executor` ou numa `threading.Thread` própria — nunca inline no corpo de uma coroutine `async def`, mesmo que pareça inofensivo (a primeira execução "funciona", o estrago só aparece na próxima tentativa de reconexão BLE).
