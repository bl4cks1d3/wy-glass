# 3. Metodologia da engenharia reversa

Este documento registra o processo real usado para decodificar o protocolo, incluindo os becos sem saída — útil como estudo de metodologia de engenharia reversa de hardware BLE, não só como referência técnica.

## 3.1 Passo 1 — Confirmar o que já funciona "de graça"

Antes de qualquer engenharia reversa, testamos o caminho mais simples: parear o dispositivo direto no Windows (`Configurações > Bluetooth > Adicionar dispositivo`). Resultado: o Windows reconheceu como headset Bluetooth clássico (A2DP + HFP) — **áudio (microfone e alto-falante) já funcionava sem nenhum hacking**, porque óculos desse tipo geralmente implementam os perfis Bluetooth clássicos padrão.

O que faltava era o **botão físico** disparar alguma coisa customizada no PC — isso exigia entender o canal BLE proprietário.

## 3.2 Passo 2 — Captura de tráfego real (celular + app oficial)

1. Ativar Opções do Desenvolvedor no Android e ligar "Ativar log de rastreamento Bluetooth HCI" (grava todo o tráfego Bluetooth em `btsnoop_hci.log`).
2. Conectar o celular ao PC via `adb` (USB debugging).
3. Reiniciar o Bluetooth do celular para começar um log limpo.
4. Usar o app oficial normalmente (apertar o botão, testar variações) enquanto o log grava.
5. Extrair o log com `adb bugreport` (contém o `btsnoop_hci.log` mesmo sem root).
6. Extrair o APK do app oficial (`adb shell pm path <pacote>` + `adb pull`) para análise complementar.

## 3.3 Passo 3 — Parsear o log manualmente

Não havia Wireshark disponível, então escrevemos um parser Python do zero para o formato `btsnoop`:

- Cabeçalho de 16 bytes (`btsnoop\0` + versão + tipo de link).
- Registros de 24 bytes (tamanho original, tamanho incluído, flags, drops, timestamp) seguidos pelo pacote HCI cru.
- Pacotes ACL (tipo `0x02`) precisam de **remontagem de fragmentos** (flag PB no campo de handle) antes de interpretar como L2CAP/ATT — erro comum no início foi não remontar fragmentos, o que gerava "pacotes gigantes" falsos misturando fragmentos de mensagens diferentes.
- Depois de remontado, o payload ATT revela o opcode (`WriteCommand`, `HandleValueNotification`, etc.) e o valor bruto — foi aí que os prefixos `0xBC` começaram a aparecer.

**Lição**: ao escrever um parser de protocolo binário do zero, sempre implementar a remontagem de fragmentação antes de tentar interpretar semântica — payloads "estranhos" costumam ser bug de parsing, não dado real.

## 3.4 Passo 4 — Reproduzir direto do PC (sem o celular)

Depois de identificar os UUIDs de serviço/characteristic na captura, conectamos direto do PC via `bleak`, desconectando o celular primeiro (o chip BLE só aceita uma conexão de central por vez — enquanto o celular estiver conectado, o dispositivo para de anunciar e o PC não consegue encontrá-lo no scan).

Isso permitiu testar em tempo real: segurar o botão enquanto um script Python escutava notificações, comparando o que chegava com o que a captura do celular tinha mostrado.

## 3.5 Passo 5 — A armadilha da "pressão longa"

A hipótese inicial (baseada em uma primeira captura de sucesso) foi: **clique curto = ação simples, pressão longa (~3-4s) = ativa modo de voz**. Isso pareceu se confirmar em alguns testes, mas falhou repetidamente em tentativas seguintes — o mesmo gesto ora funcionava, ora não.

Hipóteses testadas e descartadas, em ordem:

1. *"Talvez precise do handshake de inicialização que o app manda"* — replicamos a sequência de comandos de conexão do app oficial; não fez diferença.
2. *"Talvez precise da conexão clássica (áudio) também estar ativa"* — confirmamos que estava, mesmo assim inconsistente.
3. *"Talvez seja um cooldown do firmware"* — não havia padrão de tempo consistente entre sucessos e falhas.
4. **A real explicação, encontrada só depois de consultar o manual oficial do fabricante**: o gatilho de "Despertar IA" é um **clique simples**, não uma pressão longa. O sinal `bc0303` que vínhamos chamando de "início de voz" é, na verdade, simplesmente **o evento de clique do botão** — sempre confiável, porque nunca dependeu de duração alguma. A inconsistência que observávamos era apenas o resultado de estarmos testando um gesto (pressão longa) que **não corresponde a nenhuma função documentada do dispositivo**.

**Lição maior do projeto**: quando um sinal de hardware parece "flakey" de forma inexplicável, considerar a hipótese de que a interpretação do que o sinal *significa* está errada, antes de assumir que o hardware é não-confiável. Consultar a documentação oficial do fabricante (mesmo que superficial) pode economizar horas de tentativa e erro.

## 3.6 Passo 6 — Descobrir que existem dois botões

Um teste em que o usuário mencionou "1 e 2" revelou que o dispositivo tem **dois botões físicos**, não um. Voltando à captura, o byte que variava entre `01` e `02` no payload `bc0303` — que antes parecia ruído/checksum — na verdade identifica qual botão foi apertado. Essa foi a peça que faltava para reconciliar todas as observações anteriores.

## 3.7 Passo 7 — Análise do APK (contexto complementar)

Usamos [`androguard`](https://github.com/androguard/androguard) para procurar referências a `android.bluetooth` no `classes.dex` do app oficial — **zero ocorrências**. Isso revelou que a lógica de comunicação Bluetooth do app está inteiramente em uma **biblioteca nativa** (não no código Java/Kotlin), inviabilizando decompilação rápida da lógica exata de tratamento do botão. Essa foi a razão para depender inteiramente de captura de tráfego + o manual oficial, em vez de ler o código-fonte do app.

Também extraímos strings do APK (`assets/`) que revelaram pistas valiosas sem precisar decompilar nada:

- `sherpa-ncnn-streaming-zipformer-bilingual-zh-en` — modelo de ASR local, só chinês/inglês (explica a dificuldade com português).
- `libjl_opus.so`, `libjl_speex.so` — chipset Jieli.
- SDK da Aliyun (Alibaba Cloud) — backend de nuvem chinês.

## 3.8 Ferramentas usadas neste projeto

| Ferramenta | Uso |
|---|---|
| `adb` (Android SDK platform-tools) | Extrair log BLE e APK do celular |
| Parser Python customizado | Decodificar formato `btsnoop_hci.log` |
| [`bleak`](https://pypi.org/project/bleak/) | Cliente BLE multiplataforma em Python |
| [`androguard`](https://pypi.org/project/androguard/) | Análise estática do APK (strings, referências de classe) |
| Manual oficial do fabricante | Confirmação definitiva do mapeamento de gestos |

## 3.9 O que faríamos diferente

- Consultar o manual oficial do fabricante **antes** de investir tempo em hipóteses de "pressão longa" — está publicamente disponível e teria economizado a etapa mais longa do projeto.
- Ao montar um parser de protocolo binário do zero, escrever a remontagem de fragmentação ACL/L2CAP desde a primeira versão.
- Testar variações de gesto (curto/longo/duplo) em blocos isolados e cronometrados desde o início, em vez de misturar vários gestos em uma única janela de captura — dificulta correlacionar timestamp com ação.
