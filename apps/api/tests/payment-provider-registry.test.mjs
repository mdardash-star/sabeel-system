import test from 'node:test';
import assert from 'node:assert/strict';
import { listPaymentProviders, assertPaymentProviderReady } from '../src/payments/provider-registry.mjs';

test('payment providers are disabled when secrets are missing',()=>{
 const methods=listPaymentProviders({});
 assert.equal(methods.find(x=>x.id==='tap')?.enabled,false);
 assert.equal(methods.find(x=>x.id==='tabby')?.enabled,false);
 assert.equal(methods.every(x=>x.mode==='native_sdk'),true);
});

test('tap-backed methods become enabled with Tap secret',()=>{
 const methods=listPaymentProviders({TAP_SECRET_KEY:'secret'});
 assert.equal(methods.find(x=>x.id==='tap')?.enabled,true);
 assert.equal(methods.find(x=>x.id==='mada')?.enabled,true);
 assert.equal(methods.find(x=>x.id==='cards')?.enabled,true);
});

test('provider readiness reports missing configuration safely',()=>{
 const result=assertPaymentProviderReady('tabby',{});
 assert.equal(result.ok,false);
 assert.equal(result.status,503);
 assert.equal(result.error,'payment_provider_not_configured');
});

test('unknown provider is rejected',()=>{
 const result=assertPaymentProviderReady('unknown',{});
 assert.deepEqual(result,{ok:false,status:404,error:'payment_provider_not_found'});
});
