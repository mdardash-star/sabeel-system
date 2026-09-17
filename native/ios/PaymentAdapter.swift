import Foundation

struct NativePaymentRequestModel {
    let provider: String
    let orderId: String
    let amount: Double
    let currency: String
    let raw: [String: Any]
}

struct NativePaymentResponseModel {
    let status: String
    let transactionId: String?
    let providerReference: String?
    let message: String?

    func dictionary() -> [String: Any] {
        var out: [String: Any] = ["status": status]
        if let transactionId { out["transactionId"] = transactionId }
        if let providerReference { out["providerReference"] = providerReference }
        if let message { out["message"] = message }
        return out
    }
}

@MainActor
protocol PaymentAdapter {
    var providerId: String { get }
    func start(_ request: NativePaymentRequestModel) async -> NativePaymentResponseModel
}

@MainActor
final class UnconfiguredPaymentAdapter: PaymentAdapter {
    let providerId: String
    init(providerId: String) { self.providerId = providerId }

    func start(_ request: NativePaymentRequestModel) async -> NativePaymentResponseModel {
        NativePaymentResponseModel(status: "failed", transactionId: nil, providerReference: providerId, message: "provider_sdk_not_installed")
    }
}
