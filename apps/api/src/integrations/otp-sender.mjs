export function createOtpSender({ endpoint = process.env.OTP_SENDER_URL, apiKey = process.env.OTP_SENDER_API_KEY, fetchImpl = globalThis.fetch } = {}) {
  if (!endpoint) return null;
  if (typeof fetchImpl !== 'function') throw new Error('OTP sender unavailable');

  return async function sendOtp({ mobile, code, expiresInSeconds }) {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({
        to: mobile,
        template: 'subil_login_otp',
        variables: { code, expiresInMinutes: Math.ceil(expiresInSeconds / 60) }
      })
    });
    if (!response.ok) throw new Error('OTP delivery failed');
  };
}
