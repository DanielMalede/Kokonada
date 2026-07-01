# Append to android/app/proguard-rules.pro before building a minified release.
# R8 strips/renames aggressively; these keeps prevent runtime ClassNotFound / reflection
# failures in the native modules this app uses.

# react-native-ble-plx (BLE) — uses JNI + reflection into these packages.
-keep class com.polidea.rxandroidble2.** { *; }
-keep class com.bleplx.** { *; }
-dontwarn com.polidea.rxandroidble2.**

# react-native-health-connect — Health Connect client classes reached reflectively.
-keep class dev.matinzd.healthconnect.** { *; }
-keep class androidx.health.connect.client.** { *; }
-dontwarn androidx.health.connect.client.**

# react-native-keychain
-keep class com.oblador.keychain.** { *; }

# General React Native / Hermes safety net (RN ships most of these already; harmless dupes).
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-dontwarn com.facebook.react.**
