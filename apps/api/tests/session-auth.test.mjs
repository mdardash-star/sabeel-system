import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { authenticateBearer, parseBearerToken } from '../src/auth/session-auth.mjs';

const token = 'subil-session-token-0000000000001';

test('parses only sufficiently strong Bearer token format', () => {
  assert.equal(parseBearerToken(`Bearer ${token}`), token);
  assert.equal(parseBearerToken('Bearer short'), null);
  assert.equal(parseBearerToken(`Basic ${token}`), null);
});

test('authenticates by token hash and active unrevoked session', async () => {
  const db = {
    query: async (sql, params) => {
      assert.match(sql, /FROM auth_sessions s/);
      assert.match(sql, /s\.revoked_at IS NULL/);
      assert.match(sql, /u\.is_active = true/);
      assert.equal(params[0], createHash('sha256').update(token).digest('hex'));
      assert.equal(params[1], '2026-09-15T13:00:00.000Z');
      return { rows: [{ user_id: 'user-1', role: 'technician' }] };
    }
  };
  const session = await authenticateBearer(db, `Bearer ${token}`, new Date('2026-09-15T13:00:00Z'));
  assert.deepEqual(session, { user_id: 'user-1', role: 'technician' });
});

test('invalid bearer token is rejected before database query', async () => {
  const db = { query: async () => { throw new Error('must not query'); } };
  assert.equal(await authenticateBearer(db, 'Bearer short'), null);
});
