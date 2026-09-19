import test from'node:test';
import assert from'node:assert/strict';
import{tenantContext}from'../src/auth/tenant-context.mjs';

test('derives tenant only from authenticated organization membership',()=>{
  assert.deepEqual(tenantContext({organization_id:'00000000-0000-4000-8000-000000000001'}),{tenantId:'00000000-0000-4000-8000-000000000001'});
});

test('fails closed when authenticated session has no valid tenant',()=>{
  assert.throws(()=>tenantContext({organization_id:'forged'}),/Tenant context unavailable/);
  assert.throws(()=>tenantContext({}),/Tenant context unavailable/);
});
