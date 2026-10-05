# Chamada de voz (modo conversacional, Gemini Live)

Converse **por voz, em português**, com o assistente do Planner Life — como uma ligação. O Gemini (Live API) ouve, fala e **chama as ferramentas do Planner** em linguagem natural: pesquisa e notas, agenda, tarefas, estudos, agendamentos e o que mais o Agent tiver. O Gemini é usado **só nesta chamada**; o chat de texto continua no provedor configurado (Groq, etc.).

## 1. Usar

1. Preencha `GEMINI_LIVE_API_KEY` no `.env` (ou em **Configurações → Chamada de voz**) e reinicie o serviço de voz. Chave grátis: Google AI Studio.
2. Clique no **microfone** no canto inferior esquerdo do app, permita o microfone e fale. Exemplos: _"O que tenho na agenda hoje?"_, _"Anota que preciso ligar pro contador"_, _"Pesquisa nas minhas notas sobre NestJS"_, _"Marca um bloco de estudo de cálculo amanhã às 8h"_.
3. O cartão mostra o que você disse, o que o assistente respondeu e as ferramentas usadas (`list_tasks ✓`). Você pode **interromper** o assistente falando por cima, **silenciar** o microfone ou **encerrar**.

## 2. Como funciona

```
navegador ──PCM 16 kHz──►  voice :4200 /live  ──WebSocket──►  Gemini Live (wss)
   ▲   ◄──PCM 24 kHz + transcrições + eventos de ferramenta──┘        │ toolCall
   └───────────────────────────────────────────────  Agent /tools/call ◄┘
```

- **Navegador** (`lib/live-call.ts`, `app/voice-call.tsx`): microfone → `AudioWorklet` → PCM 16-bit 16 kHz mono em blocos de 100 ms; áudio de resposta (24 kHz) agendado num `AudioContext`. Eco cancelado pelo navegador; `interrupted` limpa a fila de áudio.
- **Serviço `voice`** (`packages/voice/src/live/gemini-live.ts`): WebSocket local `ws://localhost:4200/live`. Abre a conexão com o Gemini com a chave (que **nunca** vai ao navegador), envia `setup` (modelo, voz, instruções em português com data/hora e fuso, **as ferramentas do Agent** como `functionDeclarations`, transcrição de entrada e saída) e repassa áudio nos dois sentidos. Cada `toolCall` vira `POST /tools/call` no Agent e a resposta volta como `toolResponse` (cortada em 12 000 caracteres).
- As ferramentas são carregadas **a cada chamada**: uma ferramenta nova no Agent já fica disponível por voz.

## 3. Segurança e custo

- WebSocket só aceita conexão de **loopback**, `Host` conhecido e `Origin` do dashboard (`VOICE_ALLOWED_ORIGINS` para extras) — senão qualquer site aberto poderia ligar (gasta cota e aciona ferramentas).
- **Ferramentas destrutivas ficam de fora** (`delete_*`, `clear_*`, `disconnect_*`; `LIVE_ALLOW_DESTRUCTIVE=true` libera) e `run_claude_code`/`use_skill` nunca: por voz não se apaga nada.
- **Uma chamada por vez** e teto de 14 minutos (o Gemini corta áudio em 15).
- O áudio do microfone e as respostas passam pelo Gemini (Google). O Planner não grava áudio; as transcrições ficam só na tela.

## 4. Configuração

| Variável                    | Padrão                  | Descrição                                                                                 |
| --------------------------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| `GEMINI_LIVE_API_KEY`       | —                       | Chave do Gemini **só** para a chamada de voz (secreta: nunca volta ao navegador)          |
| `GEMINI_LIVE_MODEL`         | `gemini-3.8-live`       | Modelo Live (ver `models.list` da sua chave; ex.: `gemini-2.5-flash-native-audio-latest`) |
| `GEMINI_LIVE_VOICE`         | `Kore`                  | Voz do Gemini                                                                             |
| `VOICE_ALLOWED_ORIGINS`     | _(vazio)_               | Origens extras autorizadas a ligar                                                        |
| `LIVE_ALLOW_DESTRUCTIVE`    | `false`                 | Libera ferramentas de apagar por voz                                                      |
| `NEXT_PUBLIC_VOICE_API_URL` | `http://localhost:4200` | URL do serviço de voz (o WebSocket usa `ws://` a partir dela)                             |

Mudanças exigem reiniciar o serviço de voz (o `pnpm dev` reinicia sozinho ao salvar código, não ao salvar o `.env`).

## 5. Limitações

- Precisa de internet e de chave do Gemini; o Piper (TTS local) **não** é usado nesta chamada.
- Sessões de áudio duram até 15 min; depois é preciso ligar de novo (o contexto não é retomado).
- Sem push-to-talk: o microfone fica aberto durante a chamada (use **Silenciar**). Em ambiente ruidoso, use fones.
- Sem verificação de quem fala: quem estiver no microfone aciona as ferramentas permitidas.
- O app desktop (Electron) precisa liberar o microfone para a origem `localhost:4300`.
- Chamada de voz **não** cria automações complexas: para isso use o Claude Code + MCP ([AUTOMATIONS.md](AUTOMATIONS.md)); por voz valem as ferramentas simples (nota, tarefa, agenda, agendamento de estudo).
