"""Classificador de intencao local, rapido, sem chamar nenhuma API — roda ANTES do Groq
tool-calling em `smart_agent.process_turn()` como atalho: se o texto do usuario bate com
confianca alta num "comando de controle" conhecido (sem argumento livre, tipo "inicia
traducao" ou "abre o dashboard"), executa a ferramenta direto, sem esperar o round-trip do
Groq — mais rapido (o caso mais comum: sem chamada de API nenhuma pra decidir o que fazer) e
mais deterministico pra esses casos. Qualquer coisa que nao bata com confianca cai pro Groq
tool-calling normal, como sempre — isto NAO substitui o tool-calling, so adianta os casos mais
obvios/comuns.

Por que nao Wit.ai (alternativa cogitada)? E um servico de NLU da Meta — cloud, manda o que
voce fala pros servidores deles. Contradiz o resto do projeto (wake word e reconhecimento de
locutor ja rodam 100% local de proposito, ver docs/06-referencia-acoes.md §6.3-6.4). Por que
nao um classificador neural offline mais robusto (embeddings tipo sentence-transformers)? Isso
exigiria torch como dependencia nova — ja tivemos atrito real de compatibilidade com libs
pesadas nesse ambiente (Python 3.14 recente demais pra algumas wheels, ver §6.4 do mesmo doc).
TF-IDF + similaridade de cosseno via scikit-learn resolve sem adicionar NADA novo — o
scikit-learn ja esta instalado (dependencia transitiva do openwakeword).

So inclui aqui ferramentas cujo resultado ja e uma resposta curta pronta pra falar sem passar
por resumo do LLM (mesmas que tem skip_summary=True em smart_agent.execute_tool) — ferramentas
que dependem de argumento livre (search, open_url) ou que normalmente sao resumidas pelo LLM
(get_news) ficam de fora de proposito, continuam so pelo Groq.
"""
import unicodedata

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


def _strip_accents(text: str) -> str:
    """As frases de treino abaixo seguem a convencao do resto do codigo (sem acento), mas o
    Whisper transcreve com acento de verdade ("tradução", nao "traducao") — sem normalizar os
    dois lados pro mesmo formato, o classificador nunca batia com a transcricao real (bug
    encontrado testando antes de ligar isto no smart_agent: toda frase acentuada virava falso
    negativo). NFKD decompoe "ã" em "a" + combining tilde; filtramos as combining marks."""
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))


INTENT_EXAMPLES: dict[str, list[str]] = {
    "start_translator": [
        "inicia a traducao", "inicia traducao", "comeca a traducao", "ativa o tradutor",
        "modo tradutor", "traduz isso pra mim", "quero traduzir uma coisa",
        "traducao", "vamos traduzir", "liga o tradutor", "quero um tradutor",
        "ativa a traducao", "modo interprete",
    ],
    "end_conversation": [
        "tchau", "ate mais", "ate logo", "falou", "pode encerrar", "pode parar",
        "encerra a conversa", "e so isso", "e so isso mesmo", "pode desligar",
    ],
    "open_dashboard": [
        "abre o dashboard", "mostra o dashboard", "quero ver o dashboard",
        "abre o painel de controle", "mostra o painel de controle",
    ],
    "take_screenshot": [
        "tira um print da tela", "tira uma captura de tela", "salva um print da tela",
        "captura a tela pra mim", "tira um screenshot da tela", "salva a tela atual",
    ],
    "see_screen": [
        "olha minha tela", "ve minha tela", "o que voce ve na minha tela",
        "descreve o que esta na minha tela", "visualiza minha tela agora",
        "da uma olhada no que esta na tela",
    ],
    "set_persona:padrao": [
        "volta ao modo normal", "muda pro modo padrao", "volta a ser voce mesmo",
        "tira esse modo especial", "sai desse modo e volta ao normal",
    ],
    "set_persona:serio": [
        "muda pro modo serio", "fica mais serio agora", "vira o modo serio",
        "seja mais formal comigo", "responde de forma mais formal",
    ],
    "set_persona:brincalhao": [
        "muda pro modo brincalhao", "fica mais brincalhao agora", "fica brincalhao",
        "vira o modo engracado", "conta umas piadas", "fica mais descontraido",
    ],
    "set_persona:professor": [
        "muda pro modo professor", "fica mais didatico agora", "explica com mais detalhes",
        "vira o modo professor", "me ensina com mais calma",
    ],
}

CONFIDENCE_THRESHOLD = 0.62
MARGIN_THRESHOLD = 0.12  # diferenca minima entre o 1o e o 2o colocado — sem isso, frases
                          # ambiguas entre dois intents proximos (ex: "abre o X" batendo tanto
                          # em open_dashboard quanto em outra coisa) passavam por acidente

_labels: list[str] = []
_vectorizer: TfidfVectorizer | None = None
_example_vectors = None


def _build():
    global _labels, _vectorizer, _example_vectors
    _labels = []
    examples = []
    for label, phrases in INTENT_EXAMPLES.items():
        for phrase in phrases:
            _labels.append(label)
            examples.append(phrase)
    # ngram_range=(1,2): sem bigramas, uma unica palavra generica compartilhada (ex: "abre") ja
    # empurrava frases de dominios completamente diferentes ("abre o youtube" vs "abre o
    # tradutor") pra cima do threshold — bigramas ("abre o", "o youtube") distinguem o contexto.
    _vectorizer = TfidfVectorizer(ngram_range=(1, 2))
    _example_vectors = _vectorizer.fit_transform(_strip_accents(e) for e in examples)


_build()


def classify(text: str) -> tuple[str, dict] | None:
    """Retorna (nome_da_tool, args) se o texto bater com confianca num intent conhecido, senao
    None (cai pro Groq tool-calling normal, sem nenhum efeito colateral). Duas barreiras contra
    falso positivo: score minimo (CONFIDENCE_THRESHOLD) E margem minima sobre o melhor score de
    um label DIFERENTE (MARGIN_THRESHOLD) — uma frase ambigua entre dois intents proximos nao
    dispara nenhum. A margem e calculada por LABEL, nao por exemplo individual — do contrario,
    dois exemplos do MESMO intent com score parecido derrubariam a margem por engano (nao e
    ambiguidade de verdade, e so o mesmo intent tendo varias frases de treino similares)."""
    if not text or not text.strip():
        return None
    query_vec = _vectorizer.transform([_strip_accents(text.lower().strip())])
    sims = cosine_similarity(query_vec, _example_vectors)[0]

    best_per_label: dict[str, float] = {}
    for label, score in zip(_labels, sims):
        if score > best_per_label.get(label, -1.0):
            best_per_label[label] = float(score)

    ranked = sorted(best_per_label.items(), key=lambda kv: kv[1], reverse=True)
    best_label, best_score = ranked[0]
    if best_score < CONFIDENCE_THRESHOLD:
        return None
    second_best_score = ranked[1][1] if len(ranked) > 1 else 0.0
    if (best_score - second_best_score) < MARGIN_THRESHOLD:
        return None

    if best_label.startswith("set_persona:"):
        persona = best_label.split(":", 1)[1]
        return "set_persona", {"persona": persona}
    return best_label, {}
