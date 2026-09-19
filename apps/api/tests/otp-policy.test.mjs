import test from 'node:test';
import assert from 'node:assert/strict';
import { otpPolicy, isOtpExpired, canAttemptVerification, canResend } from '../src/auth/otp-policy.mjs';

const now = new Date('2026-09-14T18:00:00Z');

test('OTP policy uses six digits and five minute expiry', () => {
  assert.equal(otpPolicy.digits, 6);
  assert.equal(otpPolicy.ttlSeconds, 300);
});

test('OTP expires after TTL', () => {
  assert.equal(isOtpExpired('2026-09-14T17:54:59Z', now), true);
  assert.equal(isOtpExpired('2026-09-14T17:59:00Z', now), false);
});

test('verification attempts stop at configured maximum', () => {
  assert.equal(canAttemptVerification(4), true);
  assert.equal(canAttemptVerification(5), false);
});

test('resend respects cooldown', () => {
  assert.equal(canResend('2026-09-14T17:59:30Z', now), false);
  assert.equal(canResend('2026-09-14T17:58:00Z', now), true);
});
