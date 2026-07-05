package com.kokonada.spotifyremote

import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.spotify.android.appremote.api.ConnectionParams
import com.spotify.android.appremote.api.Connector
import com.spotify.android.appremote.api.SpotifyAppRemote
import com.spotify.android.appremote.api.error.CouldNotFindSpotifyApp
import com.spotify.android.appremote.api.error.NotLoggedInException
import java.util.concurrent.atomic.AtomicBoolean

// Extends the codegen-generated abstract spec NativeSpotifyRemoteSpec (produced from
// src/NativeSpotifyRemote.ts). If the generated method signatures differ (they are
// deterministic from the JS spec), align the overrides to the generated class.
@ReactModule(name = SpotifyRemoteModule.NAME)
class SpotifyRemoteModule(private val reactContext: ReactApplicationContext) :
  NativeSpotifyRemoteSpec(reactContext) {

  companion object {
    const val NAME = "SpotifyRemote"
    // The App Remote binds to a possibly-cold Spotify service; the first handshake often
    // misses the SDK's internal deadline ("Result was not delivered on time"). Retry a few
    // times with linear backoff to let the service wake, before surfacing the failure.
    private const val MAX_CONNECT_RETRIES = 3
    private const val CONNECT_BACKOFF_BASE_MS = 700L
    // Absolute safety net: SpotifyAppRemote.connect() can hang WITHOUT ever invoking the
    // listener (asleep service / lost bindService) — the JS promise would then never settle
    // and the player controller wedges in 'connecting' forever. Force-reject past this bound.
    private const val CONNECT_WATCHDOG_MS = 20_000L
  }

  private var clientId: String = ""
  private var redirectUri: String = ""
  private var appRemote: SpotifyAppRemote? = null
  private var listenerCount = 0
  private val mainHandler = Handler(Looper.getMainLooper())

  override fun getName(): String = NAME

  override fun configure(clientId: String, redirectUri: String) {
    this.clientId = clientId
    this.redirectUri = redirectUri
  }

  override fun isSpotifyInstalled(promise: Promise) {
    promise.resolve(SpotifyAppRemote.isSpotifyInstalled(reactContext))
  }

  override fun connect(promise: Promise) {
    if (clientId.isBlank()) return promise.reject("CONNECTION_FAILED", "configure() not called")
    // settled guarantees the JS promise resolves/rejects EXACTLY once across the callback,
    // the retries, and the watchdog (which race on separate main-thread posts).
    val settled = AtomicBoolean(false)
    val watchdog = Runnable {
      if (settled.compareAndSet(false, true)) {
        Log.w(NAME, "connect watchdog fired — no App Remote callback within ${CONNECT_WATCHDOG_MS}ms")
        promise.reject("CONNECTION_FAILED", "connect timed out (no App Remote callback)")
      }
    }
    mainHandler.postDelayed(watchdog, CONNECT_WATCHDOG_MS)
    // SpotifyAppRemote.connect() MUST run on the main/UI thread — it binds the Spotify service
    // and registers receivers against the activity. A TurboModule async method runs on a
    // background thread, where connect() can hang and NEVER invoke the listener (no
    // onConnected/onFailure) → the promise never settles and the player wedges in 'connecting'.
    // Dispatch every attempt (including the first) to main.
    mainHandler.post { attemptConnect(promise, 0, settled, watchdog) }
  }

  private fun attemptConnect(promise: Promise, attempt: Int, settled: AtomicBoolean, watchdog: Runnable) {
    // App Remote's consent view (showAuthView) is launched as an Activity and returns its
    // result via onActivityResult — so connect() MUST be given the CURRENT ACTIVITY, not the
    // application context. With the app context the consent popup still appears, but its result
    // has no Activity to deliver back to, so neither onConnected nor onFailure ever fires and
    // the handshake hangs (observed: popup shown → user agrees → 20s watchdog, no callback).
    val activity = reactContext.currentActivity
    val ctx = activity ?: reactContext
    Log.d(NAME, "attemptConnect #$attempt ctx=${if (activity != null) "activity" else "APP(no activity!)"} installed=${SpotifyAppRemote.isSpotifyInstalled(reactContext)}")
    val params = ConnectionParams.Builder(clientId)
      .setRedirectUri(redirectUri)
      .showAuthView(true)
      .build()
    SpotifyAppRemote.connect(ctx, params, object : Connector.ConnectionListener {
      override fun onConnected(remote: SpotifyAppRemote) {
        Log.d(NAME, "onConnected")
        appRemote = remote
        remote.playerApi.subscribeToPlayerState().setErrorCallback {
          appRemote = null
          emit("remoteDisconnected")
        }
        if (settled.compareAndSet(false, true)) {
          mainHandler.removeCallbacks(watchdog)
          promise.resolve(null)
        }
      }
      override fun onFailure(error: Throwable) {
        Log.w(NAME, "onFailure attempt=$attempt ${error.javaClass.simpleName}: ${error.message}")
        val code = when (error) {
          is CouldNotFindSpotifyApp -> "SPOTIFY_NOT_INSTALLED"
          is NotLoggedInException -> "NOT_LOGGED_IN"
          else -> "CONNECTION_FAILED"
        }
        // A generic CONNECTION_FAILED ("Result was not delivered on time") is a transient
        // IPC/bindService timeout against a cold Spotify service — retry with backoff. Never
        // retry a deterministic failure (Spotify not installed / user not logged in).
        if (code == "CONNECTION_FAILED" && attempt < MAX_CONNECT_RETRIES) {
          mainHandler.postDelayed(
            { attemptConnect(promise, attempt + 1, settled, watchdog) },
            CONNECT_BACKOFF_BASE_MS * (attempt + 1)
          )
        } else if (settled.compareAndSet(false, true)) {
          mainHandler.removeCallbacks(watchdog)
          promise.reject(code, error.message ?: error.javaClass.simpleName, error)
        }
      }
    })
  }

  override fun isConnected(promise: Promise) {
    promise.resolve(appRemote?.isConnected == true)
  }

  override fun playUri(uri: String, promise: Promise) {
    val remote = appRemote?.takeIf { it.isConnected }
      ?: return promise.reject("CONNECTION_FAILED", "not connected")
    remote.playerApi.play(uri)
      .setResultCallback { promise.resolve(null) }
      .setErrorCallback { promise.reject("CONNECTION_FAILED", it.message, it) }
  }

  override fun pause(promise: Promise) {
    val remote = appRemote?.takeIf { it.isConnected }
      ?: return promise.reject("CONNECTION_FAILED", "not connected")
    remote.playerApi.pause()
      .setResultCallback { promise.resolve(null) }
      .setErrorCallback { promise.reject("CONNECTION_FAILED", it.message, it) }
  }

  override fun resume(promise: Promise) {
    val remote = appRemote?.takeIf { it.isConnected }
      ?: return promise.reject("CONNECTION_FAILED", "not connected")
    remote.playerApi.resume()
      .setResultCallback { promise.resolve(null) }
      .setErrorCallback { promise.reject("CONNECTION_FAILED", it.message, it) }
  }

  override fun getPlayerState(promise: Promise) {
    val remote = appRemote?.takeIf { it.isConnected }
      ?: return promise.reject("CONNECTION_FAILED", "not connected")
    remote.playerApi.playerState
      .setResultCallback { state ->
        val map = Arguments.createMap()
        map.putBoolean("isPaused", state.isPaused)
        map.putString("trackUri", state.track?.uri)
        promise.resolve(map)
      }
      .setErrorCallback { promise.reject("CONNECTION_FAILED", it.message, it) }
  }

  override fun disconnect(promise: Promise) {
    appRemote?.let { SpotifyAppRemote.disconnect(it) }
    appRemote = null
    promise.resolve(null)
  }

  override fun addListener(eventName: String) { listenerCount += 1 }

  override fun removeListeners(count: Double) { listenerCount -= count.toInt() }

  private fun emit(event: String) {
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(event, null)
  }
}
