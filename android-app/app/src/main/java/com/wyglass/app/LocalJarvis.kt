package com.wyglass.app

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.util.Log
import com.k2fsa.sherpa.onnx.GeneratedAudio
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Self-contained voice-assistant pipeline running entirely on the phone: records from the
 * glasses' Bluetooth mic, asks one of several free/open AI providers (see AiProvider — Gemini
 * gets raw audio directly, everyone else gets on-device transcribed text), and speaks the
 * reply with a local Piper voice (via sherpa-onnx, same "faber-medium" pt-BR model used on the
 * PC side) routed to whatever audio output is active, i.e. the glasses' Bluetooth speaker.
 */
class LocalJarvis(private val context: Context) {

    companion object {
        private const val TAG = "WyGlass"
        private const val SAMPLE_RATE = 16000
        private const val MAX_RECORD_SECONDS = 20.0
        private const val SILENCE_DURATION_SECONDS = 1.2
        private const val SILENCE_THRESHOLD = 300.0
        private const val MIN_SPEECH_SECONDS = 0.3
        private const val CHUNK_MS = 30.0
    }

    private var tts: OfflineTts? = null
    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val transcriber = Transcriber(context)
    private var volumePercent = 100
    private var focusRequest: AudioFocusRequest? = null

    private val weekdaysPt = listOf(
        "segunda-feira", "terca-feira", "quarta-feira", "quinta-feira",
        "sexta-feira", "sabado", "domingo"
    )

    /**
     * Real wall-clock time from the phone — the LLM has no clock of its own, so this has to be
     * injected into the system prompt on every turn, not guessed. Kotlin port of the PC side's
     * smart_agent.py _now_str(); java.time is available unconditionally since minSdk 26.
     */
    private fun nowStr(): String {
        val now = java.time.LocalDateTime.now()
        val weekday = weekdaysPt[now.dayOfWeek.value - 1]
        return "$weekday, ${"%02d/%02d/%04d".format(now.dayOfMonth, now.monthValue, now.year)}, " +
            "${"%02d:%02d".format(now.hour, now.minute)}"
    }

    fun setVolumePercent(percent: Int) {
        volumePercent = percent.coerceIn(0, 100)
    }

    /**
     * Prepares for a listen/record/speak turn: audio focus + volume. Idempotent — safe to call
     * before every operation.
     *
     * NOTE — this used to also force MODE_IN_COMMUNICATION and the Bluetooth SCO link (both the
     * legacy startBluetoothSco()/isBluetoothScoOn flags and the modern setCommunicationDevice()
     * API). Live testing showed every single attempt to establish that SCO link — with retries,
     * with both APIs combined — kept landing back on TYPE_BUILTIN_EARPIECE (the phone's own
     * call speaker), never on TYPE_BLUETOOTH_SCO. That strongly suggests these glasses don't
     * actually implement the Hands-Free Profile that SCO rides on — they're most likely A2DP
     * (media) only, which is a one-way, output-only profile with no call-audio support. Worse,
     * forcing MODE_IN_COMMUNICATION appears to have been actively fighting the normal A2DP
     * media route that already worked. So playback now uses a plain USAGE_MEDIA AudioTrack
     * (see playFloatPcmBlocking) instead, and recording just uses the phone's own mic — there's
     * no Bluetooth mic input path without HFP/SCO, so that was likely already happening anyway.
     */
    fun ensureBtScoRoute() {
        requestAudioFocus()
        applyVolume()
    }

    /**
     * Without holding audio focus, any other app's sound — a WhatsApp notification, an SMS
     * alert, literally anything — has the right to interrupt or duck our playback at any
     * moment, which is exactly what "notificações quebram o áudio" was: the app never asked
     * for focus, so the system happily let notification sounds cut in over the reply.
     * TRANSIENT_EXCLUSIVE tells Android to silence/duck everyone else while we're using it.
     */
    private fun requestAudioFocus() {
        if (focusRequest != null) return
        val attrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
            .setAudioAttributes(attrs)
            .setAcceptsDelayedFocusGain(false)
            .setOnAudioFocusChangeListener { change ->
                Log.d(TAG, "audio focus: changed to $change")
                if (change == AudioManager.AUDIOFOCUS_LOSS) {
                    // permanent loss (not just a transient duck) — Android will NOT hand focus
                    // back to us on its own, so clear the cached request or every future
                    // ensureBtScoRoute() call would skip re-requesting it forever
                    focusRequest = null
                }
            }
            .build()
        val result = audioManager.requestAudioFocus(request)
        Log.d(TAG, "audio focus: requested (result=$result)")
        focusRequest = request
    }

    private fun abandonAudioFocus() {
        focusRequest?.let {
            audioManager.abandonAudioFocusRequest(it)
            Log.d(TAG, "audio focus: abandoned")
        }
        focusRequest = null
    }

    /**
     * Boosts the media stream (what carries our TTS reply over A2DP to the glasses) to the
     * configured level, since replies can otherwise come out too quiet even with routing right.
     */
    private fun applyVolume() {
        val maxVol = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val target = (maxVol * volumePercent / 100.0).toInt().coerceIn(0, maxVol)
        audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, target, 0)
    }

    /** No-op kept for call-site compatibility (wake word / Transcriber use Android's own SpeechRecognizer, which no longer needs any route of ours to be reset around it). */
    fun invalidateBtScoRoute() {}

    /** Call when going fully idle (disconnecting) — not between individual turns. */
    fun releaseBtScoRoute() {
        abandonAudioFocus()
    }

    /** Blocking — must be called from a background thread. */
    fun init(onReady: () -> Unit) {
        val dataDir = copyDataDirIfNeeded()
        val config = OfflineTtsConfig(
            model = OfflineTtsModelConfig(
                vits = OfflineTtsVitsModelConfig(
                    model = "tts/model.onnx",
                    lexicon = "",
                    tokens = "tts/tokens.txt",
                    dataDir = dataDir,
                    dictDir = "",
                    noiseScale = 0.667f,
                    noiseScaleW = 0.8f,
                    lengthScale = 1.0f,
                ),
                numThreads = 2,
                debug = false,
                provider = "cpu",
            ),
            ruleFsts = "",
            ruleFars = "",
            maxNumSentences = 20,
            silenceScale = 0.2f,
        )
        tts = OfflineTts(context.assets, config)
        onReady()
    }

    /**
     * sherpa-onnx's espeak-ng backend does raw file I/O (fopen) on dataDir, which does not
     * work against the APK's compressed asset filesystem — it must be a real path on disk.
     * Copies assets/tts/espeak-ng-data to internal storage once, on first run.
     */
    private fun copyDataDirIfNeeded(): String {
        val outDir = File(context.filesDir, "espeak-ng-data")
        val marker = File(context.filesDir, "espeak-ng-data.done")
        if (marker.exists() && outDir.exists()) {
            return outDir.absolutePath
        }
        outDir.deleteRecursively()
        copyAssetDir("tts/espeak-ng-data", outDir)
        marker.writeText("ok")
        return outDir.absolutePath
    }

    private fun copyAssetDir(assetPath: String, outDir: File) {
        val am = context.assets
        val entries = am.list(assetPath) ?: emptyArray()
        outDir.mkdirs()
        if (entries.isEmpty()) {
            // leaf file, not a directory
            return
        }
        for (entry in entries) {
            val childAssetPath = "$assetPath/$entry"
            val childEntries = am.list(childAssetPath)
            if (childEntries.isNullOrEmpty()) {
                val outFile = File(outDir, entry)
                am.open(childAssetPath).use { input ->
                    outFile.outputStream().use { output -> input.copyTo(output) }
                }
            } else {
                copyAssetDir(childAssetPath, File(outDir, entry))
            }
        }
    }

    /**
     * Runs one full turn: record -> ask the configured AI provider -> speak. Blocking; call
     * from a background thread. Gemini gets the raw audio directly (its native audio-in);
     * every other provider (Groq, OpenRouter, Mistral, Ollama) only accepts text, so those go
     * through on-device speech-to-text first (see Transcriber).
     */
    fun runTurn(config: ProviderConfig, systemPrompt: String, tavilyApiKey: String = "", log: (String) -> Unit): String {
        // Recomputed every turn (not cached) so a long-idle session doesn't answer "que horas
        // sao" with a stale time — same reasoning as the PC side's build_system_prompt.
        val effectivePrompt = "$systemPrompt\n\nDATA E HORA ATUAIS (relogio real do celular — " +
            "unica fonte confiavel pra saudacoes ou perguntas de horario/data, voce nao tem " +
            "relogio proprio): ${nowStr()}"
        val reply: String
        if (config.provider == AiProvider.GEMINI) {
            log("ouvindo...")
            val wav = recordWavVad()
            log("perguntando ao Gemini...")
            reply = askGemini(config.apiKey, config.model, effectivePrompt, wav)
        } else {
            ensureBtScoRoute()
            log("ouvindo...")
            val userText = transcriber.listenOnceBlocking()
            invalidateBtScoRoute()
            if (userText.isBlank()) throw RuntimeException("nao entendi o que voce disse")
            log("voce: \"$userText\"")
            log("perguntando (${config.provider.label})...")
            // Only Groq's openai/gpt-oss-20b gets tool calling — every other provider tested
            // either doesn't support it well or, in Llama's case, actively breaks (see
            // AiProvider.kt). Everyone else falls back to a plain chat completion.
            reply = if (config.provider == AiProvider.GROQ) {
                askGroqWithTools(config.apiKey, config.model, effectivePrompt, userText, tavilyApiKey, log)
            } else {
                askChatProvider(config, effectivePrompt, userText)
            }
        }
        log("resposta: \"$reply\"")
        speakBlocking(reply)
        return reply
    }

    /**
     * Kotlin port of the PC side's smart_agent.py process_turn(): first call with tools, and
     * if the model picks one, execute it and either speak the raw result directly (when it's
     * already-speakable live data — see AgentTools.SearchResult.liveData) or do a second,
     * tools-less call to turn the raw tool result into a natural-language reply.
     */
    private fun askGroqWithTools(apiKey: String, model: String, systemPrompt: String, userText: String, tavilyApiKey: String, log: (String) -> Unit): String {
        val tools = JSONArray()
            .put(JSONObject().apply {
                put("type", "function")
                put("function", JSONObject().apply {
                    put("name", "search")
                    put("description", "Busca informacao na internet: clima, cambio, cripto, feriados, ou busca geral.")
                    put("parameters", JSONObject().apply {
                        put("type", "object")
                        put("properties", JSONObject().put("query", JSONObject().put("type", "string")))
                        put("required", JSONArray().put("query"))
                    })
                })
            })
            .put(JSONObject().apply {
                put("type", "function")
                put("function", JSONObject().apply {
                    put("name", "open_url")
                    put("description", "Abre uma pagina no navegador do celular.")
                    put("parameters", JSONObject().apply {
                        put("type", "object")
                        put("properties", JSONObject().put("url", JSONObject().put("type", "string")))
                        put("required", JSONArray().put("url"))
                    })
                })
            })
            .put(JSONObject().apply {
                put("type", "function")
                put("function", JSONObject().apply {
                    put("name", "open_app")
                    put("description", "Abre um aplicativo instalado no celular pelo nome (ex: whatsapp, camera, spotify, instagram).")
                    put("parameters", JSONObject().apply {
                        put("type", "object")
                        put("properties", JSONObject().put("name", JSONObject().put("type", "string").put("description", "nome do aplicativo")))
                        put("required", JSONArray().put("name"))
                    })
                })
            })

        val messages = JSONArray()
            .put(JSONObject().put("role", "system").put("content", systemPrompt))
            .put(JSONObject().put("role", "user").put("content", userText))

        val first = groqChatCompletion(apiKey, model, messages, tools)
        val toolCalls = first.optJSONArray("tool_calls")
        if (toolCalls == null || toolCalls.length() == 0) {
            return first.optString("content", "").trim()
        }

        val leadIn = (first.opt("content") as? String) ?: ""
        var lastResult = ""
        var liveData = false
        val followUp = JSONArray(messages.toString())
        followUp.put(JSONObject().apply {
            put("role", "assistant")
            put("content", (first.opt("content") as? String) ?: JSONObject.NULL)
            put("tool_calls", toolCalls)
        })
        for (i in 0 until toolCalls.length()) {
            val call = toolCalls.getJSONObject(i)
            val fn = call.getJSONObject("function")
            val name = fn.getString("name")
            val args = try { JSONObject(fn.optString("arguments", "{}")) } catch (e: Exception) { JSONObject() }
            log("ferramenta: $name(${args})")
            val result = when (name) {
                "search" -> {
                    val r = AgentTools.search(args.optString("query", ""), tavilyApiKey)
                    liveData = r.liveData
                    r.content
                }
                "open_url" -> AgentTools.openUrl(context, args.optString("url", ""))
                "open_app" -> AgentTools.openApp(context, args.optString("name", ""))
                else -> "ferramenta desconhecida: $name"
            }
            lastResult = result
            followUp.put(JSONObject().apply {
                put("role", "tool")
                put("tool_call_id", call.optString("id", ""))
                put("content", result)
            })
        }

        // open_url/open_app results are a raw URL/status line, not meant to be read aloud
        // verbatim — but there's also no need for a second Groq round-trip just to reword
        // them, same reasoning as the PC side's execute_tool() skip_summary.
        val singleToolName = if (toolCalls.length() == 1) toolCalls.getJSONObject(0).getJSONObject("function").getString("name") else null
        if (toolCalls.length() == 1 && (liveData || singleToolName == "open_url" || singleToolName == "open_app")) {
            return if (leadIn.isNotBlank()) leadIn.trim() else lastResult
        }

        val second = groqChatCompletion(apiKey, model, followUp, null)
        return second.optString("content", lastResult).trim()
    }

    /** Returns the raw "message" object from Groq's chat/completions response. */
    private fun groqChatCompletion(apiKey: String, model: String, messages: JSONArray, tools: JSONArray?): JSONObject {
        val payload = JSONObject().apply {
            put("model", model)
            put("messages", messages)
            put("temperature", 0.7)
            put("max_tokens", 400)
            put("reasoning_effort", "low")
            if (tools != null) {
                put("tools", tools)
                put("tool_choice", "auto")
            }
        }
        val conn = URL("https://api.groq.com/openai/v1/chat/completions").openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.doOutput = true
        conn.connectTimeout = 30000
        conn.readTimeout = 30000
        conn.setRequestProperty("Content-Type", "application/json")
        conn.setRequestProperty("Authorization", "Bearer $apiKey")
        conn.outputStream.use { it.write(payload.toString().toByteArray()) }

        val code = conn.responseCode
        val body = (if (code in 200..299) conn.inputStream else conn.errorStream).bufferedReader().use { it.readText() }
        conn.disconnect()
        if (code !in 200..299) throw RuntimeException("Groq HTTP $code: ${body.take(300)}")

        return JSONObject(body).getJSONArray("choices").getJSONObject(0).getJSONObject("message")
    }

    /**
     * Records until SILENCE_DURATION_SECONDS of quiet follow at least MIN_SPEECH_SECONDS of
     * detected speech, or MAX_RECORD_SECONDS is hit — same energy-based VAD approach used on
     * the PC side (jarvis.py:record_audio_vad), so a short question and a long rambling one
     * both get recorded in full without a fixed cutoff.
     */
    private fun recordWavVad(): ByteArray {
        ensureBtScoRoute()

        val chunkSize = maxOf(1, (SAMPLE_RATE * CHUNK_MS / 1000).toInt())
        val minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        @Suppress("MissingPermission")
        // No Bluetooth SCO input path exists on these glasses (see ensureBtScoRoute's note), so
        // this just uses the phone's own mic — MediaRecorder.AudioSource.MIC's default device.
        val recorder = AudioRecord(MediaRecorder.AudioSource.MIC, SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(minBuf, chunkSize * 4))

        val silenceChunksNeeded = maxOf(1, (SILENCE_DURATION_SECONDS * 1000 / CHUNK_MS).toInt())
        val speechChunksNeeded = maxOf(1, (MIN_SPEECH_SECONDS * 1000 / CHUNK_MS).toInt())
        val maxChunks = maxOf(1, (MAX_RECORD_SECONDS * 1000 / CHUNK_MS).toInt())

        val pcm = ByteArrayOutputStream()
        val buf = ShortArray(chunkSize)
        var speechChunks = 0
        var silenceChunks = 0

        recorder.startRecording()
        for (i in 0 until maxChunks) {
            val n = recorder.read(buf, 0, chunkSize)
            if (n <= 0) continue
            for (j in 0 until n) {
                val b = buf[j].toInt()
                pcm.write(b and 0xff)
                pcm.write((b shr 8) and 0xff)
            }
            var sumSq = 0.0
            for (j in 0 until n) sumSq += (buf[j].toDouble() * buf[j].toDouble())
            val rms = kotlin.math.sqrt(sumSq / n)
            if (rms > SILENCE_THRESHOLD) {
                speechChunks++
                silenceChunks = 0
            } else if (speechChunks >= speechChunksNeeded) {
                silenceChunks++
                if (silenceChunks >= silenceChunksNeeded) break
            }
        }
        recorder.stop()
        recorder.release()

        return pcmToWav(pcm.toByteArray())
    }

    private fun pcmToWav(pcm: ByteArray): ByteArray {
        val header = ByteArray(44)
        val totalDataLen = pcm.size + 36
        val byteRate = SAMPLE_RATE * 2

        fun writeInt(offset: Int, value: Int) {
            header[offset] = (value and 0xff).toByte()
            header[offset + 1] = (value shr 8 and 0xff).toByte()
            header[offset + 2] = (value shr 16 and 0xff).toByte()
            header[offset + 3] = (value shr 24 and 0xff).toByte()
        }
        fun writeShort(offset: Int, value: Int) {
            header[offset] = (value and 0xff).toByte()
            header[offset + 1] = (value shr 8 and 0xff).toByte()
        }

        "RIFF".toByteArray().copyInto(header, 0)
        writeInt(4, totalDataLen)
        "WAVE".toByteArray().copyInto(header, 8)
        "fmt ".toByteArray().copyInto(header, 12)
        writeInt(16, 16)
        writeShort(20, 1) // PCM
        writeShort(22, 1) // mono
        writeInt(24, SAMPLE_RATE)
        writeInt(28, byteRate)
        writeShort(32, 2)
        writeShort(34, 16)
        "data".toByteArray().copyInto(header, 36)
        writeInt(40, pcm.size)

        return header + pcm
    }

    private fun askGemini(apiKey: String, model: String, systemPrompt: String, wav: ByteArray): String {
        val url = URL("https://generativelanguage.googleapis.com/v1beta/models/$model:generateContent?key=$apiKey")
        val b64 = android.util.Base64.encodeToString(wav, android.util.Base64.NO_WRAP)

        val payload = JSONObject().apply {
            put("system_instruction", JSONObject().put("parts", JSONArray().put(JSONObject().put("text", systemPrompt))))
            put("contents", JSONArray().put(
                JSONObject().put("parts", JSONArray()
                    .put(JSONObject().put("inline_data", JSONObject().put("mime_type", "audio/wav").put("data", b64)))
                    .put(JSONObject().put("text", "Responda a pergunta ou pedido acima falado pelo usuario.")))
            ))
        }

        val conn = url.openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.doOutput = true
        conn.connectTimeout = 30000
        conn.readTimeout = 30000
        conn.setRequestProperty("Content-Type", "application/json")
        conn.outputStream.use { it.write(payload.toString().toByteArray()) }

        val code = conn.responseCode
        val stream = if (code in 200..299) conn.inputStream else conn.errorStream
        val body = stream.bufferedReader().use { it.readText() }
        conn.disconnect()

        if (code !in 200..299) {
            throw RuntimeException("Gemini HTTP $code: ${body.take(300)}")
        }

        val json = JSONObject(body)
        return json.getJSONArray("candidates").getJSONObject(0)
            .getJSONObject("content").getJSONArray("parts").getJSONObject(0)
            .getString("text").trim()
    }

    private fun askChatProvider(config: ProviderConfig, systemPrompt: String, userText: String): String {
        val baseUrl = when (config.provider) {
            AiProvider.GROQ -> "https://api.groq.com/openai/v1/chat/completions"
            AiProvider.OPENROUTER -> "https://openrouter.ai/api/v1/chat/completions"
            AiProvider.MISTRAL -> "https://api.mistral.ai/v1/chat/completions"
            AiProvider.OLLAMA -> {
                val host = config.ollamaHost.trim().ifBlank { "127.0.0.1" }.trimEnd('/')
                "http://$host:11434/v1/chat/completions"
            }
            AiProvider.GEMINI -> throw IllegalStateException("Gemini usa askGemini(), nao askChatProvider()")
        }
        return askOpenAiCompatible(baseUrl, config.apiKey, config.model, systemPrompt, userText)
    }

    /**
     * Groq, OpenRouter, Mistral and Ollama all speak the same OpenAI-style chat/completions
     * shape, so one function covers all four — only the base URL, model and API key differ.
     */
    private fun askOpenAiCompatible(baseUrl: String, apiKey: String, model: String, systemPrompt: String, userText: String): String {
        val url = URL(baseUrl)
        val payload = JSONObject().apply {
            put("model", model)
            put("messages", JSONArray()
                .put(JSONObject().put("role", "system").put("content", systemPrompt))
                .put(JSONObject().put("role", "user").put("content", userText)))
            put("temperature", 0.7)
        }

        val conn = url.openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.doOutput = true
        conn.connectTimeout = 30000
        conn.readTimeout = 30000
        conn.setRequestProperty("Content-Type", "application/json")
        if (apiKey.isNotBlank()) conn.setRequestProperty("Authorization", "Bearer $apiKey")
        conn.outputStream.use { it.write(payload.toString().toByteArray()) }

        val code = conn.responseCode
        val stream = if (code in 200..299) conn.inputStream else conn.errorStream
        val body = stream.bufferedReader().use { it.readText() }
        conn.disconnect()

        if (code !in 200..299) {
            throw RuntimeException("HTTP $code: ${body.take(300)}")
        }

        val json = JSONObject(body)
        return json.getJSONArray("choices").getJSONObject(0)
            .getJSONObject("message").getString("content").trim()
    }

    private fun speakBlocking(text: String) {
        val engine = tts ?: return
        ensureBtScoRoute()
        val audio: GeneratedAudio = engine.generate(text, 0, 1.0f)
        // pad with silence: Bluetooth output has extra buffering vs a local speaker, so
        // stopping right at the last sample can chop off the tail before it's transmitted.
        val padding = FloatArray((audio.sampleRate * 0.6).toInt())
        playFloatPcmBlocking(audio.samples + padding, audio.sampleRate)
    }

    private fun playFloatPcmBlocking(samples: FloatArray, sampleRate: Int) {
        val minBuf = AudioTrack.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_FLOAT)
        val track = AudioTrack.Builder()
            .setAudioAttributes(
                // USAGE_MEDIA (not USAGE_ASSISTANT/MODE_IN_COMMUNICATION) so this rides the
                // glasses' existing A2DP media link instead of the SCO/call-audio path they
                // apparently don't support — see ensureBtScoRoute()'s note.
                android.media.AudioAttributes.Builder()
                    .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
                    .setContentType(android.media.AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
                    .setSampleRate(sampleRate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setBufferSizeInBytes(maxOf(minBuf, samples.size * 4))
            .setTransferMode(AudioTrack.MODE_STATIC)
            .build()
        // Pin explicitly to the A2DP device if one is connected, as a safety net against any
        // other app's audio bumping the default output around.
        val a2dpDevice = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
            .firstOrNull { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP }
        val preferredOk = a2dpDevice?.let { track.setPreferredDevice(it) } ?: false
        track.write(samples, 0, samples.size, AudioTrack.WRITE_BLOCKING)
        val durationMs = (samples.size.toDouble() / sampleRate * 1000).toLong() + 400
        Log.d(TAG, "playback: start (${durationMs}ms, a2dpFound=${a2dpDevice != null}, preferredDeviceSet=$preferredOk)")
        track.play()
        Thread.sleep(durationMs)
        track.stop()
        track.release()
        Log.d(TAG, "playback: end")
    }

    fun shutdown() {
        tts?.release()
    }
}
