import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiServer } from '../src/server.mjs';

function withEnv(values, fn) {
  const before = {};
  for (const [key, value] of Object.entries(values)) {
    before[key] = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  try { return fn(); }
  finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test('OTP test mode is blocked in production', () => {
  assert.throws(() => withEnv({ NODE_ENV: 'production', SUBIL_OTP_TEST_MODE: 'true', SUBIL_OTP_TEST_CODE: '123456' }, () => createApiServer({ db: null })), /cannot run in production/);
});

test('OTP test mode validates six digit code in staging', () => {
  assert.throws(() => withEnv({ NODE_ENV: 'staging', SUBIL_OTP_TEST_MODE: 'true', SUBIL_OTP_TEST_CODE: '1234' }, () => createApiServer({ db: null })), /exactly 6 digits/);
});

test('OTP test mode can initialize outside production with a valid code', () => {
  const server = withEnv({ NODE_ENV: 'staging', SUBIL_OTP_TEST_MODE: 'true', SUBIL_OTP_TEST_CODE: '123456', OTP_HASH_SECRET: 'x'.repeat(32) }, () => createApiServer({ db: null }));
  assert.equal(typeof server.listen, 'function');
  server.close();
});
