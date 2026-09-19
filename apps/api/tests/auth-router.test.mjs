import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiServer } from '../src/server.mjs';

test('HTTP OTP request and verification return a role-scoped session', async (t) => {
  const calls = [];
  const auth = {
    requestOtp: async ({ mobile }) => {
      calls.push(['request', mobile]);
      return { expiresInSeconds: 300, resendAfterSeconds: 60 };
    },
    verifyOtp: async ({ mobile, code }) => {
      calls.push(['verify', mobile, code]);
      return { token: 'strong-session-token-000000000000001', expiresAt: '2026-10-15T18:00:00.000Z', user: { id: 'user-1', role: 'admin' } };
    }
  };
  const server = createApiServer({ db: null, auth });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();

  const requestResponse = await fetch(`http://127.0.0.1:${port}/api/v1/auth/otp/request`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mobile: '+966512345678' })
  });
  assert.equal(requestResponse.status, 202);
  assert.equal((await requestResponse.json()).expiresInSeconds, 300);

  const verifyResponse = await fetch(`http://127.0.0.1:${port}/api/v1/auth/otp/verify`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mobile: '+966512345678', code: '123456' })
  });
  assert.equal(verifyResponse.status, 200);
  assert.equal((await verifyResponse.json()).user.role, 'admin');
  assert.deepEqual(calls, [['request', '+966512345678'], ['verify', '+966512345678', '123456']]);
});

test('HTTP OTP errors do not disclose whether a mobile belongs to a user', async (t) => {
  const server = createApiServer({
    db: null,
    auth: { verifyOtp: async () => { throw new Error('OTP challenge not found'); } }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/api/v1/auth/otp/verify`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mobile: '+966512345678', code: '123456' })
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'otp_invalid_or_expired' });
});

test('HTTP logout revokes the bearer session and returns no content', async (t) => {
  let authorization;
  const server = createApiServer({
    db: null,
    auth: { revokeSession: async (input) => { authorization = input.authorization; return true; } }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/api/v1/auth/logout`, {
    method: 'POST', headers: { authorization: 'Bearer strong-session-token-000000000000002' }
  });
  assert.equal(response.status, 204);
  assert.equal(authorization, 'Bearer strong-session-token-000000000000002');
});
