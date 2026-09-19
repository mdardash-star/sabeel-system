package com.subil.customer

import org.json.JSONObject

data class NativePaymentRequestModel(
    val provider: String,
    val orderId: String,
    val amount: Double,
    val currency: String,
    val raw: JSONObject
)

data class NativePaymentResponseModel(
    val status: String,
    val transactionId: String? = null,
    val providerReference: String? = null,
    val message: String? = null
) {
    fun toJson(): JSONObject = JSONObject().put("status", status).also { out ->
        transactionId?.let { out.put("transactionId", it) }
        providerReference?.let { out.put("providerReference", it) }
        message?.let { out.put("message", it) }
    }
}

interface PaymentAdapter {
    val providerId: String
    fun start(request: NativePaymentRequestModel): NativePaymentResponseModel
}

class UnconfiguredPaymentAdapter(override val providerId: String) : PaymentAdapter {
    override fun start(request: NativePaymentRequestModel) = NativePaymentResponseModel(
        status = "failed",
        providerReference = providerId,
        message = "provider_sdk_not_installed"
    )
}
