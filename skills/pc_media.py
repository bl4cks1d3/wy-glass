SCHEMA = {
    "type": "function",
    "function": {
        "name": "pc_media",
        "description": (
            "Midia e volume do PC: tocar/pausar, proxima/anterior, parar, volume exato (set_volume "
            "com percent), aumentar/diminuir (percent = passo, default 10), mudo, tirar do mudo, ou "
            "dizer o volume atual."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["play_pause", "next", "previous", "stop", "set_volume",
                                                       "volume_up", "volume_down", "mute", "unmute", "get_volume"]},
                "percent": {"type": "integer", "description": "0-100 em set_volume; passo em volume_up/down"},
            },
            "required": ["action"],
        },
    },
}


def execute(args: dict, ctx: dict) -> tuple[str, bool]:
    import pc_control
    return pc_control.media(args.get("action", ""), args.get("percent")), True
