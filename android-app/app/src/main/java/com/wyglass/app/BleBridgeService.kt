package com.wyglass.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.bluetooth.*
import android.content.Context
import android.content.Intent
import android.os.Binder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Connects to the Wy Glass device over BLE, listens for button-click notifications
 * (protocol documented in docs/02-protocolo-ble.md). Button 1 *or* the wake word start a
 * self-contained voice-assistant loop (record via BT mic -> configured AI provider, see
 * AiProvider -> local Piper TTS) that repeats until button 2 stops it (or the wake word
 * listener hears it isn't needed). If no API key is configured (and the provider isn't the
 * key-less local Ollama), falls back to forwarding the click to the legacy PC server
 * (POST /api/test/{gesture}).
 */
class BleBridgeService : Service() {

    companion object {
        private const val TAG = "WyGlass"
        private val SERVICE_UUID = UUID.fromString("000001ff-3c17-d293-8e48-14fe2e4da212")
        private val NOTIFY_CHAR_UUID = UUID.fromString("0000ff03-0000-1000-8000-00805f9b34fb")
        private val CCCD_UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
        private const val CHANNEL_ID = "wyglass_bridge"
        private const val NOTIFICATION_ID = 1
        private const val DEFAULT_SYSTEM_PROMPT =
            "Voce e Wy Glass, um assistente de voz util, direto e simpatico. Responda sempre em portugues do Brasil, de forma breve (1-3 frases)."
    }

    interface Listener {
        fun onStatus(connected: Boolean, message: String)
        fun onMode(mode: String)
        fun onLog(line: String)
    }

    private val binder = LocalBinder()
    private var listener: Listener? = null
    private var gatt: BluetoothGatt? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val httpExecutor = Executors.newSingleThreadExecutor()
    private val jarvisExecutor = Executors.newSingleThreadExecutor()
    private lateinit var jarvis: LocalJarvis
    private lateinit var wakeWordListener: WakeWordListener
    private val conversationActive = AtomicBoolean(false)
    private var connected = false

    var deviceAddress: String = ""
    var serverUrl: String = ""
    var apiKey: String = ""
    var aiProvider: AiProvider = AiProvider.GEMINI
    var aiModel: String = ""
    var ollamaHost: String = ""
    var systemPrompt: String = DEFAULT_SYSTEM_PROMPT
    var wakeWordEnabled: Boolean = false
    var wakeWord: String = "sankofa"
    var ttsVolume: Int = 100
        set(value) {
            field = value.coerceIn(0, 100)
            if (::jarvis.isInitialized) jarvis.setVolumePercent(field)
        }

    private fun providerConfig() = ProviderConfig(
        provider = aiProvider,
        apiKey = apiKey,
        model = aiModel.ifBlank { aiProvider.defaultModel },
        ollamaHost = ollamaHost,
    )

    inner class LocalBinder : Binder() {
        fun getService(): BleBridgeService = this@BleBridgeService
    }

    override fun onBind(intent: Intent?): IBinder = binder

    fun setListener(l: Listener?) {
        listener = l
    }

    private fun log(line: String) {
        Log.d(TAG, line)
        mainHandler.post { listener?.onLog(line) }
    }

    private fun status(isConnected: Boolean, message: String) {
        connected = isConnected
        mainHandler.post { listener?.onStatus(isConnected, message) }
    }

    private fun mode(m: String) {
        mainHandler.post { listener?.onMode(m) }
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        jarvis = LocalJarvis(this)
        jarvis.setVolumePercent(ttsVolume)
        wakeWordListener = WakeWordListener(this)
        jarvisExecutor.execute {
            jarvis.init { log("TTS pronto") }
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "Wy Glass Bridge", NotificationManager.IMPORTANCE_LOW)
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(text: String): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Wy Glass — ativo")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setOngoing(true)
            .build()
    }

    @Suppress("MissingPermission")
    fun connect() {
        startForeground(NOTIFICATION_ID, buildNotification("conectando..."))
        status(false, "escaneando $deviceAddress...")

        val btManager = getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        val adapter = btManager.adapter
        if (adapter == null || !adapter.isEnabled) {
            status(false, "Bluetooth desligado")
            return
        }
        val device: BluetoothDevice = adapter.getRemoteDevice(deviceAddress)
        gatt = device.connectGatt(this, false, gattCallback)
    }

    @Suppress("MissingPermission")
    fun disconnect() {
        conversationActive.set(false)
        wakeWordListener.stop()
        jarvis.releaseBtScoRoute()
        gatt?.disconnect()
        gatt?.close()
        gatt = null
        status(false, "desconectado")
        mode("idle")
        stopForeground(STOP_FOREGROUND_REMOVE)
    }

    private val gattCallback = object : BluetoothGattCallback() {
        @Suppress("MissingPermission")
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                log("conectado, descobrindo servicos...")
                g.discoverServices()
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                wakeWordListener.stop()
                jarvis.releaseBtScoRoute()
                status(false, "desconectado (codigo $status)")
                mode("idle")
                mainHandler.postDelayed({ connect() }, 5000)
            }
        }

        @Suppress("MissingPermission")
        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            val service = g.getService(SERVICE_UUID)
            val char = service?.getCharacteristic(NOTIFY_CHAR_UUID)
            if (char == null) {
                log("characteristic de notificacao nao encontrada")
                return
            }
            g.setCharacteristicNotification(char, true)
            val cccd = char.getDescriptor(CCCD_UUID)
            if (cccd != null) {
                cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                g.writeDescriptor(cccd)
            }
            // BLE and classic Bluetooth (A2DP/SCO, which carries the actual audio to/from the
            // glasses) share the same radio. Every BLE link-layer event — including routine
            // heartbeat notifications — steals a slice of radio time from the audio link, which
            // is audible as a brief glitch on cheap combo chipsets. LOW_POWER widens the BLE
            // connection interval (less frequent polling), reducing how often that contention
            // happens, at the cost of slightly slower button-press notification delivery.
            g.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_LOW_POWER)
            this@BleBridgeService.status(true, "conectado")
            maybeStartWakeWordListening()
        }

        @Deprecated("Deprecated in Java, kept for broad API-level compatibility")
        override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            val value = characteristic.value ?: return
            handleNotification(value)
        }
    }

    private fun maybeStartWakeWordListening() {
        if (!wakeWordEnabled || conversationActive.get()) return
        mode("ouvindo \"$wakeWord\"")
        // SpeechRecognizer picks up whatever input route is active when it starts, so the
        // BT SCO link to the glasses has to be up *before* startListening() runs — otherwise
        // it silently falls back to the phone's own mic/speaker.
        jarvisExecutor.execute {
            jarvis.ensureBtScoRoute()
            wakeWordListener.start(wakeWord, { line -> log(line) }) {
                // the recognizer that just detected the wake word may have stolen/dropped the
                // SCO link — force the first turn to re-handshake instead of assuming it held
                jarvis.invalidateBtScoRoute()
                startConversation()
            }
        }
    }

    private fun handleNotification(value: ByteArray) {
        val hex = value.joinToString("") { "%02x".format(it) }
        // Always logged to logcat (with timestamp) regardless of type, so BLE traffic can be
        // correlated against audio glitches during live debugging — see docs/02-protocolo-ble.md.
        Log.d(TAG, "ble rx: $hex")
        val button = classifyButton(value)
        if (button == null) {
            // bc0703 (heartbeat, ~60s) and bc09 (telemetry) are expected, understood noise —
            // logging them to the UI on every occurrence used to spam the log and clobber the
            // "last heard" text on the main screen with hex garbage. Only genuinely unknown raw
            // packets go to the user-visible log now.
            if (!hex.startsWith("bc0703") && !hex.startsWith("bc09")) {
                log("raw: $hex")
            }
            return
        }
        log("CLIQUE botao$button ($hex)")
        when (button) {
            1 -> onButton1()
            2 -> onButton2()
        }
    }

    private fun classifyButton(b: ByteArray): Int? {
        if (b.size == 6 && b[0] == 0xBC.toByte() && b[1] == 0x03.toByte() && b[2] == 0x03.toByte() && b[3] == 0x01.toByte()) {
            if (b[4] == b[5] && (b[4] == 0x01.toByte() || b[4] == 0x02.toByte())) {
                return b[4].toInt()
            }
        }
        return null
    }

    private fun onButton1() {
        if (apiKey.isNotBlank() || aiProvider == AiProvider.OLLAMA) {
            startConversation()
        } else {
            forwardClick(1)
        }
    }

    private fun onButton2() {
        if (conversationActive.get()) {
            conversationActive.set(false)
            log("encerrando conversa...")
        } else {
            forwardClick(2)
        }
    }

    private fun startConversation() {
        if (!conversationActive.compareAndSet(false, true)) {
            return // ja em andamento
        }
        wakeWordListener.stop()
        mode("conversando")
        val config = providerConfig()
        jarvisExecutor.execute {
            log("conversa iniciada (${config.provider.label})")
            while (conversationActive.get()) {
                try {
                    jarvis.runTurn(config, systemPrompt) { line -> log(line) }
                } catch (e: Exception) {
                    log("erro no turno: ${e.message}")
                    break
                }
            }
            conversationActive.set(false)
            log("conversa encerrada")
            mode(if (connected) "idle" else "idle")
            maybeStartWakeWordListening()
            if (!wakeWordEnabled) mode("conectado")
        }
    }

    private fun forwardClick(button: Int) {
        if (serverUrl.isBlank()) {
            log("nenhuma chave Gemini nem URL de servidor configurada — clique ignorado")
            return
        }
        httpExecutor.execute {
            try {
                val url = URL("$serverUrl/api/test/button${button}_single")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.connectTimeout = 5000
                conn.readTimeout = 5000
                conn.doOutput = false
                val code = conn.responseCode
                conn.disconnect()
                log("enviado ao servidor (HTTP $code)")
            } catch (e: Exception) {
                log("erro ao enviar ao servidor: ${e.message}")
            }
        }
    }

    override fun onDestroy() {
        disconnect()
        jarvis.shutdown()
        httpExecutor.shutdown()
        jarvisExecutor.shutdown()
        super.onDestroy()
    }
}
