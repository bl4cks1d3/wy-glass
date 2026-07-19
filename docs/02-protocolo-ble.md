# 2. Protocolo BLE (engenharia reversa)

## 2.1 Identificadores GATT

Descobertos conectando diretamente do PC via [`bleak`](https://github.com/hbldh/bleak) e fazendo descoberta de serviço, e confirmados cruzando com uma captura `btsnoop_hci.log` do celular (log de tráfego Bluetooth do Android).

| Item | Valor |
|---|---|
| Endereço BLE (desta unidade) | `53:88:97:31:A5:3A` |
| Nome anunciado | `W AI 4` |
| Serviço vendor (controle) | `000001ff-3c17-d293-8e48-14fe2e4da212` |
| Characteristic de escrita | `0000ff02-0000-1000-8000-00805f9b34fb` (write-without-response) |
| Characteristic de notificação | `0000ff03-0000-1000-8000-00805f9b34fb` (notify) |

Outros serviços vendor encontrados na descoberta GATT, não utilizados neste projeto:

- `cc353442-be58-4ea2-876e-11d8d6976366` (characteristic única `c551c36a-...`, propriedades exatas confirmadas: `write` + `read` + `notify`) — propósito não investigado.
- `0000ae00-0000-1000-8000-00805f9b34fb` (`ae01` = `write-without-response` / `ae02` = `notify`) — segundo canal de controle, propósito não investigado (possivelmente OTA de firmware; controle de câmera descartado, esta unidade não tem câmera).

**Sondagem passiva feita** (`probes/probe_both.py` + descoberta completa de GATT/leitura, ver §2.6): com a conexão BLE exclusiva liberada do servidor por ~1min, reconectado direto via `bleak` e:
- Lido `c551c36a` (o único desses dois canais que anuncia `read`) — retornou **vazio** (0 bytes). Não guarda nenhum valor por padrão.
- Assinado notificação nos três canais (`ff03` conhecido + `ae02` + `c551c36a`) e escutado 25s sem apertar nenhum botão — só o heartbeat já conhecido (`bc0703...`) disparou, no canal `ff03`. **Nenhuma emissão espontânea em `ae02` ou `c551c36a`** nesse intervalo — ou esses canais só respondem a um comando de entrada específico (write), ou só disparam sob alguma condição não reproduzida (ex: um evento de hardware específico, tipo um botão físico diferente, ou o processo de pareamento inicial).
- Escrita mínima de teste feita depois (1 byte `0x00` em cada canal, com checagem de "canário" — reler o nome do dispositivo — antes/depois de cada escrita): **nenhum efeito colateral** (dispositivo continuou conectado e respondendo normalmente), mas também **nenhuma reação observável** (nem notificação, nem mudança no valor lido de volta em `c551c36a`, que continuou vazio). Um único byte não é um comando válido de nenhum protocolo real — não chegou a ser um teste conclusivo do canal, só uma confirmação de que escrever nele não trava o dispositivo na hora.

### Identificação do SDK real (análise do APK oficial)

Com o app oficial (`com.njj.mactivepro`) puxado de um celular via `adb pull` e analisado (bibliotecas nativas do split `arm64-v8a` + `androguard` no `classes.dex`), essas duas descobertas fecham o mistério:

1. **O app está protegido por Alibaba Jiagu** (`libjiagu.so` presente) — o `classes.dex` (28MB) só expõe **37 classes** estaticamente; o código real (incluindo qualquer lógica de `android.bluetooth`) fica empacotado/criptografado e só é descompactado em memória em tempo de execução. Isso confirma e explica a descoberta original do `androguard` (§3.7 de `03-metodologia.md`, zero referências a `android.bluetooth`) — não é que a lógica só está em nativo, é que o Java real está *protegido*, invisível pra análise estática do APK.
2. **As bibliotecas nativas não são protegidas** e entregaram a resposta: `libjl_ota_auth.so` exporta `Java_com_jieli_jl_1bt_1ota_util_ParseDataUtil_nativeFilterFile`, `parse_fw_info`, `cd03_crc_encode`, `decrypt` — ou seja, o pacote Java por trás é **`com.jieli.jl_bt_ota`**, o SDK oficial de OTA Bluetooth da Jieli (fabricante do chipset, já identificado em `01-hardware.md`). Junto de `libjl_fatfs.so` (sistema de arquivos virtual, classe `DiskOpImpl` com `insertFile`/`replaceFile`/`write`) e `libjl_pack_format.so` (`PackResFormat`, parser de pacote de recurso/firmware), fica claro que **`ae00`/`ae01`/`ae02` é mesmo o canal de OTA de firmware** — a hipótese em aberto desde a descoberta inicial dos serviços.

**Confirmado publicamente**: o SDK `jl_bt_ota` é open-source — [`Jieli-Tech/Android-JL_OTA`](https://github.com/Jieli-Tech/Android-JL_OTA) no GitHub ("biblioteca de encapsulamento do fluxo de OTA implementado sobre o protocolo RCSP da Jieli"), com equivalente iOS em [`Jieli-Tech/iOS-JL_OTA`](https://github.com/Jieli-Tech/iOS-JL_OTA). Confirma exatamente os UUIDs vistos aqui: serviço `AE00`, característica de escrita `AE01`, característica de notificação `AE02`. O protocolo por trás é o **RCSP** (protocolo proprietário da Jieli, não documentado publicamente em detalhe de bytes, mas com implementação de referência completa nesses repositórios) — inclui autenticação de dispositivo, MTU configurável, e opcionalmente um cifrador de bloco proprietário da Jieli (256-byte SBOX, não é AES) com uma chave estática de 16 bytes.

**`cc353442-.../c551c36a` — tentativa de confirmação, resultado: genuinamente desconhecido, não é só nós.** A hipótese inicial era que fosse o canal de controle geral do ecossistema RCSP da Jieli (SDK irmão [`Jieli-Tech/Android-JL_Bluetooth`](https://github.com/Jieli-Tech/Android-JL_Bluetooth), "Jieli-Home", usado por caixa de som/fone/placa de som/estojo com tela). Não deu pra confirmar isso da mesma forma rigorosa que o canal OTA (nenhuma biblioteca nativa dedicada a esse UUID especificamente, e o literal do UUID não aparece em texto puro em nenhum lugar do APK — nem no `classes.dex`, nem nos recursos/assets, em ASCII ou UTF-16 — o que sugere que só existe dentro do bytecode protegido pelo Alibaba Jiagu, inacessível estaticamente).

Busca mais ampla revelou algo mais informativo: **esse exato par de UUIDs (`cc353442-be58-4ea2-876e-11d8d6976366` / `c551c36a-0377-4a29-9657-74ffb655a188`) aparece em vários outros produtos completamente não relacionados** — Huawei Band 8, Xiaomi Smart Band 8 Pro, Honor Choice Watch 2i — todos marcados como "unknown proprietary service" nos logs de descoberta desses projetos (incluindo o [Gadgetbridge](https://gadgetbridge.org/), o projeto open-source mais ativo de engenharia reversa de wearables, que também não decodificou esse serviço em nenhum desses pedidos de suporte a dispositivo). Ou seja: **não é um UUID específico da Jieli nem dos nossos óculos** — é algum componente/SDK de referência compartilhado por múltiplos fabricantes de wearables baratos, e continua sem decodificação pública conhecida mesmo com esforço dedicado de uma comunidade bem maior que este projeto. Não vale a pena insistir nisso sem uma captura de tráfego real do app oficial fazendo alguma ação que use esse canal — a mesma metodologia (btsnoop) que decifrou o protocolo do botão (ver `03-metodologia.md`), só que não sabemos qual ação do app aciona esse canal pra capturar.

**Próximo passo, se algum dia for retomado**: estudar o código-fonte aberto do `Android-JL_OTA`/`Android-JL_Bluetooth` pra entender o formato exato de pacote RCSP (em vez de continuar testando bytes às cegas no hardware real) — os repositórios têm demo + documentação de desenvolvimento completos. Só vale o esforço se houver um objetivo concreto (ex: querer trocar o firmware, ou usar algum recurso de controle que dependa desse canal) — não há ganho de funcionalidade óbvio pro Wy Glass hoje.

## 2.2 Formato geral dos pacotes

Todo pacote na characteristic de notificação começa com o byte mágico `0xBC`, seguido por um byte de "tipo de mensagem":

```
BC | TIPO | ... payload especifico do tipo ...
```

## 2.3 Tabela de mensagens decodificadas

| Prefixo (hex) | Tamanho | Significado | Confiabilidade |
|---|---|---|---|
| `bc 03 03 01 01 01` | 6 bytes | Clique no **botão 1 (Frente)** | Alta — 100% reprodutível |
| `bc 03 03 01 02 02` | 6 bytes | Clique no **botão 2 (Trás)** | Alta — 100% reprodutível |
| `bc 07 03 01 XX XX` | 6 bytes | Heartbeat/status periódico (ciclo ~60s) | N/A — não é evento de clique |
| `bc 09 03 ...` | variável, cresce ao longo do tempo | Telemetria interna (contadores incrementais) | N/A — não é evento de clique |
| `bc 01 03 ...` | 205 bytes | Resposta de informação do dispositivo (contém string `LNJ-W03-0.2.6` em ASCII) | — |

Os dois últimos bytes de `bc07` e o conteúdo de `bc09` variam e parecem ser um checksum/contador de sessão — não carregam significado de clique, apesar de superficialmente parecerem parte da mesma "família" de mensagens que `bc03`.

### Como identificar qual botão foi apertado

```
bc 03 03 01 [ID] [ID]
                ^^^^^^ mesmo byte repetido duas vezes:
                       0x01 = botão 1 (Frente)
                       0x02 = botão 2 (Trás)
```

### Handshake de conexão (visto na captura do celular, não obrigatório)

Ao conectar, o app oficial envia uma sequência de comandos de configuração (`bc79...`, `bc3e...`, `bc3c...`, `bc46...`, `bc48...`, `bc89...`, `bc65...`, `bc0a...`, `bc01...`, `bc11...`, `bc0d...`) — testamos reproduzir essa sequência às cegas (sem saber o significado exato de cada um) e confirmamos que **não é necessária** para o clique do botão funcionar. O dispositivo aceita conexão direta sem handshake.

## 2.4 Sinais que descartamos ou reinterpretamos

Durante o processo, alguns sinais foram inicialmente mal interpretados. Documentado aqui para não repetir o erro:

1. **`bc0303` não é "iniciar modo de voz por pressão longa"** — é simplesmente o evento de clique do botão (qualquer duração), identificado por qual botão foi apertado. A confusão inicial veio de correlacionar (por coincidência de tempo) esse sinal com testes de pressão longa.
2. **`bc0703` não é "fim de sessão"** — é um heartbeat automático e periódico (~60s), presente mesmo sem nenhuma interação do usuário. Inicialmente foi confundido com um evento de "clique simples" porque também aparece imediatamente após a conexão ser estabelecida (eco de status de conexão).
3. **O canal de áudio em stream via BLE** (frames de ~166 bytes, formato `bc0303a1034b41...`, vistos na primeira captura feita a partir do celular) não foi reproduzido nos testes feitos direto do PC — provavelmente porque o app oficial envia um ACK (`bc0302010101`) de volta ao dispositivo antes de o áudio começar a fluir, e o Wy Glass não precisa desse canal (usa o áudio Bluetooth clássico já pareado em vez do stream BLE proprietário).

## 2.5 Interação com Bluetooth clássico (AVRCP)

O botão físico **também** aciona comandos nativos AVRCP (play/pause de mídia) via a conexão Bluetooth clássica, de forma completamente paralela e independente do canal BLE. Isso significa:

- Um clique no botão de trás pausa/retoma qualquer mídia tocando no Windows (YouTube, Spotify, etc.), **independente** do que o Wy Glass está configurado para fazer.
- Esse comportamento vem do próprio firmware/driver Bluetooth do Windows, não é algo que controlamos ou conseguimos suprimir por software sem desabilitar o perfil AVRCP inteiro (o que também tiraria o controle de mídia legítimo).

## 2.6 Ferramentas e comandos úteis para reexplorar o protocolo

```python
# Descobrir serviços/characteristics de um dispositivo BLE
from bleak import BleakClient, BleakScanner
import asyncio

async def discover(address):
    device = await BleakScanner.find_device_by_address(address, timeout=15.0)
    async with BleakClient(device or address) as client:
        for service in client.services:
            print(f"[Service] {service.uuid}")
            for char in service.characteristics:
                print(f"   [Char] {char.uuid} props={char.properties}")

asyncio.run(discover("53:88:97:31:A5:3A"))
```

Ver [`03-metodologia.md`](03-metodologia.md) para o processo completo de captura e análise.
