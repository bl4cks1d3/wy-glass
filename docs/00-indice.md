# Wy Glass — Estudo Completo

Documentação técnica completa do projeto Wy Glass: óculos inteligentes genéricos ("Microwear W AI 4") reprogramados via engenharia reversa de Bluetooth Low Energy para funcionar como assistente de IA por voz, controlados direto do PC.

## Índice

1. [Hardware](01-hardware.md) — o dispositivo físico, especificações, app original do fabricante
2. [Protocolo BLE](02-protocolo-ble.md) — engenharia reversa completa do protocolo, byte a byte
3. [Metodologia](03-metodologia.md) — como decodificamos o protocolo, passo a passo, ferramentas usadas, becos sem saída
4. [Arquitetura do software](04-arquitetura.md) — como o Wy Glass é construído, fluxo de dados, decisões de design
5. [Guia de instalação e configuração](05-instalacao.md) — como colocar pra rodar do zero
6. [Referência de ações e configuração](06-referencia-acoes.md) — todos os tipos de ação e parâmetros
7. [Roteiro futuro](07-roteiro-futuro.md) — palavra de ativação, múltiplos agentes, versão Linux, open source
8. [Glossário](08-glossario.md) — termos técnicos usados ao longo do estudo
9. [Pesquisa de features](09-pesquisa-features.md) — o que o mercado faz, o que vale a pena construir a seguir, priorizado
10. [App Android (base)](10-app-android.md) — ponte BLE genérica pro celular, conectando ao mesmo servidor

## Resumo executivo

O Microwear W AI 4 é um óculos inteligente genérico chinês (câmera + áudio open-ear, sem tela) vendido sob a marca "MActive Pro". O app oficial depende de nuvem chinesa e não atende bem português. Em vez de usar o app, conectamos direto via Bluetooth Low Energy (BLE) no protocolo proprietário do dispositivo, decodificamos os comandos do botão físico, e construímos nossa própria stack (Python + FastAPI) que substitui o app por completo — incluindo um assistente de voz (Gemini + Piper TTS) acionado pelo botão físico.

Ver [01-hardware.md](01-hardware.md) para começar.
