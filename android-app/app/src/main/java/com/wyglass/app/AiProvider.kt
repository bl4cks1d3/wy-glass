package com.wyglass.app

/**
 * Every option here is free-tier / open-weight friendly. Gemini keeps its native audio-in path
 * (LocalJarvis.askGemini); everyone else is a plain OpenAI-compatible chat/completions call
 * (LocalJarvis.askChatProvider) fed by on-device speech-to-text (Transcriber), since none of
 * them accept raw audio directly.
 */
enum class AiProvider(val id: String, val label: String, val defaultModel: String, val needsHost: Boolean = false) {
    GEMINI("gemini", "Gemini (Google)", "gemini-2.5-flash"),
    // llama-3.3-70b-versatile leaks Llama's native <function=...> tag instead of proper
    // tool_calls JSON on every function-calling attempt (same failure confirmed on the PC
    // side, smart_agent.py) — openai/gpt-oss-20b is the model that actually works cleanly.
    GROQ("groq", "Groq (GPT-OSS / Llama / Qwen)", "openai/gpt-oss-20b"),
    OPENROUTER("openrouter", "OpenRouter (modelos :free)", "meta-llama/llama-3.3-70b-instruct:free"),
    MISTRAL("mistral", "Mistral (La Plateforme)", "mistral-small-latest"),
    OLLAMA("ollama", "Ollama (local, no seu PC)", "llama3.2", needsHost = true);

    companion object {
        fun fromId(id: String?): AiProvider = entries.find { it.id == id } ?: GEMINI
    }
}

data class ProviderConfig(
    val provider: AiProvider,
    val apiKey: String,
    val model: String,
    val ollamaHost: String = "",
)
