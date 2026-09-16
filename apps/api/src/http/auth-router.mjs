import { authenticateBearer } from '../auth/session-auth.mjs';
import { requestOtp, revokeSession, verifyOtp } from '../auth/otp-service.mjs';

export async function routeAuthRequest({ method, url, body = {}, authorization, db, auth = {} }) {
  try {
    if (method === 'POST' && url === '/api/v1/auth/otp/request') {
      const result = await (auth.requestOtp || requestOtp)({
        db,
        mobile: body.mobile,
        sendOtp: auth.sendOtp,
        hashSecret: auth.hashSecret
      });
      return response(202, result);
    }

    if (method === 'POST' && url === '/api/v1/auth/otp/verify') {
      const result = await (auth.verifyOtp || verifyOtp)({
        db,
        mobile: body.mobile,
        code: body.code,
        hashSecret: auth.hashSecret
      });
      return response(200, result);
    }

    if (method === 'POST' && url === '/api/v1/auth/logout') {
      await (auth.revokeSession || revokeSession)({ db, authorization });
      return response(204, null);
    }

    if (method === 'GET' && url === '/api/v1/me') {
      const user = await (auth.authenticateBearer || authenticateBearer)(db, authorization);
      if (!user) return response(401, { error: 'invalid_or_expired_session' });
      return response(200, { user: { id: user.user_id, role: user.role, organizationId: user.organization_id } });
    }
  } catch (error) {
    const mapped = mapAuthError(error.message);
    return response(mapped.status, { error: mapped.code });
  }

  return response(404, { error: 'not_found' });
}

function mapAuthError(message) {
  const errors = {
    'Invalid Saudi mobile': [400, 'invalid_mobile'],
    'Invalid OTP format': [400, 'invalid_otp_format'],
    'OTP resend cooldown': [429, 'otp_resend_cooldown'],
    'OTP challenge not found': [401, 'otp_invalid_or_expired'],
    'OTP expired': [401, 'otp_invalid_or_expired'],
    'OTP invalid': [401, 'otp_invalid_or_expired'],
    'OTP attempts exceeded': [429, 'otp_attempts_exceeded'],
    'User inactive': [403, 'user_inactive'],
    'Authentication database unavailable': [503, 'authentication_unavailable'],
    'OTP sender unavailable': [503, 'otp_sender_unavailable'],
    'OTP delivery failed': [503, 'otp_delivery_failed'],
    'OTP hash secret unavailable': [503, 'authentication_unavailable']
  };
  const [status, code] = errors[message] || [503, 'authentication_unavailable'];
  return { status, code };
}

function response(status, data) {
  return { status, data };
}
