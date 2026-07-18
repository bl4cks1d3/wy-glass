# 9. Pesquisa de features — o que faria do Wy Glass um projeto legal

Pesquisa de mercado (Meta Ray-Ban, projetos open source) cruzada com o que nosso hardware permite, filtrada por um critério importante: **este é um projeto hobby, sem câmera em uso, focado inteiramente em voz e áudio.**

## 9.1 O que o mercado está fazendo (2026) — contexto

**Meta Ray-Ban** (referência comercial madura):
- Tradução ao vivo (áudio e visual) em tempo real, várias línguas
- Busca visual: "o que é isso que estou olhando" (landmark, objeto, placa)
- Tradução de texto/placas via câmera
- Navegação com direções por voz
- Legendas ao vivo em chamadas
- Resumo de mensagens (WhatsApp) por voz

**Projetos open source relevantes:**
- [**OpenGlass**](https://github.com/BasedHardware/OpenGlass) (BasedHardware) — mesma filosofia do Wy Glass: "transforme qualquer óculos em óculos de IA".
- [**VisionClaw**](https://github.com/Intent-Lab/VisionClaw) — assistente com **56+ skills via tool-calling** (busca web, mensageria, casa inteligente, notas, lembretes).
- [**OpenSourceSmartGlasses**](https://github.com/Mentra-Community/OpenSourceSmartGlasses) (Mentra) — plataforma aberta, foco em ser "extensível para makers".

Sources: [Meta Ray-Ban translation](https://skift.com/2026/03/31/meta-ray-ban-prescriptions-translation-travel/), [Meta AI glasses features](https://www.meta.com/ai-glasses/real-time-translation/), [OpenGlass](https://github.com/BasedHardware/OpenGlass), [VisionClaw](https://github.com/Intent-Lab/VisionClaw), [OpenSourceSmartGlasses](https://github.com/Mentra-Community/OpenSourceSmartGlasses)

## 9.2 Decisão de escopo: sem câmera, foco 100% em voz/áudio

Diferente do plano inicial desta pesquisa, o projeto **não vai explorar a câmera** — é um hobby pessoal, e o interesse está em construir algo divertido e útil em cima do que já funciona (microfone + alto-falante + 2 botões), não em abrir uma nova frente de engenharia reversa. Boa notícia: a feature mais alardeada do mercado (tradução ao vivo) na verdade **não depende de câmera nenhuma** — só de áudio.

## 9.3 Lista de features (todas aprovadas, aguardando priorização de implementação)

### A. Assistente mais "vivo"

| Feature | Descrição | Esforço |
|---|---|---|
| **Tool-calling / function calling** | Hoje o Gemini só *conversa* — com function calling nativo, o assistente passa a *executar* ações reais (as já existentes em `actions.py`: abrir programa, pesquisar, etc.) a partir de linguagem natural. Maior salto de "chatbot" pra "agente". | Médio |
| **Memória de conversa** | Hoje cada turno do modo conversacional é *stateless* — o Gemini não lembra o que foi dito antes. Passar histórico entre turnos. | Baixo |
| **Personas trocáveis** | Comando de voz tipo "vira o modo sarcástico" / "volta a ser sério" troca o `system_prompt` na hora, sem precisar mexer no painel. | Baixo |
| **Palavra de ativação (wake word)** | Elimina a dependência do botão físico para iniciar a conversa. | Médio-alto |

### B. Tradutor ao vivo (áudio → áudio)

| Feature | Descrição | Esforço |
|---|---|---|
| **Tradução em tempo real** | Fala em português, o Gemini entende e responde/traduz em outro idioma (ou vice-versa) — pura conversa por áudio, sem nenhuma dependência de câmera. É a feature "matadora" do Meta Ray-Ban, e dá pra fazer 100% com o que já temos. | Baixo-médio |

### C. Automação de casa/PC por voz

| Feature | Descrição | Esforço |
|---|---|---|
| **Controle de mídia** | "Toca minha playlist" via API do Spotify (complementa o AVRCP nativo que já existe). | Baixo-médio |
| **Macros de setup** | "Abre meu setup de trabalho" → dispara uma sequência de `run_command`/`open_url` configurada. | Baixo |
| **Casa inteligente** | Integração com Home Assistant (se houver dispositivos smart home) via tool-calling. | Médio |

### D. Notificação / consciência ambiente

| Feature | Descrição | Esforço |
|---|---|---|
| **Leitura de notificações** | Ler em voz alta notificações do Windows (Discord, e-mail) quando chegam. | Médio (exige hook nas notificações do Windows) |
| **Sussurro periódico** | Um lembrete/hora/clima falado de tempos em tempos, sem precisar perguntar. | Baixo |

### E. Puro hobby / diversão

| Feature | Descrição | Esforço |
|---|---|---|
| **Modo walkie-talkie** | Push-to-talk entre dois Wy Glass (ou óculos + celular) — "brinquedo de rádio". | Médio-alto |
| **Modo jogo / trivia** | Perguntas e respostas, piadas, quando não tem nada sério pra fazer. | Baixo (é só um `system_prompt` diferente + gatilho) |
| **Efeitos sonoros customizados** | Um "bip" no ouvido quando chega mensagem, evento, etc. | Baixo |

## 9.4 Notas de implementação (para quando formos priorizar)

- **Tool-calling** e **tradução ao vivo** são as duas com melhor relação impacto/esforço — ambas usam só o que já existe (Gemini + Piper + `actions.py`), sem hardware novo.
- **Personas**, **modo jogo** e **macros de setup** são essencialmente variações do mesmo mecanismo (trocar `system_prompt` e/ou disparar uma sequência de ações) — dá para construir uma base comum ("perfis de comportamento") que serve pra várias dessas de uma vez.
- **Leitura de notificações** e **walkie-talkie** são as mais custosas tecnicamente (a primeira exige hook no sistema de notificações do Windows; a segunda exige um segundo dispositivo ou canal de transporte entre máquinas).

Nenhuma implementação começou ainda — este documento é o backlog de ideias aprovadas, para quando decidirmos a ordem de construção.
