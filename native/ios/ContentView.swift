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
        private let router = NativePaymentRouter()

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any], let id = body["id"] as? String, let request = body["request"] as? [String: Any] else { return }
            Task { @MainActor in
                let result = await router.start(request: request)
                let data = (try? JSONSerialization.data(withJSONObject: result)) ?? Data("{}".utf8)
                let json = String(data: data, encoding: .utf8) ?? "{}"
                webView?.evaluateJavaScript("window.__subilResolveNativePayment(\(String(reflecting:id)), \(json));")
            }
        }
    }
}

@MainActor
final class NativePaymentRouter {
    func start(request: [String: Any]) async -> [String: Any] {
        let provider = String(describing: request["provider"] ?? "")
        switch provider {
        case "tap", "amwal", "tabby", "tamara", "apple_pay", "mada", "cards", "stc_pay":
            return ["status": "failed", "message": "provider_sdk_not_installed", "providerReference": provider]
        default:
            return ["status": "failed", "message": "unsupported_payment_provider"]
        }
    }
}
