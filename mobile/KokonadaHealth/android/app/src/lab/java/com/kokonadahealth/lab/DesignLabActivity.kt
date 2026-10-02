package com.kokonadahealth.lab

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

// The Design Lab's only activity (MB-084). It exists in the `lab` build type alone: this source set
// and the lab manifest are merged into no other variant, so no build that can be uploaded carries
// it. The lab manifest makes it the launcher and removes the real app's activities, its network
// permission and its health and Bluetooth permissions. It is opened by an explicit intent with
// launch arguments (adb, the capture harness), never by a deep link.
class DesignLabActivity : ReactActivity() {

  // The component index.lab.js registers; labExclusion.test.ts keeps the two names equal.
  override fun getMainComponentName(): String = "KokonadaLab"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
