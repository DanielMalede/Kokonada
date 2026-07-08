package com.kokonada.spotifyremote

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class SpotifyRemotePackage : BaseReactPackage() {
  override fun getModule(name: String, ctx: ReactApplicationContext): NativeModule? =
    if (name == SpotifyRemoteModule.NAME) SpotifyRemoteModule(ctx) else null

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
      SpotifyRemoteModule.NAME to ReactModuleInfo(
        SpotifyRemoteModule.NAME,           // name
        SpotifyRemoteModule.NAME,           // className
        false,                              // canOverrideExistingModule
        false,                              // needsEagerInit
        false,                              // isCxxModule
        true,                               // isTurboModule
      ),
    )
  }
}
