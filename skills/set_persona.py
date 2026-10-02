# Mantido em sincronia manual com smart_agent.PERSONAS.keys() de proposito — uma skill
# pluggavel nao deveria precisar importar smart_agent de volta so pra ler essa lista (ciclo de
# import). Se adicionar uma persona nova em smart_agent.py, adiciona o nome aqui tambem.
_PERSONA_NAMES = ["padrao", "mordomo", "serio", "brincalhao", "professor"]

SCHEMA = {
    "type": "function",
    "function": {
        "name": "set_persona",
        "description": (
            "Troca a personalidade/tom do assistente para o resto da conversa. Use SOMENTE "
            "quando o usuario pedir explicitamente pra mudar de personalidade/modo/jeito de "
            "falar (ex: 'vira o modo serio', 'modo mordomo', 'fica mais brincalhao', 'modo professor', 'volta "
            "ao normal'). NUNCA use por conta propria em resposta a uma pergunta comum."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "persona": {
                    "type": "string",
                    "enum": _PERSONA_NAMES,
                    "description": (
                        "padrao = parceiro tecnico, direto, humor seco ocasional (default); "
                        "mordomo = Jarvis classico, sarcastico e educado; serio = direto e formal, sem humor; "
                        "brincalhao = leve, com piadas; professor = didatico, explica o raciocinio"
                    ),
                },
            },
            "required": ["persona"],
        },
    },
}


def execute(args: dict, ctx: dict) -> tuple[str, bool]:
    personas = ctx["personas"]
    session_id = ctx.get("session_id", "")
    persona = args.get("persona", "padrao")
    if persona not in _PERSONA_NAMES:
        persona = "padrao"
    personas[session_id] = persona
    return f"Persona trocada para '{persona}'.", True
