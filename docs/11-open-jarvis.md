# 11. Agente inteligente unificado (ex-Open Jarvis)

## 11.1 Histórico

Esse recurso começou como um projeto complementar separado — [Open Jarvis](https://github.com/Julian-Ivanov/jarvis-voice-assistant), clonado à parte em `projects/cerebro-oculos/open-jarvis/` e adaptado (Claude Haiku → Groq, ElevenLabs → Piper, alemão → PT-BR), rodando como um segundo processo (porta 8340) que o Wy Glass chamava via HTTP.

Depois de alguns testes ao vivo revelarem atrito real (cold-start de ~15-20s no primeiro clique, dois processos pra gerenciar, risco de respostas duplicadas), o usuário pediu pra **unir os dois num processo só**. O código foi portado direto pro Wy Glass — `smart_agent.py` e `browser_tools.py` — e a pasta `open-jarvis/` (clone do repositório original) foi **removida do disco** depois da migração, pra não manter dois projetos rodando em paralelo. O histórico da decisão fica só aqui neste documento; o código-fonte original, se precisar de novo, está em [github.com/Julian-Ivanov/jarvis-voice-assistant](https://github.com/Julian-Ivanov/jarvis-voice-assistant).

## 11.2 Arquitetura final

Tudo roda dentro do próprio `server.py`/`actions.py` do Wy Glass — sem HTTP entre dois servidores, sem navegador, sem processo adicional:

```
Botão 1 (clique simples) → actions.open_jarvis_agent()
                                    │
                    grava (jarvis.record_audio_vad, mic compartilhado)
                                    │
                    transcreve (jarvis.ask_groq_whisper — Groq Whisper)
                                    │
                    smart_agent.process_turn() — pensa com Groq (Llama 3.3 70b)
                                    │
                    detecta [ACTION:...] na resposta, se houver
                                    │
              ┌─────────────┬──────────────┬─────────────┬──────────────┐
          SEARCH          OPEN           SCREEN          NEWS       (nenhuma)
     browser_tools    webbrowser    visão via Groq   browser_tools   responde
     (busca em         .open()      (Llama 4 Scout,   .fetch_news()   direto
      cadeia, ver                    vision, cloud,
      §11.3)                         gratuito)
                                    │
                    fala cada trecho via jarvis.speak() (Piper, local)
```

## 11.3 Busca — cadeia de fontes gratuitas com fallback

`browser_tools.search_and_read()` tenta, em ordem, até achar um resultado com conteúdo:

1. **Fontes dedicadas de dado ao vivo** (só disparam se a pergunta bater com palavras-chave específicas — heurística simples, sem custo de API se não bater):
   - **wttr.in** (`_search_weather`) — clima/tempo/temperatura.
   - **Frankfurter** (`_search_currency`) — câmbio/cotação de moeda (dólar, euro, libra, peso, iene, yuan, franco), taxas do Banco Central Europeu.
   - **CoinGecko** (`_search_crypto`) — preço de criptomoeda (bitcoin, ethereum, dogecoin, solana, cardano, ripple).
   - **Nager.Date** (`_search_holiday`) — próximos feriados nacionais (Brasil).
   
   Todas gratuitas, sem chave, sem limite de requisição significativo pro uso de um assistente pessoal.
2. **Tavily** (`_search_tavily`) — API feita pra uso por agentes de IA, free tier de 1000 buscas/mês, retorna resposta já resumida (não precisa fazer scraping de HTML). Requer `tavily_api_key` na seção `credentials` do `config.json`.
3. **Wikipedia** (`_search_wikipedia`) — API oficial, gratuita, sem chave. Boa pra fatos/definições, não tem dados ao vivo.
4. **DuckDuckGo HTML** (`_search_duckduckgo_html`) — endpoint sem JS, mas tem retornado páginas de desafio anti-bot (HTTP 202) com frequência — mantido como fallback, não confiável sozinho.
5. **Navegador headless (Playwright, DuckDuckGo)** — último recurso, mais lento e frágil (seletores mudam, mesma questão de bot-block do item 4).

**Por que essa ordem**: dados ao vivo (clima, câmbio, cripto, feriados) só vêm de fontes dedicadas — busca genérica não dá número exato/atual; Tavily é a fonte mais confiável pra busca geral (paga só se passar do free tier, não precisa manter scraping); Wikipedia cobre fatos sem custo algum; os dois últimos são fallback de última instância.

## 11.4 Visão de tela

`smart_agent.describe_screen()` — captura a tela (`PIL.ImageGrab`) e manda pro Groq com o modelo `meta-llama/llama-4-scout-17b-16e-instruct` (visão, free tier). Testado também com Gemini (bom, mas free tier tem rate limit apertado — estourou durante os testes) e com Ollama local (`moondream`, `qwen2.5vl:7b`) — inviável nesta máquina, que só tem GPU integrada Intel Iris Xe (sem GPU dedicada), fazendo modelos de visão locais rodarem lento demais ou travarem. Groq venceu por ser gratuito, rápido (cloud) e não depender do hardware local.

## 11.5 Regras de disparo de ação — lição aprendida

Os primeiros testes mostraram o modelo dedicando-se demais a usar a ação de ver a tela — inclusive na saudação de ativação e em respostas vagas tipo "e aí", criando um "loop de visualização de tela" e a sensação de respostas duplicadas. O prompt em `smart_agent.py:build_system_prompt()` foi reforçado com regras explícitas: cada turno é avaliado sozinho (não repete a ação do turno anterior por inércia).

## 11.6 Function calling nativo (substituiu as tags `[ACTION:...]`)

A primeira versão parseava tags de texto tipo `[ACTION:SEARCH] termo` da resposta do modelo via regex — funcionava, mas era frágil (exigia instruir o modelo a "não esquecer" de escrever a tag certinho). Trocado por **function calling nativo** (parâmetro `tools` da API da Groq, formato OpenAI): o modelo escolhe uma ferramenta por nome/schema, sem regex nenhum.

**Detalhe importante — troca de modelo**: `llama-3.3-70b-versatile` (o modelo original) falha de forma consistente (testado 3x) ao chamar ferramentas — ele vaza o formato nativo de function-call do Llama (`<function=nome{args}></function>`) em vez do JSON que a API da Groq espera, e a Groq rejeita com erro 400 `tool_use_failed`. Trocado para **`openai/gpt-oss-20b`** (modelo open-weight da própria OpenAI, hospedado na Groq) — como é da mesma linhagem do formato de tool-calling, funciona de forma limpa e consistente. Mesma qualidade de resposta/persona, sem o bug de formatação.

Ferramentas expostas hoje (`smart_agent.TOOLS`): `search` (busca geral + clima/câmbio/cripto/feriados), `open_url`, `see_screen`, `get_news`, `open_dashboard`.

**Roteiro dessa frente** (`agentes/MCP/skills`, pedido do usuário): Fase 1 (function calling, feito) é a base técnica pras próximas — Fase 2: registro de skills plugável (cada capacidade vira um módulo autodescoberto, em vez da lista fixa `TOOLS`); Fase 3: cliente MCP (conectar a servidores MCP externos, cujas ferramentas entram automaticamente como skills); Fase 4: múltiplos agentes/personas especializados, roteados conforme o pedido.

## 11.6 Configuração (`config.json` do Wy Glass)

```json
"button1_single": {
  "action": "open_jarvis_agent",
  "params": {
    "groq_api_key": "...",
    "tavily_api_key": "...",
    "session_id": "wyglass",
    "user_name": "sankofa",
    "user_role": "desenvolvedor e engenheiro de bugigangas tech",
    "tts_model": "pt_BR-faber-medium.onnx",
    "max_duration_seconds": 15,
    "silence_duration_seconds": 1,
    "silence_threshold": 400
  }
}
```

`conversation_mode` foi deliberadamente deixado **desligado** aqui — testes mostraram ruído ambiente disparando o VAD e reiniciando a escuta sozinha ("loop de encerramento"). Cada clique do botão 1 agora é um turno único (grava → responde → encerra); pra continuar a conversa, clica de novo.

## 11.7 Arquivos novos no Wy Glass

| Arquivo | Responsabilidade |
|---|---|
| `smart_agent.py` | Prompt do agente, parsing de `[ACTION:...]`, loop pensa→fala→executa→resume |
| `browser_tools.py` | Busca (cadeia de fallback), navegação, abrir URL, notícias — Playwright em modo **sync** (não async), porque `actions.py` roda em thread via `run_in_executor` |

## 11.8 Limitações conhecidas

- Playwright spawna um processo Node.js auxiliar; matar o servidor com `taskkill /F` (em vez de um shutdown gracioso) deixa esse processo órfão — verificar `tasklist | findstr node` periodicamente durante desenvolvimento. `server.py` já chama `browser_tools.close()` no shutdown gracioso (`@app.on_event("shutdown")`), mas isso só roda se o processo for encerrado normalmente.
- Sem handoff entre o pipeline "clássico" do Wy Glass (`button1_double`, Gemini) e esse agente unificado — são dois caminhos independentes, cada um com seu próprio histórico de conversa.
- Busca ainda pode falhar se nem Tavily nem Wikipedia tiverem a informação e o DuckDuckGo estiver bloqueando (cenário real observado durante os testes) — não há uma quarta fonte configurada.
