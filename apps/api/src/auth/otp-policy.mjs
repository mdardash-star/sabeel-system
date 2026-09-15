export const otpPolicy = Object.freeze({
  digits: 6,
  ttlSeconds: 300,
  resendCooldownSeconds: 60,
  maxAttempts: 5
});

export function isOtpExpired(createdAt, now = new Date()) {
  const ageMs = now.getTime() - new Date(createdAt).getTime();
  return ageMs < 0 || ageMs > otpPolicy.ttlSeconds * 1000;
}

export function canAttemptVerification(attempts) {
  return Number(attempts) < otpPolicy.maxAttempts;
}

export function canResend(lastSentAt, now = new Date()) {
  if (!lastSentAt) return true;
  return now.getTime() - new Date(lastSentAt).getTime() >= otpPolicy.resendCooldownSeconds * 1000;
}
