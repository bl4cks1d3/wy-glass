package com.wyglass.app

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Bundle
import android.os.IBinder
import android.view.View
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.Spinner
import android.widget.Switch
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class SettingsActivity : AppCompatActivity(), BleBridgeService.Listener {

    companion object {
        private const val MAX_LOG_CHARS = 20000
    }

    private var service: BleBridgeService? = null
    private var bound = false

    private lateinit var deviceAddressInput: EditText
    private lateinit var providerSpinner: Spinner
    private lateinit var apiKeyLabel: TextView
    private lateinit var apiKeyInput: EditText
    private lateinit var modelInput: EditText
    private lateinit var ollamaHostLabel: TextView
    private lateinit var ollamaHostInput: EditText
    private lateinit var serverUrlInput: EditText
    private lateinit var wakeWordSwitch: Switch
    private lateinit var wakeWordInput: EditText
    private lateinit var volumeLabel: TextView
    private lateinit var volumeSeekBar: SeekBar
    private lateinit var systemPromptInput: EditText
    private lateinit var logText: TextView
    private lateinit var logScroll: ScrollView
    private lateinit var prefs: android.content.SharedPreferences

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName, binder: IBinder) {
            service = (binder as BleBridgeService.LocalBinder).getService()
            service?.setListener(this@SettingsActivity)
            bound = true
        }
        override fun onServiceDisconnected(name: ComponentName) {
            service = null
            bound = false
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)
        prefs = getSharedPreferences("wyglass_prefs", Context.MODE_PRIVATE)

        deviceAddressInput = findViewById(R.id.deviceAddressInput)
        providerSpinner = findViewById(R.id.providerSpinner)
        apiKeyLabel = findViewById(R.id.apiKeyLabel)
        apiKeyInput = findViewById(R.id.apiKeyInput)
        modelInput = findViewById(R.id.modelInput)
        ollamaHostLabel = findViewById(R.id.ollamaHostLabel)
        ollamaHostInput = findViewById(R.id.ollamaHostInput)
        serverUrlInput = findViewById(R.id.serverUrlInput)
        wakeWordSwitch = findViewById(R.id.wakeWordSwitch)
        wakeWordInput = findViewById(R.id.wakeWordInput)
        volumeLabel = findViewById(R.id.volumeLabel)
        volumeSeekBar = findViewById(R.id.volumeSeekBar)
        systemPromptInput = findViewById(R.id.systemPromptInput)
        logText = findViewById(R.id.logText)
        logScroll = logText.parent as ScrollView

        providerSpinner.adapter = ArrayAdapter(
            this, android.R.layout.simple_spinner_dropdown_item, AiProvider.entries.map { it.label }
        )
        providerSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                updateProviderFieldsVisibility(AiProvider.entries[position])
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }

        deviceAddressInput.setText(prefs.getString("device_address", "53:88:97:31:A5:3A"))
        val savedProvider = AiProvider.fromId(prefs.getString("ai_provider", "gemini"))
        providerSpinner.setSelection(AiProvider.entries.indexOf(savedProvider))
        apiKeyInput.setText(prefs.getString("api_key", ""))
        modelInput.setText(prefs.getString("ai_model", ""))
        ollamaHostInput.setText(prefs.getString("ollama_host", ""))
        serverUrlInput.setText(prefs.getString("server_url", ""))
        wakeWordSwitch.isChecked = prefs.getBoolean("wake_word_enabled", false)
        wakeWordInput.setText(prefs.getString("wake_word", "sankofa"))
        val savedVolume = prefs.getInt("tts_volume", 100)
        volumeSeekBar.progress = savedVolume
        volumeLabel.text = "Volume da resposta ($savedVolume%)"
        volumeSeekBar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                volumeLabel.text = "Volume da resposta ($progress%)"
            }
            override fun onStartTrackingTouch(seekBar: SeekBar?) {}
            override fun onStopTrackingTouch(seekBar: SeekBar?) {}
        })
        prefs.getString("system_prompt", null)?.let { if (it.isNotBlank()) systemPromptInput.setText(it) }
        updateProviderFieldsVisibility(savedProvider)

        findViewById<TextView>(R.id.backButton).setOnClickListener { finish() }
        findViewById<Button>(R.id.saveButton).setOnClickListener { saveAndConnect() }
        findViewById<Button>(R.id.disconnectButton).setOnClickListener { service?.disconnect() }

        val intent = Intent(this, BleBridgeService::class.java)
        bindService(intent, connection, Context.BIND_AUTO_CREATE)
    }

    private fun updateProviderFieldsVisibility(provider: AiProvider) {
        val ollamaVisibility = if (provider.needsHost) View.VISIBLE else View.GONE
        ollamaHostLabel.visibility = ollamaVisibility
        ollamaHostInput.visibility = ollamaVisibility
        apiKeyLabel.visibility = if (provider.needsHost) View.GONE else View.VISIBLE
        apiKeyInput.visibility = if (provider.needsHost) View.GONE else View.VISIBLE
        modelInput.hint = provider.defaultModel
    }

    private fun saveAndConnect() {
        val address = deviceAddressInput.text.toString().trim()
        val provider = AiProvider.entries[providerSpinner.selectedItemPosition]
        val apiKey = apiKeyInput.text.toString().trim()
        val model = modelInput.text.toString().trim()
        val ollamaHost = ollamaHostInput.text.toString().trim()
        val serverUrl = serverUrlInput.text.toString().trim().trimEnd('/')
        val wakeWordEnabled = wakeWordSwitch.isChecked
        val wakeWord = wakeWordInput.text.toString().trim().ifBlank { "sankofa" }
        val volume = volumeSeekBar.progress
        val systemPrompt = systemPromptInput.text.toString().trim()

        prefs.edit()
            .putString("device_address", address)
            .putString("ai_provider", provider.id)
            .putString("api_key", apiKey)
            .putString("ai_model", model)
            .putString("ollama_host", ollamaHost)
            .putString("server_url", serverUrl)
            .putBoolean("wake_word_enabled", wakeWordEnabled)
            .putString("wake_word", wakeWord)
            .putInt("tts_volume", volume)
            .putString("system_prompt", systemPrompt)
            .apply()

        service?.deviceAddress = address
        service?.aiProvider = provider
        service?.apiKey = apiKey
        service?.aiModel = model
        service?.ollamaHost = ollamaHost
        service?.serverUrl = serverUrl
        service?.wakeWordEnabled = wakeWordEnabled
        service?.wakeWord = wakeWord
        service?.ttsVolume = volume
        if (systemPrompt.isNotBlank()) service?.systemPrompt = systemPrompt
        service?.connect()
        finish()
    }

    override fun onStatus(connected: Boolean, message: String) {}
    override fun onMode(mode: String) {}

    override fun onLog(line: String) {
        logText.append("$line\n")
        // unbounded over a long session otherwise — TextView.append() gets progressively more
        // expensive as the backing text grows, and this screen can stay open for a while
        val text = logText.text
        if (text.length > MAX_LOG_CHARS) {
            logText.text = text.subSequence(text.length - MAX_LOG_CHARS, text.length)
        }
        logScroll.post { logScroll.fullScroll(android.view.View.FOCUS_DOWN) }
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
