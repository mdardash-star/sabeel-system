package com.subil.customer

import android.annotation.SuppressLint
import android.app.Dialog
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView

    private val bridgeScript = """
        (function(){
          if(window.SubilNativePayments)return;
          const pending=new Map();let seq=0;
          window.__subilResolveNativePayment=function(id,result){const x=pending.get(String(id));if(!x)return;pending.delete(String(id));x.resolve(result)};
          window.__subilRejectNativePayment=function(id,message){const x=pending.get(String(id));if(!x)return;pending.delete(String(id));x.reject(new Error(message||'native_payment_failed'))};
          window.SubilNativePayments={isAvailable:function(){return true},start:function(request){return new Promise(function(resolve,reject){const id=String(++seq);pending.set(id,{resolve,reject});window.SubilAndroidPayments.start(JSON.stringify({id:id,request:request}))})}};
        })();
    """.trimIndent()

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                view?.evaluateJavascript(bridgeScript, null)
            }
        }
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
                val checkoutUrl = request.optString("checkoutUrl")
                if (id.isBlank() || !checkoutUrl.startsWith("https://")) {
                    resolve(id, "failed", "invalid_checkout_url")
                    return@runOnUiThread
                }
                openPaymentDialog(id, checkoutUrl)
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun openPaymentDialog(id: String, checkoutUrl: String) {
        val dialog = Dialog(this)
        val container = FrameLayout(this)
        val paymentView = WebView(this)
        paymentView.settings.javaScriptEnabled = true
        paymentView.settings.domStorageEnabled = true
        paymentView.settings.javaScriptCanOpenWindowsAutomatically = true
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(paymentView, true)
        var completed = false

        fun finish(status: String, message: String? = null) {
            if (completed) return
            completed = true
            dialog.setOnCancelListener(null)
            dialog.dismiss()
            paymentView.destroy()
            resolve(id, status, message)
        }

        container.addView(paymentView, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ))

        val closeButton = Button(this).apply {
            text = "إغلاق"
            setTextColor(Color.BLACK)
            setBackgroundColor(Color.WHITE)
            setOnClickListener { finish("cancelled") }
        }
        val closeParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            setMargins(24, 48, 0, 0)
        }
        container.addView(closeButton, closeParams)

        paymentView.webChromeClient = WebChromeClient()
        paymentView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                val uri = runCatching { Uri.parse(url ?: "") }.getOrNull() ?: return
                val host = uri.host?.lowercase() ?: ""
                val path = uri.path?.lowercase() ?: ""
                if ((host == "subil.store" || host.endsWith(".subil.store")) && path.contains("order-received")) {
                    finish("pending")
                }
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame == true) finish("failed", "payment_page_load_failed")
            }
        }

        dialog.setContentView(container)
        dialog.setOnCancelListener { finish("cancelled") }
        dialog.show()
        dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        paymentView.loadUrl(checkoutUrl)
    }

    private fun resolve(id: String, status: String, message: String? = null) {
        val result = JSONObject().put("status", status)
        if (!message.isNullOrBlank()) result.put("message", message)
        val script = "window.__subilResolveNativePayment(${JSONObject.quote(id)}, ${result});"
        webView.evaluateJavascript(script, null)
    }
}
