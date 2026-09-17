package com.subil.customer

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private val router = NativePaymentRouter()

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.webViewClient = WebViewClient()
        webView.webChromeClient = WebChromeClient()
        webView.addJavascriptInterface(PaymentBridge(), "SubilAndroidPayments")
        setContentView(webView)
        webView.loadUrl("https://subil-mobile-demo.onrender.com")
    }

    inner class PaymentBridge {
        @JavascriptInterface
        fun start(payload: String) {
            runOnUiThread {
                val body = JSONObject(payload)
                val id = body.optString("id")
                val request = body.optJSONObject("request") ?: JSONObject()
                val result = router.start(request)
                val script = "window.__subilResolveNativePayment(${JSONObject.quote(id)}, ${result});"
                webView.evaluateJavascript(script, null)
            }
        }
    }
}

class NativePaymentRouter {
    fun start(request: JSONObject): JSONObject {
        val provider = request.optString("provider")
        return when (provider) {
            "tap", "amwal", "tabby", "tamara", "apple_pay", "mada", "cards", "stc_pay" -> JSONObject()
                .put("status", "failed")
                .put("message", "provider_sdk_not_installed")
                .put("providerReference", provider)
            else -> JSONObject().put("status", "failed").put("message", "unsupported_payment_provider")
        }
    }
}
