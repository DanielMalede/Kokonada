// Create at android/app/src/main/java/<your.package>/PermissionsRationaleActivity.kt
// Health Connect deep-links here when the user taps the privacy-policy link on the
// permission screen. Point the WebView at YOUR privacy policy before release.

package com.kokonadahealth

import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity

class PermissionsRationaleActivity : AppCompatActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val webView = WebView(this)
    webView.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean = false
    }
    // TODO: replace with your hosted privacy policy describing how health data is used.
    webView.loadUrl("https://developer.android.com/health-and-fitness/guides/health-connect/develop/get-started")
    setContentView(webView)
  }
}
