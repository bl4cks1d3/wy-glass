# 10. App Android

APK que conecta os óculos via BLE e roda o assistente de voz **inteiramente no celular** — grava pelo microfone Bluetooth, pergunta direto ao Gemini, e responde com uma voz **Piper** local (mesma voz `faber-medium` usada no lado PC). Não depende do servidor PC para funcionar (mas ainda sabe usá-lo como alternativa, ver §10.6).

## 10.1 Por que essa arquitetura (e por que mudou)

**v0.1**: o app só detectava o clique via BLE e repassava pro servidor Python do PC (`POST /api/test/{gesture}`) — o celular era uma ponte BLE, o "cérebro" continuava no PC.

**v0.2**: ao testar a v0.1 pela rede, o servidor do PC precisava aceitar conexões de outros dispositivos (`0.0.0.0` em vez de `127.0.0.1`) — e isso expõe endpoints sem nenhuma autenticação (`run_command` executa comando arbitrário, `/api/config` devolve a chave do Gemini em texto puro) pra qualquer coisa na mesma rede Wi-Fi. Em vez de abrir esse risco, o app passou a ser **autossuficiente**: grava, pergunta ao Gemini e fala a resposta tudo dentro do próprio processo do Android. Nessa versão o TTS usado era o motor nativo do Android (`TextToSpeech`).

**v0.3**: trocado o TTS nativo pelo **Piper de verdade**, rodando local no celular via [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) — ver §10.3. Essa versão tinha um bug que fechava o app sozinho pouco depois de abrir — corrigido na v0.3.1, ver §10.3.1.

**v0.3.1**: corrigido o fechamento sozinho — causa raiz e diagnóstico em §10.3.1.

**v0.4**: corrigido o corte de fala no meio da frase (§10.11), gravação por detecção de silêncio em vez de tempo fixo (§10.12), palavra de ativação "sankofa" com escuta contínua (§10.13), e interface redesenhada — tela principal minimalista (só o desenho dos óculos + status) com um painel de configurações separado (§10.14).

**v0.4.1**: corrigido o roteamento de áudio durante a escuta da palavra de ativação — o app estava desconectando dos óculos e passando a ouvir/falar pelo alto-falante e microfone do próprio celular (§10.15).

**v0.5**: suporte a múltiplos provedores de IA além do Gemini — Groq, OpenRouter, Mistral e Ollama (local no PC), todos gratuitos/open-weight (§10.16).

**v0.5.1**: corrigido o áudio saindo pelo celular em vez dos óculos ao usar provedores não-Gemini (regressão introduzida pela v0.5 — o `SpeechRecognizer` usado pra transcrever a pergunta derrubava a conexão SCO sem avisar), e adicionado controle de volume da resposta (§10.17).

**v0.6**: `AgentTools.kt` — porta em Kotlin do `search`/`open_url` do agente unificado do PC (`smart_agent.py`), dando ao provedor Groq a mesma ferramenta de busca (clima/câmbio/cripto/feriados/Tavily/Wikipedia) que o PC tem, sem depender do servidor (§10.18 explica o que ficou de fora e por quê). Também: interface redesenhada (identidade visual "HUD óptico" — reticulo tipo mira de câmera ao redor dos óculos, fonte Space Grotesk, telas organizadas em painéis, ver §10.19), e documentado o fluxo de build/instalação local (§10.20).

**v0.7** (atual): consciência de hora real e ferramenta `open_app` (§10.21) — o assistente agora sabe a data/hora reais do celular em toda resposta (não só ao acordar) e consegue abrir qualquer app instalado por nome, não só páginas web.

O fallback pro servidor PC continua existindo (útil se um dia quisermos as ações mais elaboradas do `actions.py`, tipo abrir programas), mas só é usado se **nenhuma chave do Gemini** estiver configurada no app.

## 10.2 Estrutura do projeto

```
android-app/
├── settings.gradle.kts
├── build.gradle.kts
├── gradle.properties
├── local.properties          # aponta pro SDK local (nao versionar — caminho especifico da maquina)
└── app/
    ├── build.gradle.kts
    ├── libs/
    │   └── sherpa-onnx-1.13.4.aar
    └── src/main/
        ├── AndroidManifest.xml
        ├── assets/tts/                 # modelo de voz Piper (ver 10.3)
        ├── java/com/wyglass/app/
        │   ├── MainActivity.kt        # UI: config (persistida), botao conectar/desconectar, log ao vivo
        │   ├── BleBridgeService.kt    # BLE + orquestra conversa/fallback, roda como foreground service
        │   └── LocalJarvis.kt         # gravação (mic BT), chamada ao Gemini, TTS Piper — tudo no celular
        └── res/
            ├── layout/activity_main.xml
            └── values/{strings,themes}.xml
```

## 10.3 Piper local via sherpa-onnx

Rodar o Piper de verdade no Android exige duas peças: o motor de inferência (ONNX Runtime) e a fonemização de texto (Piper depende do `espeak-ng`, uma lib em C). Compilar isso do zero exigiria Android NDK + build do espeak-ng + build do onnxruntime — só que o projeto [**sherpa-onnx**](https://github.com/k2-fsa/sherpa-onnx) já publica tudo pronto:

- **AAR pré-compilado**: `sherpa-onnx-1.13.4.aar`, baixado direto das releases do GitHub (`app/libs/`) — contém o wrapper JNI + `libonnxruntime.so` para as 4 ABIs (arm64-v8a, armeabi-v7a, x86, x86_64), sem precisar de NDK nem compilar nada.
- **Modelo de voz pronto**: sherpa-onnx também publica os modelos Piper já convertidos pro formato deles (`.onnx` + `tokens.txt` + `espeak-ng-data/`). Usamos `vits-piper-pt_BR-faber-medium-int8` (versão quantizada int8, ~18MB, mesma voz do lado PC) — baixado das releases tag `tts-models` e colocado em `app/src/main/assets/tts/`.

```
app/src/main/assets/tts/
├── model.onnx              # ~18MB, voz pt_BR-faber-medium int8
├── tokens.txt
└── espeak-ng-data/         # ~18MB, fonemizacao (todas as linguas do espeak-ng)
```

API usada (`com.k2fsa.sherpa.onnx.OfflineTts`):

```kotlin
val config = OfflineTtsConfig(
    model = OfflineTtsModelConfig(
        vits = OfflineTtsVitsModelConfig(
            model = "tts/model.onnx", tokens = "tts/tokens.txt",
            dataDir = "tts/espeak-ng-data", lexicon = "", dictDir = "",
            noiseScale = 0.667f, noiseScaleW = 0.8f, lengthScale = 1.0f,
        ),
        numThreads = 2, debug = false, provider = "cpu",
    ),
    ruleFsts = "", ruleFars = "", maxNumSentences = 2, silenceScale = 0.2f,
)
val tts = OfflineTts(context.assets, config)
val audio = tts.generate(texto, 0, 1.0f)   // -> GeneratedAudio(samples: FloatArray, sampleRate: Int)
```

O áudio gerado (`FloatArray` PCM) é tocado direto via `AudioTrack` (`ENCODING_PCM_FLOAT`), sem precisar decodificar nada — resultado vai pro alto-falante Bluetooth ativo no momento (os óculos).

**Custo**: o APK cresceu de ~15MB pra ~84MB (bibliotecas nativas de 4 ABIs + os 36MB de assets do modelo). Otimização possível: gerar um APK só pra `arm64-v8a` (a esmagadora maioria dos celulares reais), cortando as outras 3 ABIs não usadas — ver §10.9.

**Achado no processo**: o build do Gradle falhou duas vezes com erro de "não foi possível apagar diretório" no meio do processo (arquivo travado, provavelmente por indexação/antivírus do Windows escaneando os arquivos novos de 18-48MB recém-baixados). Solução: `gradle --stop` pra matar o daemon, e apagar a pasta `app/build` manualmente (via PowerShell `Remove-Item -Recurse -Force`, que teve mais sucesso que o `rm -rf` do bash nesse caso) antes de recompilar.

### 10.3.1 Bug: app fechava sozinho (corrigido na v0.3.1)

**Sintoma**: o app abria normal, mas fechava sozinho poucos segundos depois, sem aviso.

**Diagnóstico**: como não dava pra reproduzir de forma controlada no celular físico, subimos um **emulador Android** (AVD já existente na máquina, `emulator -avd radim`) só pra conseguir capturar o `adb logcat` no momento exato da queda — no aparelho físico não tínhamos esse log.

O logcat revelou o aviso exato vindo do sherpa-onnx:

```
sherpa-onnx: You need to follow our examples to copy the espeak-ng-data directory
             from the assets folder to an external storage directory.
```

**Causa raiz**: a lib nativa do espeak-ng (usada pelo sherpa-onnx pra fonemização) faz leitura de arquivo em C puro (`fopen`), que não funciona contra o sistema de arquivos "virtual" dos assets empacotados dentro do APK — só contra caminhos reais em disco. Passar `dataDir = "tts/espeak-ng-data"` (um caminho de asset) fazia a inicialização nativa demorar ~15s e então o processo morria (`exited cleanly (1)` no log — sem stack trace Java, porque é um `abort()`/`exit()` do lado nativo C++, não uma exceção Java capturada pelo runtime).

**Correção** (`LocalJarvis.kt`):
1. No primeiro uso, copia `assets/tts/espeak-ng-data/` inteiro para `context.filesDir/espeak-ng-data` (armazenamento interno real do app) recursivamente, e passa esse caminho absoluto como `dataDir` em vez do caminho de asset.
2. `jarvis.init()` (que faz essa cópia + carrega o modelo, ~15-20s no total) passou a rodar numa thread de fundo (`jarvisExecutor`) em vez de bloquear a thread principal do `BleBridgeService.onCreate()` — bloquear a main thread por tanto tempo também contribuía pro problema (risco de ANR).

Depois da correção, o app ficou estável por 20+ segundos no emulador sem cair (o teste anterior sempre morria por volta dos 15s).

**Limitação do teste com emulador**: o emulador não tem hardware Bluetooth real, então não dá pra testar a conexão de verdade com os óculos nele — serviu só pra isolar e corrigir esse bug de inicialização do TTS. A validação final (conectar nos óculos, ouvir a voz) ainda precisa do celular físico.

## 10.4 Como o pipeline local funciona (`LocalJarvis.kt`)

1. **Gravação**: liga o SCO do Bluetooth (`AudioManager.startBluetoothSco()`) pra rotear o microfone dos óculos, grava ~6 segundos via `AudioRecord` (PCM 16kHz mono), embrulha num WAV manualmente (cabeçalho de 44 bytes escrito à mão, sem biblioteca extra).
2. **Gemini**: mesma chamada REST usada no lado Python (`generateContent`, áudio em `inline_data` base64) — implementada com `HttpURLConnection` + `org.json` (ambos nativos do Android, sem dependência nova).
3. **TTS**: Piper local via sherpa-onnx (§10.3) — gera o áudio e toca via `AudioTrack`.

## 10.5 Botão 1 / Botão 2 — mesma semântica do servidor PC

- **Botão 1**: se houver uma chave do Gemini configurada, inicia o loop conversacional (grava → pergunta → fala → repete). Caso contrário, cai no fallback e chama o servidor PC (se uma URL estiver configurada).
- **Botão 2**: encerra a conversa em andamento. Se não houver conversa ativa, também tenta o fallback pro servidor PC.

## 10.6 Configuração (persistida entre aberturas)

O app salva em `SharedPreferences`:

- Endereço BLE dos óculos
- Google API Key (Gemini) — se vazio, usa o fallback do servidor PC
- URL do servidor PC (fallback)
- Palavra de ativação: ligada/desligada, e o texto da palavra (padrão `sankofa`)
- Prompt de sistema (personalidade do assistente)

Tudo isso agora vive na tela de Configurações (§10.14), não mais na tela principal.

## 10.7 Como foi compilado

Sem precisar de internet para o Gradle em si — já havia uma distribuição Gradle 8.11.1 em cache local (`~/.gradle/wrapper/dists/`), reaproveitada de outro projeto Android na máquina.

```bash
JAVA_HOME="C:/Program Files/Eclipse Adoptium/jdk-21.0.9.10-hotspot" \
  "<caminho-do-gradle-8.11.1>/bin/gradle.bat" assembleDebug
```

Requisitos:
- JDK 17+ (usamos o JDK 21 já instalado — **atenção**: se houver um Java 8 mais cedo no PATH, force `JAVA_HOME` explicitamente, senão o build falha por incompatibilidade de versão)
- Android SDK com `platforms;android-35` e `build-tools;34.0.0` (ou mais recentes) instalados
- Se o build falhar com erro de deletar diretório (arquivo travado), rodar `gradle --stop` e apagar a pasta `app/build` manualmente (via PowerShell `Remove-Item -Recurse -Force`, mais confiável que `rm -rf` nesse caso específico) antes de recompilar

APK gerado em: `app/build/outputs/apk/debug/app-debug.apk`

## 10.8 Como usar

1. Instalar o APK no celular (sideload — habilitar "fontes desconhecidas" se necessário).
2. Abrir o app, conceder as permissões solicitadas (Bluetooth + microfone + dispositivos próximos).
3. Tocar na engrenagem (⚙) no canto superior direito pra abrir as Configurações.
4. Conferir o campo "Endereço BLE dos óculos" (já vem pré-preenchido).
5. Preencher **"Google API Key (Gemini)"** para o app funcionar sozinho, sem depender do PC.
6. (Opcional) Ligar a palavra de ativação e ajustar a palavra (padrão `sankofa`).
7. Tocar em "Salvar e conectar" — volta pra tela principal já conectando.

A partir da próxima abertura do app, ele conecta sozinho automaticamente (não precisa mais entrar nas configurações de novo, a menos que quiera mudar algo).

## 10.9 Limitação importante: conexão BLE é exclusiva

O chip BLE dos óculos aceita **apenas um central conectado por vez** — o celular e o PC não podem estar conectados via BLE ao mesmo tempo (o áudio Bluetooth clássico é uma conexão separada e pode continuar ativo dos dois lados). Ao usar o app do celular, é preciso que o servidor Python do PC não esteja segurando a conexão BLE no momento (parar o processo ou deixá-lo falhar a reconexão).

## 10.10 Próximos passos possíveis

- APK só para `arm64-v8a` (cortar as outras 3 ABIs do sherpa-onnx, reduzindo o tamanho de ~84MB pra bem menos)
- Autodetecção do servidor PC na rede local (mDNS) em vez de digitar o IP manualmente
- Suporte a clique duplo/triplo
- Mecanismo de handoff automático entre PC e celular para a conexão BLE
- Trocar a palavra de ativação por um motor de wake-word de verdade (ver §10.13)

## 10.11 Bug: TTS cortava a fala no meio (corrigido na v0.4)

**Sintoma**: a resposta falada parava no meio da frase, sem terminar.

**Causa raiz**: `OfflineTtsConfig.maxNumSentences` estava configurado como `2` — esse parâmetro do sherpa-onnx limita quantas sentenças ele processa, então qualquer resposta do Gemini com mais de duas frases era cortada na sintetização, antes mesmo de chegar no alto-falante. Não era um problema de reprodução de áudio (como tínhamos corrigido no lado PC com o buffer do Bluetooth) — era a própria síntese que já saía incompleta.

**Correção**: `maxNumSentences` subiu para `20`. Também foi adicionado um pequeno trecho de silêncio no final do áudio antes de tocar (mesma lição do lado PC — o Bluetooth clássico tem buffer/latência própria e pode cortar a cauda do áudio se o player parar cedo demais).

## 10.12 Gravação por detecção de silêncio (VAD)

Portado o mesmo algoritmo do lado PC (`jarvis.py:record_audio_vad`) pro Kotlin: grava em blocos de ~30ms, calcula a energia (RMS) de cada bloco, e só considera "silêncio" depois de detectar fala de verdade — parando a gravação após ~1.2s de silêncio contínuo. Teto de segurança de 20s pra nunca gravar indefinidamente. Isso substitui a gravação de duração fixa (~6s) que existia antes, então tanto uma pergunta curta quanto uma explicação mais longa são capturadas por inteiro.

## 10.13 Palavra de ativação ("sankofa")

**Como funciona**: em vez de um motor de wake-word dedicado (que precisaria de um modelo treinado especificamente pra essa palavra — não é uma palavra comum em nenhum dataset público de wake-word), o app reaproveita o reconhecimento de voz nativo do Android (`SpeechRecognizer`), reiniciando-o em loop continuamente e conferindo se o texto reconhecido contém a palavra configurada. Quando `wakeWordEnabled` está ligado e os óculos estão conectados (mas sem conversa em andamento), o app fica nesse loop de escuta; ao detectar a palavra, para a escuta e inicia a conversa exatamente como um clique no botão 1.

**Trade-off assumido conscientemente**: isso não é um wake-word engine de baixo consumo de bateria de verdade (tipo Porcupine ou openWakeWord com um modelo `.onnx` treinado pra "sankofa" especificamente) — usa o reconhecimento de voz completo do Google rodando o tempo todo, o que consome mais bateria e pode ter menos precisão pra uma palavra fora do comum. Foi a opção viável de implementar imediatamente sem precisar treinar um modelo customizado. Ver `WakeWordListener.kt`.

**Convivência com o botão físico**: o botão 1 continua funcionando normalmente mesmo com a palavra de ativação ligada — são dois gatilhos independentes pro mesmo `startConversation()`. Durante uma conversa ativa, a escuta da palavra de ativação fica pausada (não faz sentido escutar as duas coisas ao mesmo tempo, e evita competir pelo microfone).

## 10.14 Interface redesenhada: tela principal minimalista + configurações

**Tela principal** (`activity_main.xml` / `MainActivity.kt`): só o desenho vetorial dos óculos (`ic_glasses.xml`, o mesmo estilo usado no painel web do PC), um anel pulsante ao redor quando conectado/ouvindo, o status atual (Conectado/Desconectado/Ouvindo "sankofa".../Conversando...), a última coisa dita/ouvida numa linha pequena embaixo, e um ícone de engrenagem (⚙) no canto pra abrir as configurações. Conecta sozinho automaticamente ao abrir (usando a config salva), sem precisar apertar nenhum botão.

**Tela de configurações** (`activity_settings.xml` / `SettingsActivity.kt`): todos os campos que antes ficavam na tela principal — endereço BLE, chave do Gemini, URL do servidor PC, palavra de ativação (liga/desliga + texto), prompt de sistema — mais o log ao vivo detalhado (que saiu da tela principal). Botão "Salvar e conectar" grava tudo e volta pra tela principal.

## 10.15 Bug: escuta da palavra de ativação desviava o áudio pro celular (corrigido na v0.4.1)

**Sintoma relatado**: com a palavra de ativação ligada, ao entrar no modo de escuta o app parava de usar o microfone/alto-falante dos óculos e passava a ouvir e falar pelo próprio celular — como se tivesse "desconectado do fone".

**Causa raiz**: existiam dois problemas relacionados em `LocalJarvis.kt` e `WakeWordListener.kt`:

1. `recordWavVad()` ativava a rota Bluetooth SCO (`startBluetoothSco()`) no início da gravação, mas **desativava** ela (`stopBluetoothSco()`) logo no final da própria função — antes de `askGemini()` e `speakBlocking()` rodarem em `runTurn()`. Ou seja, a resposta falada sempre saía depois da rota SCO já ter sido derrubada, caindo de volta no alto-falante do celular.
2. `WakeWordListener` (que usa o `SpeechRecognizer` nativo do Android) nunca ativava a rota SCO — ele simplesmente usava o que estivesse ativo no momento, que por padrão é o microfone do celular.

**Correção**: centralizado o controle da rota de áudio em dois métodos idempotentes de `LocalJarvis`: `ensureBtScoRoute()` (ativa o modo `MODE_IN_COMMUNICATION` + SCO, com uma pausa de 800ms só na primeira ativação) e `releaseBtScoRoute()` (desativa). Agora:

- `BleBridgeService.maybeStartWakeWordListening()` chama `jarvis.ensureBtScoRoute()` **antes** de iniciar o `SpeechRecognizer`, garantindo que a escuta da palavra de ativação já nasça usando o microfone dos óculos.
- `recordWavVad()` não derruba mais a rota SCO no final — ela permanece ativa durante todo o ciclo escuta → gravação → resposta falada.
- `speakBlocking()` chama `ensureBtScoRoute()` de novo antes de tocar o áudio, como segurança extra (idempotente, não tem custo se já estiver ativa).
- A rota só é liberada (`releaseBtScoRoute()`) quando a sessão fica realmente ociosa: em `BleBridgeService.disconnect()` e no callback de desconexão BLE (`STATE_DISCONNECTED`).

Efeito colateral esperado e desejado: como consequência dessa correção, a própria detecção da palavra "sankofa" deve melhorar — antes o `SpeechRecognizer` podia estar ouvindo o microfone errado (do celular, possivelmente abafado dentro de um bolso/mesa) em vez do microfone dos óculos.

## 10.16 Múltiplos provedores de IA (v0.5)

**Motivação**: até a v0.4.1 o app só falava com o Gemini. Pra abrir o leque de opções gratuitas/open-source (e não depender de um único provedor), o app agora suporta 5 opções, escolhidas na tela de configurações (`AiProvider.kt`):

| Provedor | Modelo padrão | Chave necessária | Observação |
|---|---|---|---|
| Gemini (Google) | `gemini-2.5-flash` | Google AI Studio | Único que recebe o áudio bruto diretamente (sem transcrição local) |
| Groq | `llama-3.3-70b-versatile` | console.groq.com | Free tier bem generoso, extremamente rápido, roda modelos open-weight (Llama, Qwen, GPT-OSS) |
| OpenRouter | `meta-llama/llama-3.3-70b-instruct:free` | openrouter.ai/keys | Agrega vários modelos open-weight com variantes `:free` (Llama, DeepSeek, Qwen) |
| Mistral (La Plateforme) | `mistral-small-latest` | console.mistral.ai | Tier gratuito "Experiment" da própria Mistral, modelos abertos |
| Ollama | `llama3.2` | nenhuma (roda local) | 100% local — precisa do Ollama rodando no PC (`ollama serve`) e do celular na mesma rede; usa o campo "IP do PC" em vez de chave |

**Arquitetura — por que só o Gemini recebia áudio direto**: o Gemini tem uma API multimodal que aceita áudio como entrada. Nenhum dos outros quatro provedores aceita — todos são só-texto (chat completions no formato OpenAI). Em vez de integrar quatro SDKs diferentes, `LocalJarvis.askOpenAiCompatible()` cobre os quatro de uma vez só (Groq, OpenRouter, Mistral e Ollama falam exatamente o mesmo formato REST `POST /chat/completions`), variando só a URL base, a chave e o modelo.

**De onde vem o texto pra esses quatro, já que eles não ouvem áudio?** De um novo `Transcriber.kt`, que reaproveita o mesmo mecanismo do `WakeWordListener` (o `SpeechRecognizer` nativo do Android) — mas em vez de só checar se apareceu uma palavra-chave, captura a frase inteira dita pelo usuário e devolve como texto. O endpointer do próprio `SpeechRecognizer` decide quando a pessoa parou de falar, então isso continua suportando perguntas de qualquer duração sem precisar de VAD manual — mesma garantia que já existia pro Gemini (§10.12), só que por outro caminho. Antes de transcrever, `Transcriber` chama a mesma `ensureBtScoRoute()` usada em todo o resto do pipeline (§10.15), garantindo que a pergunta seja ouvida pelo microfone dos óculos.

**Ollama é o único sem chave**: como roda localmente no PC do usuário, não tem autenticação — só precisa do IP/host do PC na mesma rede Wi-Fi (campo específico nas configurações, escondido quando outro provedor está selecionado). É o único cenário onde o app volta a depender do PC, mas só para a inferência do modelo — a gravação, a transcrição e a fala continuam 100% no celular.

**Lado PC (`jarvis.py`)**: a mesma lógica foi espelhada no servidor Python — `PROVIDER_CHAT_URLS`, `PROVIDER_DEFAULT_MODELS`, `ask_chat_provider()` e `ask_groq_whisper()` (usada como STT pros quatro provedores não-Gemini, já que o servidor não tem um `SpeechRecognizer` do Android à disposição — ver §6.2 de `06-referencia-acoes.md`). Selecionável no painel web (`static/index.html`) por um dropdown novo no card do gesto `jarvis_voice_agent`.

**Modelo local no celular (LiteRT-LM) — pesquisado, não implementado**: também foi avaliada a opção de rodar um LLM inteiro offline no celular (sem internet, sem chave nenhuma), via [LiteRT-LM](https://github.com/google-ai-edge/LiteRT-LM) (sucessor do antigo MediaPipe LLM Inference API, que está em modo manutenção). Ficou de fora nesta versão porque o celular usado nos testes tem só ~3.5 GB de RAM total, bem abaixo dos 8 GB+ recomendados pelo Google pra rodar até o menor modelo (Gemma3-1B) com folga — o risco de crash/OOM é alto. A arquitetura de provedores (`AiProvider` enum) já deixa espaço pra adicionar um provedor `LOCAL` no futuro se um celular mais robusto entrar no projeto.

## 10.18 Paridade de ferramentas com o agente unificado do PC (v0.6)

O `smart_agent.py` do PC (§11) dá ao Groq 5 ferramentas via function calling: `search`, `open_url`, `see_screen`, `get_news`, `open_dashboard`. `AgentTools.kt` porta só as duas primeiras:

| Ferramenta (PC) | No app Android? | Motivo |
|---|---|---|
| `search` | Sim — mesma cadeia de fallback (clima/wttr.in → câmbio/Frankfurter → cripto/CoinGecko → feriados/Nager.Date → Tavily → Wikipedia) | Portável 1:1, sem dependência nativa |
| `open_url` | Sim — via `Intent.ACTION_VIEW` | Portável 1:1 |
| `see_screen` | Não | Tira print da **tela do PC** — conceito não existe no celular (seria a câmera, não a tela) |
| `open_dashboard` | Não | Abre o painel web do servidor **no PC** — sem sentido standalone no celular |
| `get_news` | Não | No PC usa Playwright (navegador headless) pra renderizar `worldmonitor.app` — não existe headless browser no Android; portar exigiria trocar a fonte por uma API de notícias com chave própria |

Isso não é uma regressão — é o teto do que faz sentido replicar num app standalone rodando só com `HttpURLConnection`/`org.json` (ver §10.16, mesmo raciocínio já usado pros provedores de IA). Se `get_news` for necessário no celular no futuro, o caminho é trocar a fonte por uma API JSON (ex.: NewsAPI, GNews) em vez de tentar portar o scrape com Playwright.

## 10.19 Redesign visual: identidade "HUD óptico" (v0.6)

A UI original (`RelativeLayout` simples, cores soltas em hex, sem fonte customizada) foi refeita em cima de um sistema de tokens, mantendo os mesmos `id`s de view (nenhuma mudança em `MainActivity.kt`/`SettingsActivity.kt` foi necessária além do próprio XML):

- **Paleta** (`res/values/colors.xml`): `bg_void` (#05080A, fundo), `panel`/`panel_hi` (superfícies elevadas), `hairline` (bordas de 1dp), `ink`/`ink_dim`/`ink_faint` (texto), `signal` (#2BF5DA, ciano de marca — já existia, só documentado como token) e os estados `live`/`alert`.
- **Tipografia**: [Space Grotesk](https://github.com/google/fonts/tree/main/ofl/spacegrotesk) (fonte variável, `res/font/space_grotesk.ttf`) para wordmark/rótulos/botões, em 3 pesos via `fontVariationSettings` (`space_grotesk_regular/medium/bold.xml`); `monospace` do sistema pra qualquer leitura de dado (transcrição, log, endereço BLE) — mesma lógica de "fonte utilitária pra dado" que o terminal de log já usava antes do redesign.
- **Motivo de assinatura**: a tela principal ganhou uma mira estilo visor de câmera (`ic_reticle.xml`, 4 cantos em L) ao redor do ícone dos óculos, reforçando a ideia de "olhando através de um HUD" — o mesmo dispositivo físico é óculos com display óptico, então a moldura de mira não é decoração aleatória, é o próprio conceito do produto.
- **Configurações**: os campos soltos viraram painéis agrupados (`panel_bg.xml`) com rótulo eyebrow numerado (`01 · conexão`, `02 · inteligência`, ...) — a numeração reflete a ordem real de preenchimento recomendada (endereço → provedor/chaves → servidor fallback → voz → personalidade → log), não é decoração.

Nenhuma lógica de `SharedPreferences`, permissões, BLE ou TTS mudou — é troca de recurso visual (`res/layout`, `res/values`, `res/drawable`, `res/font`) por cima do código já existente.

## 10.20 Modo dev — compilar, instalar e depurar localmente

Passo a passo real usado nesta máquina (Windows), sem depender do Android Studio aberto:

**1. Pré-requisitos já resolvidos neste projeto:**
- JDK 17+ — usar `C:\Program Files\Eclipse Adoptium\jdk-21.0.9.10-hotspot` via `JAVA_HOME` explícito (o `java` do PATH pode ser um 8, que quebra o build com erro de versão do plugin do Android Gradle)
- Gradle 8.11.1 já em cache local em `~\.gradle\wrapper\dists\gradle-8.11.1-all\...\gradle-8.11.1\bin\gradle.bat` (não há `gradlew` versionado no projeto — usar esse binário direto)
- Android SDK em `%LOCALAPPDATA%\Android\Sdk` (já referenciado em `android-app/local.properties`)
- `adb` em `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`

**2. Compilar (debug):**
```bash
cd android-app
JAVA_HOME="C:/Program Files/Eclipse Adoptium/jdk-21.0.9.10-hotspot" \
  "$HOME/.gradle/wrapper/dists/gradle-8.11.1-all/<hash>/gradle-8.11.1/bin/gradle.bat" \
  assembleDebug --console=plain
```
APK gerado em `android-app/app/build/outputs/apk/debug/app-debug.apk`.

**Se falhar com "Unable to delete directory" / "Failed to delete some children"**: cache incremental corrompido (comum após trocar de ferramenta de build ou com antivírus escaneando arquivos novos — mesmo sintoma do §10.3). Solução que funciona de forma consistente:
```bash
"<gradle>/bin/gradle.bat" --stop   # mata o daemon que pode estar segurando um handle
rm -rf app/build build .gradle     # limpa tudo, não só app/build
# recompilar
```

**3. Instalar e rodar num aparelho físico via USB:**
```bash
adb devices                                   # confirma que o aparelho aparece como "device" (não "unauthorized")
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.wyglass.app/.MainActivity
```
`-r` reinstala preservando os dados do app (`SharedPreferences`, cache do TTS) — sem isso, cada reinstalação apaga a configuração salva.

**4. Ver a tela sem estar de frente pro aparelho** (útil rodando em background/headless):
```bash
adb shell screencap -p /sdcard/tela.png
adb pull /sdcard/tela.png ./tela.png
adb shell rm /sdcard/tela.png
```

**5. Pré-popular a configuração sem digitar tudo na mão de novo:**
O app guarda a config em `SharedPreferences` (`wyglass_prefs`, chaves em §10.6). Pra levar os valores que já existem no `config.json` do PC (endereço BLE, chave Groq, chave Tavily) pro app sem reabrir o teclado, dá pra escrever o XML de preferências direto no diretório privado do app — funciona porque builds `debug` são `debuggable="true"`, o que libera `run-as`:
```bash
adb shell am force-stop com.wyglass.app
adb push wyglass_prefs.xml /data/local/tmp/wyglass_prefs.xml
adb shell run-as com.wyglass.app mkdir -p shared_prefs
adb shell run-as com.wyglass.app cp /data/local/tmp/wyglass_prefs.xml shared_prefs/wyglass_prefs.xml
adb shell rm /data/local/tmp/wyglass_prefs.xml
```
**Importante**: isso só serve pra ambiente de dev/teste local — o `wyglass_prefs.xml` fica com as chaves de API em texto puro, então nunca deve ser versionado (mesma regra do `config.json`, já no `.gitignore`). É um atalho pra não redigitar credenciais durante testes manuais, não um mecanismo de distribuição de config.

**6. No Git Bash (MSYS) especificamente**: caminhos que começam com `/` (tipo `/data/local/tmp/...`) são reescritos automaticamente para caminhos do Windows pelo MSYS, quebrando comandos `adb shell`. Rodar `export MSYS_NO_PATHCONV=1` na sessão antes de qualquer `adb shell`/`adb push` que use caminho absoluto do Android.

## 10.21 Hora real e abrir apps por nome (v0.7)

**Hora/data real**: assim como o PC (`smart_agent.py::_now_str()`), o modelo não tem relógio próprio — sem isso ele "chuta" a hora ou (mais comum) evita responder perguntas de horário. `LocalJarvis.nowStr()` monta a mesma string do lado PC (`dia-da-semana, dd/mm/aaaa, hh:mm`, via `java.time`, disponível nativamente a partir da API 26) e `runTurn()` injeta ela no fim do system prompt **a cada turno** (não só na saudação de ativação), pros três caminhos de pergunta (Gemini, Groq com tools, e os provedores de chat simples).

**`open_app`**: nova ferramenta de function-calling (só no provedor Groq, mesma limitação de tool-calling documentada em §10.16) que abre qualquer app instalado pelo nome falado — "abre o whatsapp", "abre a câmera". Implementação (`AgentTools.openApp`):
1. Lista toda activity que responde a `ACTION_MAIN`/`CATEGORY_LAUNCHER` via `PackageManager.queryIntentActivities()`.
2. Casa o nome pedido contra o rótulo (label) de cada app — primeiro tentando igualdade exata, depois substring — ignorando acento e caixa (`Normalizer.Form.NFD` + strip de marcas diacríticas), já que o texto vem de reconhecimento de voz e "câmera" vs "camera" não pode ser a diferença entre funcionar ou não.
3. Lança via `PackageManager.getLaunchIntentForPackage()`.

**Pré-requisito de manifest**: a partir do Android 11 (API 30), `queryIntentActivities()` só enxerga um punhado de apps pré-aprovados a menos que o app declare visibilidade de pacotes (`<queries>` no `AndroidManifest.xml`) — sem isso, a busca praticamente sempre retorna vazio. Adicionado um bloco `<queries>` com o mesmo intent-filter `MAIN`/`LAUNCHER` usado na busca, dando visibilidade a qualquer app instalável (não precisa da permissão `QUERY_ALL_PACKAGES`, que é mais pesada e pensada pra apps na Play Store).

**Sem round-trip extra pra falar "abrindo X"**: como o resultado de `open_url`/`open_app` é só uma linha de status (não um dado que valha a pena o modelo reformular), a mesma otimização `skip_summary` do PC (`smart_agent.py::execute_tool`) foi replicada em `askGroqWithTools` — quando a única ferramenta chamada no turno é uma dessas duas, a resposta falada usa o texto que o modelo já tinha adiantado (ou o próprio resultado da ferramenta) em vez de fazer uma segunda chamada ao Groq só pra reescrever "Abrindo o WhatsApp." de outro jeito.
