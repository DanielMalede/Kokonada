// Copy to android/app/src/main/java/<your.package>/PermissionsRationaleActivity.kt, and add the four
// privacy_policy_* strings from KokonadaHealth/android/app/src/main/res/values/strings.xml (the
// address is privacy_policy_url, translatable="false"; never put it in a values-* folder).
// This is the shipped activity, code for code (rationaleActivity.test.ts fails if they differ).

package com.kokonadahealth

import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Typeface
import android.net.Uri
import android.net.http.SslError
import android.os.Bundle
import android.util.TypedValue
import android.view.View
import android.view.ViewGroup
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

// The privacy policy, as Health Connect opens it from its privacy-policy link (HX-5).
//   - Android 13 and below: Health Connect sends androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE,
//     which only this activity declares. Android 14 and above: the system opens the manifest's
//     ViewPermissionUsageActivity alias, which targets this activity.
//   - It shows one page: R.string.privacy_policy_url, the address the app's own links open
//     (src/legal/legalLinks.ts) and the one filed in Play Console. A link on that page to anywhere
//     else leaves for the browser or the mail app. Nothing else ever loads in this WebView, so no
//     sign-in or account page can run inside the app.
//   - The activity is exported, so it reads nothing from whatever started it.
//   - When the page cannot be shown (offline, an HTTP error, a certificate error, a redirect away
//     from the policy, a crashed renderer), it says so in plain text and gives the address.
//   - Back belongs to the system: only the policy loads here, so there is no page history to walk.
// mobile/native-snippets/PermissionsRationaleActivity.kt is a copy for hand-built setups;
// rationaleActivity.test.ts keeps the two identical.
class PermissionsRationaleActivity : AppCompatActivity() {
  private lateinit var frame: FrameLayout
  private var webView: WebView? = null
  private var policyLoaded = false
  private var fellBack = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    title = getString(R.string.privacy_policy_label)
    frame = FrameLayout(this)
    // Edge-to-edge is forced at targetSdk 36: keep the page and the fallback clear of the system
    // bars and any display cutout.
    ViewCompat.setOnApplyWindowInsetsListener(frame) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
    setContentView(frame)

    val policy = policyUri()
    if (policy == null) {
      showFallback()
      return
    }
    val web = WebView(this)
    web.settings.javaScriptEnabled = false
    web.settings.allowFileAccess = false
    web.settings.allowContentAccess = false
    web.webViewClient = PolicyClient(policy)
    webView = web
    frame.addView(web, FrameLayout.LayoutParams(MATCH, MATCH))
    web.loadUrl(policy.toString())
  }

  override fun onDestroy() {
    webView?.let { web ->
      frame.removeView(web)
      web.destroy()
    }
    webView = null
    super.onDestroy()
  }

  // The address as a Uri, or null when the resource is not a plain https address with a host.
  private fun policyUri(): Uri? {
    val uri = Uri.parse(getString(R.string.privacy_policy_url))
    return if (uri.scheme == "https" && !uri.host.isNullOrEmpty()) uri else null
  }

  // Exactly the policy: the same scheme, host, port and path. The query and fragment are ignored,
  // so an in-page anchor stays on the policy.
  private fun isPolicy(url: Uri, policy: Uri): Boolean =
    url.scheme == "https" && url.host == policy.host && url.port == policy.port && url.path == policy.path

  // A link the reader tapped on the policy page, or the fallback's button. The web and e-mail go to
  // the app that handles them; any other scheme (intent:, javascript:, file:, content:, ...) is
  // dropped.
  private fun openOutside(url: Uri) {
    val scheme = url.scheme?.lowercase() ?: return
    if (scheme !in OUTSIDE_SCHEMES) return
    try {
      startActivity(Intent(Intent.ACTION_VIEW, url).addCategory(Intent.CATEGORY_BROWSABLE))
    } catch (e: ActivityNotFoundException) {
      // Nothing on the device opens it; the screen stays as it is.
    }
  }

  private fun showFallback() {
    if (fellBack) return
    fellBack = true
    webView?.let { web ->
      web.stopLoading()
      frame.removeView(web)
    }
    frame.addView(fallbackView(), FrameLayout.LayoutParams(MATCH, MATCH))
  }

  // Plain text and the address, selectable, from the same resource the WebView loads.
  private fun fallbackView(): View {
    val gap = dp(16)
    val column = LinearLayout(this)
    column.orientation = LinearLayout.VERTICAL
    column.setPadding(dp(24), dp(24), dp(24), dp(24))

    val heading = TextView(this)
    heading.text = getString(R.string.privacy_policy_label)
    heading.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
    heading.setTypeface(heading.typeface, Typeface.BOLD)
    ViewCompat.setAccessibilityHeading(heading, true)
    column.addView(heading)

    val reason = TextView(this)
    reason.text = getString(R.string.privacy_policy_unavailable)
    reason.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
    reason.setPadding(0, gap, 0, gap / 2)
    column.addView(reason)

    val address = TextView(this)
    address.text = getString(R.string.privacy_policy_url)
    address.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
    address.setTextIsSelectable(true)
    column.addView(address)

    policyUri()?.let { policy ->
      val open = Button(this)
      open.text = getString(R.string.privacy_policy_open_in_browser)
      open.setOnClickListener { openOutside(policy) }
      val params = LinearLayout.LayoutParams(WRAP, WRAP)
      params.topMargin = gap
      column.addView(open, params)
    }

    val scroll = ScrollView(this)
    scroll.addView(column)
    return scroll
  }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

  private inner class PolicyClient(private val policy: Uri) : WebViewClient() {
    override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
      if (request == null) return true
      val url = request.url
      if (isPolicy(url, policy)) return false
      if (request.isForMainFrame && (request.isRedirect || !policyLoaded)) {
        // Sent somewhere else before the policy has shown, or redirected away from it: never follow
        // that, and never pass it to another app.
        showFallback()
      } else if (request.hasGesture()) {
        openOutside(url)
      }
      return true
    }

    // Whatever the route, a page that finishes anywhere but the policy is not shown.
    override fun onPageFinished(view: WebView?, url: String?) {
      if (fellBack) return
      if (url != null && isPolicy(Uri.parse(url), policy)) policyLoaded = true else showFallback()
    }

    override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
      if (request?.isForMainFrame == true) showFallback()
    }

    override fun onReceivedHttpError(view: WebView?, request: WebResourceRequest?, errorResponse: WebResourceResponse?) {
      val statusCode = errorResponse?.statusCode ?: return
      if (request?.isForMainFrame == true && statusCode >= 400) showFallback()
    }

    // A certificate error: refuse the page, never proceed, and show the address instead.
    override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
      handler?.cancel()
      showFallback()
    }

    // The WebView's renderer died: show the address rather than let the app go down with it.
    override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
      showFallback()
      webView?.destroy()
      webView = null
      return true
    }
  }

  private companion object {
    const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
    const val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT
    val OUTSIDE_SCHEMES = setOf("https", "http", "mailto")
  }
}
