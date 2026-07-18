package com.wyglass.app

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

/**
 * Continuous "always listening" wake-word detector. Not a dedicated low-power wake-word
 * engine (that would need a custom-trained model for a non-standard word like "sankofa") —
 * instead restarts Android's built-in SpeechRecognizer in a loop and checks whether the wake
 * word appears in what it heard. Simpler to ship, costs more battery than a real wake-word
 * engine; see docs/10-app-android.md for the trade-off and future upgrade path.
 */
class WakeWordListener(private val context: Context) {

    private var recognizer: SpeechRecognizer? = null
    private var active = false
    private var wakeWord = "sankofa"
    private var onDetected: (() -> Unit)? = null
    private var onLog: ((String) -> Unit)? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    fun start(wakeWord: String, log: (String) -> Unit, onDetected: () -> Unit) {
        this.wakeWord = wakeWord.trim().lowercase().ifBlank { "sankofa" }
        this.onDetected = onDetected
        this.onLog = log
        if (active) return
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            log("reconhecimento de voz indisponivel neste aparelho — palavra de ativacao desligada")
            return
        }
        active = true
        mainHandler.post { listenOnce() }
    }

    fun stop() {
        active = false
        mainHandler.post {
            recognizer?.setRecognitionListener(null)
            recognizer?.destroy()
            recognizer = null
        }
    }

    private fun listenOnce() {
        if (!active) return
        val r = SpeechRecognizer.createSpeechRecognizer(context)
        recognizer = r
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-BR")
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
        }
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onError(error: Int) {
                r.destroy()
                if (recognizer === r) recognizer = null
                restartSoon()
            }
            override fun onResults(results: Bundle) {
                r.destroy()
                if (recognizer === r) recognizer = null
                if (containsWakeWord(results)) fireDetected() else restartSoon()
            }
            override fun onPartialResults(partialResults: Bundle) {
                if (containsWakeWord(partialResults)) {
                    r.destroy()
                    if (recognizer === r) recognizer = null
                    fireDetected()
                }
            }
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        try {
            r.startListening(intent)
        } catch (e: Exception) {
            restartSoon()
        }
    }

    private fun containsWakeWord(results: Bundle): Boolean {
        val matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) ?: return false
        val heard = matches.joinToString(" ").lowercase()
        return heard.contains(wakeWord)
    }

    private fun fireDetected() {
        if (!active) return
        active = false
        onLog?.invoke("palavra de ativacao detectada")
        onDetected?.invoke()
    }

    private fun restartSoon() {
        if (!active) return
        mainHandler.postDelayed({ listenOnce() }, 400)
    }
}
