package com.kokonadahealth.lab

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Bundle
import android.os.PowerManager
import androidx.core.content.ContextCompat
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.bridge.Arguments
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.facebook.react.modules.i18nmanager.I18nUtil

// The Design Lab's only activity (MB-084, MB-085). It exists in the `lab` build type alone: this
// source set and the lab manifest are merged into no other variant, so no build that can be uploaded
// carries it. It is opened by an explicit intent with launch arguments (adb, the capture harness),
// never by a deep link, and it is a thin adapter: every argument is checked in JS (params.ts,
// protocol.ts), and the names it shares with JS are pinned by nativeContract.test.ts.
//   · launch:    string extras -> initial prop "labArgs"; the names of any other extras ->
//                "nonStringKeys" (refused in JS); PowerManager.isPowerSaveMode -> "powerSave"
//   · onNewIntent: the same split -> device event "labCommand" { args, nonStringKeys }
//   · a power-save change -> device event "labPowerSave" { powerSave }
class DesignLabActivity : ReactActivity() {

  // The component index.lab.js registers; labExclusion.test.ts keeps the two names equal.
  override fun getMainComponentName(): String = "KokonadaLab"

  override fun onCreate(savedInstanceState: Bundle?) {
    // F-13: the device captures are Hebrew, right to left. Set before React starts so the first
    // layout is already mirrored. The preference belongs to the lab package alone.
    I18nUtil.instance.allowRTL(this, true)
    I18nUtil.instance.forceRTL(this, true)
    super.onCreate(savedInstanceState)
  }

  override fun createReactActivityDelegate(): ReactActivityDelegate =
      object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {
        override fun getLaunchOptions(): Bundle {
          val (strings, nonString) = splitExtras(intent?.extras)
          return Bundle().apply {
            putBundle("labArgs", strings)
            putStringArrayList("nonStringKeys", nonString)
            putBoolean("powerSave", isPowerSaveMode())
          }
        }
      }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    val (strings, nonString) = splitExtras(intent.extras)
    val event = Arguments.createMap().apply {
      putMap("args", Arguments.fromBundle(strings))
      putArray("nonStringKeys", Arguments.fromList(nonString))
    }
    emit("labCommand", event)
  }

  private val powerSaveReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) = emitPowerSave()
  }

  override fun onResume() {
    super.onResume()
    ContextCompat.registerReceiver(
        this, powerSaveReceiver, IntentFilter(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED),
        ContextCompat.RECEIVER_NOT_EXPORTED)
    // A change while the lab was in the background is reported on return.
    emitPowerSave()
  }

  override fun onPause() {
    unregisterReceiver(powerSaveReceiver)
    super.onPause()
  }

  private fun emitPowerSave() =
      emit("labPowerSave", Arguments.createMap().apply { putBoolean("powerSave", isPowerSaveMode()) })

  private fun isPowerSaveMode(): Boolean =
      getSystemService(PowerManager::class.java)?.isPowerSaveMode == true

  // Before React is ready there is no one to tell; the harness only commands after READY.
  private fun emit(name: String, payload: Any) {
    reactHost?.currentReactContext?.emitDeviceEvent(name, payload)
  }

  // String extras, and the names of every extra that is not a string (adb --ei, --ez, --ef ...).
  private fun splitExtras(extras: Bundle?): Pair<Bundle, ArrayList<String>> {
    val strings = Bundle()
    val nonString = ArrayList<String>()
    extras?.keySet()?.sorted()?.forEach { key ->
      @Suppress("DEPRECATION") val value = extras.get(key)
      if (value is String) strings.putString(key, value) else nonString.add(key)
    }
    return strings to nonString
  }
}
