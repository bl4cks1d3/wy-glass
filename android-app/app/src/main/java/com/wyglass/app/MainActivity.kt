package com.wyglass.app

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.view.View
import android.view.animation.AlphaAnimation
import android.view.animation.Animation
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity(), BleBridgeService.Listener {

    private var service: BleBridgeService? = null
    private var bound = false

    private lateinit var statusText: TextView
    private lateinit var subStatusText: TextView
    private lateinit var lastHeardText: TextView
    private lateinit var pulseRing: View
    private lateinit var prefs: android.content.SharedPreferences

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        if (results.values.all { it }) {
            applyConfigAndConnect()
        } else {
            statusText.text = "PERMISSOES NEGADAS"
        }
    }

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName, binder: IBinder) {
            service = (binder as BleBridgeService.LocalBinder).getService()
            service?.setListener(this@MainActivity)
            bound = true
            requestPermissionsAndConnect()
        }

        override fun onServiceDisconnected(name: ComponentName) {
            service = null
            bound = false
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        prefs = getSharedPreferences("wyglass_prefs", Context.MODE_PRIVATE)

        statusText = findViewById(R.id.statusText)
        subStatusText = findViewById(R.id.subStatusText)
        lastHeardText = findViewById(R.id.lastHeardText)
        pulseRing = findViewById(R.id.pulseRing)

        findViewById<TextView>(R.id.settingsButton).setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }

        val intent = Intent(this, BleBridgeService::class.java)
        startService(intent)
        bindService(intent, connection, Context.BIND_AUTO_CREATE)
    }

    override fun onResume() {
        super.onResume()
        // re-apply settings in case they changed while SettingsActivity was open
        if (bound) applyConfigAndConnect(skipIfConnected = true)
    }

    private fun requestPermissionsAndConnect() {
        val needed = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            needed.add(android.Manifest.permission.BLUETOOTH_SCAN)
            needed.add(android.Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            needed.add(android.Manifest.permission.ACCESS_FINE_LOCATION)
        }
        needed.add(android.Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            needed.add(android.Manifest.permission.POST_NOTIFICATIONS)
        }
        permissionLauncher.launch(needed.toTypedArray())
    }

    private fun applyConfigAndConnect(skipIfConnected: Boolean = false) {
        val address = prefs.getString("device_address", "")?.trim() ?: ""
        val provider = AiProvider.fromId(prefs.getString("ai_provider", "gemini"))
        val apiKey = prefs.getString("api_key", "")?.trim() ?: ""
        val model = prefs.getString("ai_model", "")?.trim() ?: ""
        val ollamaHost = prefs.getString("ollama_host", "")?.trim() ?: ""
        val serverUrl = prefs.getString("server_url", "")?.trim()?.trimEnd('/') ?: ""
        val systemPrompt = prefs.getString("system_prompt", "")?.trim() ?: ""
        val wakeWordEnabled = prefs.getBoolean("wake_word_enabled", false)
        val wakeWord = prefs.getString("wake_word", "sankofa")?.trim() ?: "sankofa"
        val volume = prefs.getInt("tts_volume", 100)

        service?.deviceAddress = address
        service?.aiProvider = provider
        service?.apiKey = apiKey
        service?.aiModel = model
        service?.ollamaHost = ollamaHost
        service?.serverUrl = serverUrl
        if (systemPrompt.isNotBlank()) service?.systemPrompt = systemPrompt
        service?.wakeWordEnabled = wakeWordEnabled
        service?.wakeWord = wakeWord
        service?.ttsVolume = volume

        if (address.isBlank()) {
            statusText.text = "CONFIGURE NAS OPÇÕES"
            return
        }
        if (skipIfConnected) return
        service?.connect()
    }

    override fun onStatus(connected: Boolean, message: String) {
        statusText.text = if (connected) "CONECTADO" else "DESCONECTADO"
        statusText.setTextColor(if (connected) 0xFF3DFFA0.toInt() else 0xFFFF4D6A.toInt())
        subStatusText.text = message
        setPulse(connected)
    }

    override fun onMode(mode: String) {
        subStatusText.text = when {
            mode.startsWith("ouvindo") -> mode.replaceFirstChar { it.uppercase() } + "..."
            mode == "conversando" -> "Conversando..."
            mode == "conectado" -> "Conectado"
            else -> subStatusText.text.toString()
        }
    }

    override fun onLog(line: String) {
        // raw BLE hex dumps aren't meant for this label — they'd otherwise clobber the last
        // meaningful thing said/heard as soon as any unrecognized packet came in.
        if (line.startsWith("raw:")) return
        lastHeardText.text = line
    }

    private fun setPulse(on: Boolean) {
        if (on) {
            pulseRing.visibility = View.VISIBLE
            val anim = AlphaAnimation(0.15f, 0.7f).apply {
                duration = 900
                repeatMode = Animation.REVERSE
                repeatCount = Animation.INFINITE
            }
            pulseRing.startAnimation(anim)
        } else {
            pulseRing.clearAnimation()
            pulseRing.visibility = View.INVISIBLE
        }
    }

    override fun onDestroy() {
        if (bound) {
            service?.setListener(null)
            unbindService(connection)
            bound = false
        }
        super.onDestroy()
    }
}
