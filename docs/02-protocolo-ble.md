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

- `cc353442-be58-4ea2-876e-11d8d6976366` (characteristic única `c551c36a-...`, read/write/notify) — propósito não investigado.
- `0000ae00-0000-1000-8000-00805f9b34fb` (`ae01` write / `ae02` notify) — segundo canal de controle, propósito não investigado (possivelmente OTA de firmware; controle de câmera descartado, esta unidade não tem câmera).

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
