import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { normalizeSaudiMobile, requestOtp, revokeSession, verifyOtp } from '../src/auth/otp-service.mjs';

const hashSecret = 'test-only-otp-secret-with-at-least-32-characters';
const now = new Date('2026-09-15T18:00:00Z');

test('normalizes supported Saudi mobile formats and rejects invalid numbers', () => {
  assert.equal(normalizeSaudiMobile('512345678'), '+966512345678');
  assert.equal(normalizeSaudiMobile('0512345678'), '+966512345678');
  assert.equal(normalizeSaudiMobile('966512345678'), '+966512345678');
  assert.equal(normalizeSaudiMobile('+966 51 234 5678'), '+966512345678');
  assert.equal(normalizeSaudiMobile('51111'), null);
  assert.equal(normalizeSaudiMobile('+971501234567'), null);
});

test('requests and verifies OTP then creates a hashed PostgreSQL session', async () => {
  const state = { challenge: null, sessionParams: null, sent: null };
  const client = createAuthClient(state);
  const db = { connect: async () => client };

  const requested = await requestOtp({
    db,
    mobile: '0512345678',
    sendOtp: async (message) => { state.sent = message; },
    hashSecret,
    now,
    codeFactory: () => '123456'
  });
  assert.deepEqual(requested, { expiresInSeconds: 300, resendAfterSeconds: 60 });
  assert.deepEqual(state.sent, { mobile: '+966512345678', code: '123456', expiresInSeconds: 300 });
  assert.notEqual(state.challenge.code_hash, '123456');

  const sessionToken = 'subil-secure-session-token-for-tests-00001';
  const verified = await verifyOtp({
    db,
    mobile: '+966512345678',
    code: '123456',
    hashSecret,
    now,
    tokenFactory: () => sessionToken
  });
  assert.equal(verified.user.role, 'admin');
  assert.equal(verified.token, sessionToken);
  assert.equal(state.sessionParams[1], createHash('sha256').update(sessionToken).digest('hex'));
  assert.notEqual(state.sessionParams[1], sessionToken);
  assert.equal(state.challenge.consumed, true);
});

test('invalid OTP attempt is persisted without creating a session', async () => {
  const state = { challenge: null, invalidAttempts: 0, sent: null };
  const client = createAuthClient(state);
  const db = { connect: async () => client };
  await requestOtp({ db, mobile: '512345678', sendOtp: async message => { state.sent = message; }, hashSecret, now, codeFactory: () => '123456' });

  await assert.rejects(
    verifyOtp({ db, mobile: '512345678', code: '654321', hashSecret, now }),
    /OTP invalid/
  );
  assert.equal(state.invalidAttempts, 1);
  assert.equal(state.sessionParams, undefined);
  assert.equal(client.commits, 2);
  assert.equal(client.rollbacks, 0);
});

test('revokes only a valid strong bearer session token', async () => {
  const token = 'subil-secure-session-token-for-tests-00002';
  let params;
  const db = {
    query: async (sql, values) => {
      assert.match(sql, /UPDATE auth_sessions/);
      params = values;
      return { rows: [{ id: 'session-1' }] };
    }
  };
  assert.equal(await revokeSession({ db, authorization: `Bearer ${token}`, now }), true);
  assert.equal(params[0], createHash('sha256').update(token).digest('hex'));
  assert.equal(await revokeSession({ db, authorization: 'Bearer short', now }), false);
});

function createAuthClient(state) {
  return {
    commits: 0,
    rollbacks: 0,
    async query(sql, params = []) {
      if (sql === 'BEGIN') return { rows: [] };
      if (sql === 'COMMIT') { this.commits += 1; return { rows: [] }; }
      if (sql === 'ROLLBACK') { this.rollbacks += 1; return { rows: [] }; }
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
      if (/SELECT sent_at/.test(sql)) return { rows: [] };
      if (/INSERT INTO otp_challenges/.test(sql)) {
        state.challenge = { id: 'challenge-1', code_hash: params[1], attempts: 0, expires_at: params[2], consumed: false };
        return { rows: [] };
      }
      if (/SELECT id, code_hash/.test(sql)) return { rows: state.challenge && !state.challenge.consumed ? [state.challenge] : [] };
      if (/SET attempts =/.test(sql)) { state.invalidAttempts += 1; state.challenge.attempts += 1; return { rows: [] }; }
      if (/SET consumed_at/.test(sql)) { state.challenge.consumed = true; return { rows: [] }; }
      if (/SELECT id, role, is_active FROM users/.test(sql)) return { rows: [{ id: 'user-1', role: 'admin', is_active: true }] };
      if (/INSERT INTO auth_sessions/.test(sql)) { state.sessionParams = params; return { rows: [] }; }
      if (/INSERT INTO audit_log/.test(sql)) return { rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() {}
  };
}
