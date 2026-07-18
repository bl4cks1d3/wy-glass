# 1. Hardware

## 1.1 O dispositivo

| Item | Valor |
|---|---|
| Nome comercial (revenda) | Microwear W AI 4 |
| Nome interno do firmware | `LNJ-W03` |
| Versão de firmware (desta unidade) | `0.2.6` |
| Peso | ~38g |
| Bateria | Standby o dia todo, poucas horas de uso contínuo |
| Câmera | Não tem — só lanterna (o manual do fabricante menciona uma função de gravação, mas esta unidade não tem sensor de câmera) |
| Áudio | Alto-falante open-ear + microfone |
| Lentes | Proteção UV/luz azul |
| Bluetooth | 5.3, dual-mode (BLE + clássico) |
| Botões físicos | 2 — "Frente" (perto da lente/hinge) e "Trás" (na haste) |

Esse hardware é vendido por múltiplas marcas diferentes (é um produto "white-label" de um fabricante OEM chinês) — o nome "Microwear" é apenas uma das marcas de revenda. O nome de firmware real (`LNJ-W03`) e o app associado (`MActive Pro`) são os identificadores verdadeiros por trás da marca.

## 1.2 App oficial (não utilizado pelo Wy Glass)

- **Nome**: MActive Pro
- **Pacote Android**: `com.njj.mactivepro`
- **Natureza**: app genérico do fabricante, reaproveitado para vários produtos diferentes — o mesmo APK carrega SDKs de navegação veicular (AMap/Gaode Maps, "carLayer", ícones de carro), sensores de bicicleta elétrica, e os óculos, tudo no mesmo binário.
- **Pipeline de IA embutido**: usa reconhecimento de voz **local** bilíngue chinês-inglês (`sherpa-ncnn-streaming-zipformer-bilingual-zh-en`) — **não tem suporte a português**, o que provavelmente explica a dificuldade de uso relatada em PT-BR.
- **Backend de nuvem**: Aliyun (Alibaba Cloud) SDK embutido — sugere que o "cérebro" do assistente roda em servidores chineses.
- **Codec de áudio**: bibliotecas `libjl_opus.so` / `libjl_speex.so` — o prefixo "jl" indica chipset **Jieli**, um fornecedor comum de chips Bluetooth de áudio em produtos chineses baratos (fones, óculos, etc.)

Conclusão: o app oficial não foi feito especificamente para esses óculos, é uma plataforma genérica de conectividade Bluetooth reaproveitada — o que explica por que ele carrega tanta coisa não relacionada (mapas, navegação) e por que a experiência de voz é limitada.

## 1.3 Tabela de operação dos botões (fonte: manual oficial do fabricante)

Extraída do manual de instruções oficial (imagem hospedada em `download.microwear.com`).

### Botão da Frente

| Função | Gesto |
|---|---|
| Ligar / Desligar | Toque curto |
| Atender / encerrar chamada | Clique |
| Próxima música | Clique duplo |
| **Despertar assistente de IA** | **Clique (simples)** |
| Gravação (foto/vídeo via câmera) — do manual, não se aplica (sem câmera nesta unidade) | Segurar 2 segundos |

### Botão de Trás

| Função | Gesto |
|---|---|
| Lanterna | Segurar (liga/desliga) |
| Atender chamada | Clique |
| Play / pause de música | Clique |
| Música anterior | Clique duplo |

### Indicadores de LED

| Cor | Estado |
|---|---|
| Azul piscando | Não conectado (buscando pareamento) |
| Azul fixo | Conectado / totalmente carregado |
| Azul piscando por 3 min | Bluetooth clássico conectado mas BLE não conectado |
| Vermelho | Carregando |

### Desligamento automático

- Sem conexão de app: desliga sozinho 3 minutos após ligar.
- App conectou e depois desconectou: desliga 2 minutos após a reconexão.
- **Se o Bluetooth permanecer conectado, o dispositivo não desliga sozinho.**

> Esse último ponto é relevante: o Wy Glass mantém uma conexão clássica (A2DP/HFP) sempre ativa com o PC, o que por si só já evita o desligamento automático — sem precisar manter o BLE conectado o tempo todo, em teoria (não testamos esse cenário específico).

## 1.4 Descoberta: são dois botões, não um só

Uma confusão inicial do projeto foi assumir que o "botão" único suportava clique simples/duplo/longo com significados variados dependendo da duração. Na verdade, **são dois botões físicos independentes** (Frente e Trás), cada um com sua própria tabela de funções. O protocolo BLE identifica QUAL botão foi apertado através de um byte no payload (ver [02-protocolo-ble.md](02-protocolo-ble.md)), não a duração do clique.
