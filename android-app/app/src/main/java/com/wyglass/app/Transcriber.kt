package com.wyglass.app

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * One-shot blocking speech-to-text using Android's built-in SpeechRecognizer — same mechanism
 * WakeWordListener uses for the wake word, generalized to capture a whole question instead of
 * just matching a keyword. Its endpointer detects when the user stops talking on its own, so
 * this handles variable-length utterances without any custom VAD, for free, fully on-device.
 *
 * Used for every AI provider except Gemini (which accepts raw audio directly).
 */
class Transcriber(private val context: Context) {
    private val mainHandler = Handler(Looper.getMainLooper())

    fun listenOnceBlocking(languageTag: String = "pt-BR", timeoutMs: Long = 25000): String {
        if (!SpeechRecognizer.isRecognitionAvailable(context)) return ""
        val latch = CountDownLatch(1)
        var result = ""
        var recognizerRef: SpeechRecognizer? = null
        val done = java.util.concurrent.atomic.AtomicBoolean(false)
        mainHandler.post {
            val recognizer = SpeechRecognizer.createSpeechRecognizer(context)
            recognizerRef = recognizer
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, languageTag)
                putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
            }
            recognizer.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {}
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEndOfSpeech() {}
                override fun onError(error: Int) {
                    if (!done.compareAndSet(false, true)) return
                    recognizer.destroy()
                    latch.countDown()
                }
                override fun onResults(results: Bundle) {
                    if (!done.compareAndSet(false, true)) return
                    val matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    result = matches?.firstOrNull()?.trim() ?: ""
                    recognizer.destroy()
                    latch.countDown()
                }
                override fun onPartialResults(partialResults: Bundle?) {}
                override fun onEvent(eventType: Int, params: Bundle?) {}
            })
            try {
                recognizer.startListening(intent)
            } catch (e: Exception) {
                if (done.compareAndSet(false, true)) {
                    recognizer.destroy()
                    latch.countDown()
                }
            }
        }
        val finished = latch.await(timeoutMs, TimeUnit.MILLISECONDS)
        if (!finished && done.compareAndSet(false, true)) {
            // The recognizer never called back in time — cancel it explicitly, or it keeps the
            // mic open in the background indefinitely and can interfere with the next turn.
            mainHandler.post { recognizerRef?.let { it.setRecognitionListener(null); it.destroy() } }
        }
        return result
    }
}
