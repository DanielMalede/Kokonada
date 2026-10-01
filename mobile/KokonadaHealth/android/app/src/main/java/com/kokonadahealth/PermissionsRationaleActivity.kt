package com.kokonadahealth

import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.res.Configuration
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
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

// The privacy policy, as Health Connect opens it from its privacy-policy link (HX-5).
//   - Android 13 and below: Health Connect sends androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE,
//     which only this activity declares. Android 14 and above: the system opens the manifest's
//     ViewPermissionUsageActivity alias, which targets this activity.
//   - It shows one page: R.string.privacy_policy_url, the address the app's own links open
//     (src/legal/legalLinks.ts) and the one filed in Play Console. A link on that page to anywhere
//     else leaves for the browser or the mail app, and only when the reader taps it. Nothing else
//     ever loads in this WebView, so no sign-in or account page can run inside the app.
//   - The activity is exported, so it reads nothing from whatever started it.
//   - When the page cannot be shown (offline, an HTTP error, a certificate error, a redirect away
//     from the policy, a crashed renderer, a WebView that cannot be built, or a load still stalled
//     after LOAD_TIMEOUT_MS), it says so in plain text and gives the address.
//   - Back belongs to the system: only the policy loads here, so there is no page history to walk.
// mobile/native-snippets/PermissionsRationaleActivity.kt is a copy for hand-built setups;
// rationaleActivity.test.ts keeps the two identical.
class PermissionsRationaleActivity : AppCompatActivity() {
  private lateinit var frame: FrameLayout
  private var webView: WebView? = null
  private var policyLoaded = false
  private var fellBack = false
  // A load that neither finishes nor fails (a stalled connection) would otherwise stay blank.
  private val loadWatchdog = Runnable { if (!policyLoaded) showFallback() }

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
    // The bars are transparent edge-to-edge: dark icons on the Day window, light ones in Nocturne.
    val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    WindowCompat.getInsetsController(window, window.decorView).apply {
      isAppearanceLightStatusBars = !night
      isAppearanceLightNavigationBars = !night
    }

    val policy = policyUri()
    if (policy == null) {
      showFallback()
      return
    }
    // A missing or mid-update WebView provider throws here: show the address instead of crashing.
    val web = try { WebView(this) } catch (e: RuntimeException) { showFallback(); return }
    web.settings.javaScriptEnabled = false
    web.settings.allowFileAccess = false
    web.settings.allowContentAccess = false
    web.webViewClient = PolicyClient(policy)
    webView = web
    frame.addView(web, FrameLayout.LayoutParams(MATCH, MATCH))
    web.loadUrl(policy.toString())
    frame.postDelayed(loadWatchdog, LOAD_TIMEOUT_MS)
  }

  override fun onDestroy() {
    if (::frame.isInitialized) frame.removeCallbacks(loadWatchdog)
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
    val gap = dp(GAP_DP)
    val column = LinearLayout(this)
    column.orientation = LinearLayout.VERTICAL
    column.setPadding(dp(EDGE_DP), dp(EDGE_DP), dp(EDGE_DP), dp(EDGE_DP))

    val heading = TextView(this)
    heading.text = getString(R.string.privacy_policy_label)
    heading.setTextSize(TypedValue.COMPLEX_UNIT_SP, HEADING_SP)
    heading.setTypeface(heading.typeface, Typeface.BOLD)
    heading.textAlignment = View.TEXT_ALIGNMENT_VIEW_START
    ViewCompat.setAccessibilityHeading(heading, true)
    column.addView(heading)

    val reason = TextView(this)
    reason.text = getString(R.string.privacy_policy_unavailable)
    reason.setTextSize(TypedValue.COMPLEX_UNIT_SP, BODY_SP)
    reason.textAlignment = View.TEXT_ALIGNMENT_VIEW_START
    reason.setPadding(0, gap, 0, dp(TIGHT_DP))
    column.addView(reason)

    val address = TextView(this)
    address.text = getString(R.string.privacy_policy_url)
    address.setTextSize(TypedValue.COMPLEX_UNIT_SP, BODY_SP)
    address.textAlignment = View.TEXT_ALIGNMENT_VIEW_START
    address.setTextIsSelectable(true)
    column.addView(address)

    policyUri()?.let { policy ->
      val open = Button(this)
      open.text = getString(R.string.privacy_policy_open_in_browser)
      open.isAllCaps = false
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
      if (request.isForMainFrame && (request.isRedirect || (!policyLoaded && !request.hasGesture()))) {
        // Redirected away from the policy, or sent elsewhere with no tap before it has shown: never
        // follow that, and never pass it to another app.
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

    // The WebView's renderer died: detach it, show the address, then destroy it (Google's order),
    // rather than let the app go down with it.
    override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
      val dead = webView
      webView = null
      dead?.let { frame.removeView(it) }
      showFallback()
      dead?.destroy()
      return true
    }
  }

  private companion object {
    const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
    const val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT
    const val LOAD_TIMEOUT_MS = 15_000L
    // The fallback's sizes, each mirroring the app token named beside it.
    const val EDGE_DP = 24 // space.xl
    const val GAP_DP = 16 // space.lg
    const val TIGHT_DP = 8 // space.sm
    const val HEADING_SP = 22f // type.size.heading
    const val BODY_SP = 16f // type.size.body
    val OUTSIDE_SCHEMES = setOf("https", "http", "mailto")
  }
}
