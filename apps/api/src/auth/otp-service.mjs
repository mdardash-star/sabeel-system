import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { otpPolicy, canResend } from './otp-policy.mjs';
import { parseBearerToken } from './session-auth.mjs';
import { withTransaction } from '../persistence/transactions.mjs';

const sessionTtlSeconds = 30 * 24 * 60 * 60;

export function normalizeSaudiMobile(value) {
  if (typeof value !== 'string') return null;
  const digits = value.trim().replace(/[\s()-]/g, '');
  if (/^5\d{8}$/.test(digits)) return `+966${digits}`;
  if (/^05\d{8}$/.test(digits)) return `+966${digits.slice(1)}`;
  if (/^9665\d{8}$/.test(digits)) return `+${digits}`;
  if (/^\+9665\d{8}$/.test(digits)) return digits;
  return null;
}

export async function requestOtp({ db, mobile: rawMobile, sendOtp, hashSecret, now = new Date(), codeFactory = generateOtp }) {
  const mobile = normalizeSaudiMobile(rawMobile);
  if (!mobile) throw new Error('Invalid Saudi mobile');
  assertOtpDependencies({ db, sendOtp, hashSecret });
  if (typeof sendOtp !== 'function') throw new Error('OTP sender unavailable');

  return withTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [mobile]);
    const latest = await client.query(
      `SELECT sent_at
       FROM otp_challenges
       WHERE mobile = $1 AND purpose = 'login'
       ORDER BY created_at DESC
       LIMIT 1`,
      [mobile]
    );
    if (latest.rows[0] && !canResend(latest.rows[0].sent_at, now)) {
      throw new Error('OTP resend cooldown');
    }

    const code = String(codeFactory()).padStart(otpPolicy.digits, '0');
    if (!/^\d{6}$/.test(code)) throw new Error('OTP generator returned invalid code');
    const expiresAt = new Date(now.getTime() + otpPolicy.ttlSeconds * 1000);
    const codeHash = hashOtp(mobile, code, hashSecret);

    await client.query(
      `INSERT INTO otp_challenges (mobile, purpose, code_hash, expires_at, sent_at)
       VALUES ($1, 'login', $2, $3, $4)`,
      [mobile, codeHash, expiresAt.toISOString(), now.toISOString()]
    );
    await sendOtp({ mobile, code, expiresInSeconds: otpPolicy.ttlSeconds });

    return {
      expiresInSeconds: otpPolicy.ttlSeconds,
      resendAfterSeconds: otpPolicy.resendCooldownSeconds
    };
  });
}

export async function verifyOtp({ db, mobile: rawMobile, code, hashSecret, now = new Date(), tokenFactory = generateSessionToken }) {
  const mobile = normalizeSaudiMobile(rawMobile);
  if (!mobile) throw new Error('Invalid Saudi mobile');
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new Error('Invalid OTP format');
  assertOtpDependencies({ db, hashSecret });

  const outcome = await withTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [mobile]);
    const challengeResult = await client.query(
      `SELECT id, code_hash, attempts, expires_at
       FROM otp_challenges
       WHERE mobile = $1 AND purpose = 'login' AND consumed_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [mobile]
    );
    const challenge = challengeResult.rows[0];
    if (!challenge) return { error: 'OTP challenge not found' };
    if (new Date(challenge.expires_at).getTime() <= now.getTime()) return { error: 'OTP expired' };
    if (Number(challenge.attempts) >= otpPolicy.maxAttempts) return { error: 'OTP attempts exceeded' };

    const expectedHash = hashOtp(mobile, code, hashSecret);
    if (!safeHexEqual(challenge.code_hash, expectedHash)) {
      await client.query(
        `UPDATE otp_challenges
         SET attempts = LEAST(attempts + 1, $2)
         WHERE id = $1`,
        [challenge.id, otpPolicy.maxAttempts]
      );
      return { error: 'OTP invalid' };
    }

    await client.query('UPDATE otp_challenges SET consumed_at = $2 WHERE id = $1', [challenge.id, now.toISOString()]);
    let userResult = await client.query(
      'SELECT id, role, is_active, organization_id FROM users WHERE mobile = $1 LIMIT 1',
      [mobile]
    );
    let user = userResult.rows[0];
    if (user && !user.is_active) return { error: 'User inactive' };

    if (!user) {
      userResult = await client.query(
        `INSERT INTO users (mobile, role)
         VALUES ($1, 'customer')
         RETURNING id, role, is_active, organization_id`,
        [mobile]
      );
      user = userResult.rows[0];
      await client.query('INSERT INTO customers (user_id) VALUES ($1)', [user.id]);
    }

    const token = tokenFactory();
    if (typeof token !== 'string' || token.length < 32) throw new Error('Session token generator returned weak token');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(now.getTime() + sessionTtlSeconds * 1000);
    await client.query(
      `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt.toISOString()]
    );
    await client.query(
      `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, data)
       VALUES ($1, 'auth.login', 'user', $1, $2::jsonb)`,
      [user.id, JSON.stringify({ channel: 'mobile_otp' })]
    );

    return {
      token,
      expiresAt: expiresAt.toISOString(),
      user: { id: user.id, role: user.role, organizationId: user.organization_id }
    };
  });

  if (outcome.error) throw new Error(outcome.error);
  return outcome;
}

export async function revokeSession({ db, authorization, now = new Date() }) {
  if (!db?.query) throw new Error('Authentication database unavailable');
  const token = parseBearerToken(authorization);
  if (!token) return false;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const result = await db.query(
    `UPDATE auth_sessions
     SET revoked_at = $2
     WHERE token_hash = $1 AND revoked_at IS NULL
     RETURNING id`,
    [tokenHash, now.toISOString()]
  );
  return result.rows.length > 0;
}

function assertOtpDependencies({ db, sendOtp, hashSecret }) {
  if (!db?.connect) throw new Error('Authentication database unavailable');
  if (sendOtp !== undefined && typeof sendOtp !== 'function') throw new Error('OTP sender unavailable');
  if (typeof hashSecret !== 'string' || hashSecret.length < 32) throw new Error('OTP hash secret unavailable');
}

function hashOtp(mobile, code, secret) {
  return createHmac('sha256', secret).update(`${mobile}:${code}`).digest('hex');
}

function safeHexEqual(left, right) {
  if (typeof left !== 'string' || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function generateOtp() {
  return randomInt(0, 10 ** otpPolicy.digits).toString().padStart(otpPolicy.digits, '0');
}

function generateSessionToken() {
  return randomBytes(32).toString('base64url');
}
