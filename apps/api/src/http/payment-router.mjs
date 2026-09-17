import { listPaymentProviders, assertPaymentProviderReady } from '../payments/provider-registry.mjs';

export async function routePaymentRequest({ method, url, role, body = {}, context = {} }) {
  if (method === 'GET' && url === '/api/v1/payments/methods') {
    if (!['customer','super_admin','admin'].includes(role)) return { status: 403, data: { error: 'forbidden' } };
    return { status: 200, data: { methods: listPaymentProviders().filter(item => item.enabled), all: listPaymentProviders() } };
  }

  if (method === 'POST' && url === '/api/v1/payments/session') {
    if (role !== 'customer') return { status: 403, data: { error: 'forbidden' } };
    const providerId = String(body.provider || '').trim();
    const orderId = String(body.orderId || body.order_id || '').trim();
    const amount = Number(body.amount);
    const currency = String(body.currency || 'SAR').toUpperCase();
    if (!providerId || !orderId || !Number.isFinite(amount) || amount <= 0) {
      return { status: 400, data: { error: 'invalid_payment_request' } };
    }
    if (currency !== 'SAR') return { status: 400, data: { error: 'unsupported_currency' } };
    const readiness = assertPaymentProviderReady(providerId);
    if (!readiness.ok) return { status: readiness.status, data: { error: readiness.error, provider: readiness.provider || null } };

    return {
      status: 200,
      data: {
        provider: providerId,
        orderId,
        amount,
        currency,
        mode: 'native_sdk',
        status: 'ready_for_native_initialization',
        customerId: context.userId || null
      }
    };
  }

  return null;
}
