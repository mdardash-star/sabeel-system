const PROVIDERS = [
  { id: 'tap', label: 'تاب', env: ['TAP_SECRET_KEY'], clientEnv: ['TAP_PUBLIC_KEY'], native: true },
  { id: 'amwal', label: 'أموال', env: ['AMWAL_API_KEY'], clientEnv: [], native: true },
  { id: 'tabby', label: 'تابي', env: ['TABBY_SECRET_KEY'], clientEnv: ['TABBY_PUBLIC_KEY'], native: true },
  { id: 'tamara', label: 'تمارا', env: ['TAMARA_API_TOKEN'], clientEnv: [], native: true },
  { id: 'apple_pay', label: 'Apple Pay', env: ['APPLE_PAY_MERCHANT_ID'], clientEnv: [], native: true },
  { id: 'mada', label: 'مدى', env: ['TAP_SECRET_KEY'], clientEnv: ['TAP_PUBLIC_KEY'], native: true },
  { id: 'cards', label: 'البطاقات', env: ['TAP_SECRET_KEY'], clientEnv: ['TAP_PUBLIC_KEY'], native: true },
  { id: 'stc_pay', label: 'إس تي سي باي', env: ['TAP_SECRET_KEY'], clientEnv: ['TAP_PUBLIC_KEY'], native: true }
];

function configured(keys, env) {
  return keys.every(key => Boolean(String(env[key] || '').trim()));
}

export function listPaymentProviders(env = process.env) {
  return PROVIDERS.map(provider => ({
    id: provider.id,
    label: provider.label,
    enabled: configured(provider.env, env),
    native: provider.native,
    mode: 'native_sdk',
    missing: provider.env.filter(key => !String(env[key] || '').trim())
  }));
}

export function getPaymentProvider(id, env = process.env) {
  return listPaymentProviders(env).find(provider => provider.id === id) || null;
}

export function assertPaymentProviderReady(id, env = process.env) {
  const provider = getPaymentProvider(id, env);
  if (!provider) return { ok: false, status: 404, error: 'payment_provider_not_found' };
  if (!provider.enabled) return { ok: false, status: 503, error: 'payment_provider_not_configured', provider };
  return { ok: true, provider };
}
