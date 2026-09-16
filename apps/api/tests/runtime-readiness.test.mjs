import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRuntimeReadiness, validateRuntimeReadiness } from '../src/config/runtime-readiness.mjs';

const valid={
  NODE_ENV:'production',
  DATABASE_URL:'postgres://user:pass@db.internal:5432/subil',
  OTP_HASH_SECRET:'12345678901234567890123456789012',
  OTP_SENDER_URL:'https://sms.provider.sa/send',
  OTP_SENDER_API_KEY:'real-key',
  SUBIL_ADMIN_ORIGINS:'https://admin.subil.store',
  PUSH_PROVIDER_URL:'https://push.provider.sa/send',
  PUSH_PROVIDER_API_KEY:'push-key',
  PUSH_VAPID_PUBLIC_KEY:'public-key'
};

test('production runtime is ready when required secrets and origins are configured',()=>{
  const result=validateRuntimeReadiness(valid);
  assert.equal(result.ready,true);
  assert.deepEqual(result.errors,[]);
});

test('production runtime rejects placeholders and missing cors origin',()=>{
  const result=validateRuntimeReadiness({...valid,OTP_SENDER_URL:'https://sms-provider.example.com/send-template',SUBIL_ADMIN_ORIGINS:''});
  assert.equal(result.ready,false);
  assert.ok(result.errors.some(x=>x.includes('OTP_SENDER_URL')));
  assert.ok(result.errors.some(x=>x.includes('SUBIL_ADMIN_ORIGINS')));
});

test('runtime rejects short otp hash secret',()=>{
  assert.throws(()=>assertRuntimeReadiness({...valid,OTP_HASH_SECRET:'short'}),/OTP_HASH_SECRET/);
});

test('push configuration must be all-or-nothing',()=>{
  const result=validateRuntimeReadiness({...valid,PUSH_PROVIDER_API_KEY:'',PUSH_VAPID_PUBLIC_KEY:''});
  assert.equal(result.ready,false);
  assert.ok(result.errors.some(x=>x.includes('partially configured')));
});
