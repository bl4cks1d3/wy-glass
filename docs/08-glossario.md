# 8. Glossário

| Termo | Significado |
|---|---|
| **BLE** | Bluetooth Low Energy — modo de baixo consumo do Bluetooth, usado para controle/dados pequenos (diferente do Bluetooth "clássico" usado para áudio) |
| **GATT** | Generic Attribute Profile — o modelo de dados do BLE: um dispositivo expõe *serviços*, cada serviço tem *characteristics* (valores legíveis/graváveis/notificáveis) |
| **Characteristic** | Um "campo" dentro de um serviço BLE — pode ser lido, escrito, ou assinado para receber notificações |
| **Notify** | Modo de uma characteristic onde o dispositivo periférico envia atualizações automaticamente ao central (sem o central precisar perguntar) |
| **Central / Peripheral** | Papéis do BLE: o *peripheral* (óculos) anuncia e aceita conexões; o *central* (PC/celular) escaneia e conecta |
| **UUID** | Identificador único de um serviço ou characteristic BLE (128-bit, ou 16-bit para os padrões Bluetooth SIG) |
| **A2DP** | Advanced Audio Distribution Profile — perfil Bluetooth clássico para transmitir áudio de alta qualidade (ex: música) |
| **HFP** | Hands-Free Profile — perfil Bluetooth clássico para chamadas de voz (áudio bidirecional, mic + fone) |
| **AVRCP** | Audio/Video Remote Control Profile — perfil Bluetooth clássico para comandos de controle de mídia (play/pause/next) |
| **btsnoop** | Formato de log usado pelo Android para gravar todo o tráfego Bluetooth (ativado via Opções do Desenvolvedor) |
| **HCI** | Host Controller Interface — a camada de comunicação entre o software (host) e o chip Bluetooth (controller) |
| **ACL** | Asynchronous Connection-Less — tipo de pacote HCI usado para dados assíncronos (inclui L2CAP/ATT, que carrega o GATT) |
| **L2CAP** | Logical Link Control and Adaptation Protocol — camada abaixo do ATT/GATT, responsável por fragmentação/remontagem de pacotes |
| **ATT** | Attribute Protocol — protocolo usado pelo GATT para ler/escrever/notificar valores |
| **VAD** | Voice Activity Detection — detecção de atividade de voz; usado aqui para saber quando o usuário parou de falar e a gravação pode parar |
| **RMS** | Root Mean Square — medida de energia de um sinal de áudio, usada como proxy simples de "tem fala ou é silêncio" |
| **TTS** | Text-to-Speech — síntese de voz a partir de texto |
| **STT** | Speech-to-Text — transcrição de voz para texto (o Wy Glass não usa STT separado — o Gemini processa áudio diretamente) |
| **Piper** | Motor de TTS local/offline, rápido, com vozes neurais treinadas, hospedado no Hugging Face |
| **ONNX / onnxruntime** | Formato/runtime de modelo de machine learning usado pelo Piper para rodar a síntese de voz |
| **WinRT** | Windows Runtime — API moderna do Windows usada pelo `bleak` para acessar Bluetooth no Windows |
| **BlueZ** | Pilha Bluetooth padrão do Linux, usada pelo `bleak` como backend no Linux |
| **DLL hell** | Conflito clássico do Windows quando duas bibliotecas nativas diferentes, carregadas no mesmo processo, esperam versões incompatíveis de uma mesma DLL |
| **OEM** | Original Equipment Manufacturer — fabricante que produz hardware genérico revendido sob várias marcas diferentes |
| **White-label** | Produto genérico fabricado por um OEM e revendido sob a marca de terceiros (ex: "Microwear" é uma marca de revenda) |
