import SwiftUI
import WebKit

struct ContentView: View {
    var body: some View {
        SubilWebView(url: URL(string: "https://subil-mobile-demo.onrender.com")!)
            .ignoresSafeArea()
    }
}

struct SubilWebView: UIViewRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let controller = WKUserContentController()
        controller.add(context.coordinator, name: "SubilNativePayments")
        controller.addUserScript(WKUserScript(source: Self.bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        let webView = WKWebView(frame: .zero, configuration: configuration)
        context.coordinator.webView = webView
        webView.navigationDelegate = context.coordinator
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    static let bridgeScript = #"""
(function(){
 if(window.SubilNativePayments)return;
 const pending=new Map();let seq=0;
 window.__subilResolveNativePayment=function(id,result){const x=pending.get(String(id));if(!x)return;pending.delete(String(id));x.resolve(result)};
 window.__subilRejectNativePayment=function(id,message){const x=pending.get(String(id));if(!x)return;pending.delete(String(id));x.reject(new Error(message||'native_payment_failed'))};
 window.SubilNativePayments={isAvailable:function(){return true},start:function(request){return new Promise(function(resolve,reject){const id=String(++seq);pending.set(id,{resolve,reject});window.webkit.messageHandlers.SubilNativePayments.postMessage({id:id,request:request})})}};
})();
"""#

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        weak var webView: WKWebView?
        private var paymentWebView: WKWebView?
        private var paymentContainer: UIView?
        private var pendingPaymentId: String?

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any],
                  let id = body["id"] as? String,
                  let request = body["request"] as? [String: Any],
                  let rawUrl = request["checkoutUrl"] as? String,
                  let checkoutUrl = URL(string: rawUrl),
                  checkoutUrl.scheme == "https" else {
                resolve(id: (message.body as? [String: Any])?["id"] as? String ?? "", status: "failed", message: "invalid_checkout_url")
                return
            }
            openPayment(id: id, url: checkoutUrl)
        }

        private func openPayment(id: String, url: URL) {
            guard let root = webView else { resolve(id: id, status: "failed", message: "webview_unavailable"); return }
            closePayment(status: nil)
            pendingPaymentId = id

            let container = UIView(frame: root.bounds)
            container.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            container.backgroundColor = .systemBackground

            let configuration = WKWebViewConfiguration()
            configuration.websiteDataStore = .default()
            configuration.allowsInlineMediaPlayback = true
            let payment = WKWebView(frame: container.bounds, configuration: configuration)
            payment.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            payment.navigationDelegate = self
            container.addSubview(payment)

            let close = UIButton(type: .system)
            close.setTitle("إغلاق", for: .normal)
            close.titleLabel?.font = .boldSystemFont(ofSize: 16)
            close.backgroundColor = UIColor.systemBackground.withAlphaComponent(0.92)
            close.layer.cornerRadius = 12
            close.frame = CGRect(x: 16, y: 48, width: 72, height: 40)
            close.addTarget(self, action: #selector(cancelPayment), for: .touchUpInside)
            container.addSubview(close)

            root.addSubview(container)
            paymentContainer = container
            paymentWebView = payment
            payment.load(URLRequest(url: url))
        }

        @objc private func cancelPayment() {
            closePayment(status: "cancelled")
        }

        private func closePayment(status: String?, message: String? = nil) {
            let id = pendingPaymentId
            paymentWebView?.stopLoading()
            paymentWebView?.navigationDelegate = nil
            paymentWebView?.removeFromSuperview()
            paymentContainer?.removeFromSuperview()
            paymentWebView = nil
            paymentContainer = nil
            pendingPaymentId = nil
            if let id, let status { resolve(id: id, status: status, message: message) }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard webView === paymentWebView, let url = webView.url else { return }
            let host = (url.host ?? "").lowercased()
            let path = url.path.lowercased()
            if (host == "subil.store" || host.hasSuffix(".subil.store")) && path.contains("order-received") {
                closePayment(status: "pending")
            }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            guard webView === paymentWebView else { return }
            closePayment(status: "failed", message: "payment_page_load_failed")
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            guard webView === paymentWebView else { return }
            closePayment(status: "failed", message: "payment_page_load_failed")
        }

        private func resolve(id: String, status: String, message: String?) {
            var result: [String: Any] = ["status": status]
            if let message, !message.isEmpty { result["message"] = message }
            let data = (try? JSONSerialization.data(withJSONObject: result)) ?? Data("{}".utf8)
            let json = String(data: data, encoding: .utf8) ?? "{}"
            webView?.evaluateJavaScript("window.__subilResolveNativePayment(\(String(reflecting: id)), \(json));")
        }
    }
}
