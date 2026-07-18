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

**v0.5.1** (atual): corrigido o áudio saindo pelo celular em vez dos óculos ao usar provedores não-Gemini (regressão introduzida pela v0.5 — o `SpeechRecognizer` usado pra transcrever a pergunta derrubava a conexão SCO sem avisar), e adicionado controle de volume da resposta (§10.17).

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
