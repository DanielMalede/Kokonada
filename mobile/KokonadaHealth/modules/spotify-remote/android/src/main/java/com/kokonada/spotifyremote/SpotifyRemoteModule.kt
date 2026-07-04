package com.kokonada.spotifyremote

import android.os.Handler
import android.os.Looper
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
    attemptConnect(promise, 0)
  }

  private fun attemptConnect(promise: Promise, attempt: Int) {
    val params = ConnectionParams.Builder(clientId)
      .setRedirectUri(redirectUri)
      .showAuthView(true)
      .build()
    SpotifyAppRemote.connect(reactContext, params, object : Connector.ConnectionListener {
      override fun onConnected(remote: SpotifyAppRemote) {
        appRemote = remote
        remote.playerApi.subscribeToPlayerState().setErrorCallback {
          appRemote = null
          emit("remoteDisconnected")
        }
        promise.resolve(null)
      }
      override fun onFailure(error: Throwable) {
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
            { attemptConnect(promise, attempt + 1) },
            CONNECT_BACKOFF_BASE_MS * (attempt + 1)
          )
        } else {
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
