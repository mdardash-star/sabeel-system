import test from 'node:test';
import assert from 'node:assert/strict';
import { routeTenantReadRequest } from '../src/http/tenant-read-router.mjs';

const tenantId='00000000-0000-4000-8000-000000000001';

test('tenant read router scopes inventory stats by tenant',async()=>{
  const db={query:async(sql,params)=>{assert.match(sql,/organization_id=\$1/);assert.deepEqual(params,[tenantId]);return{rows:[{total_skus:2,low_stock:1}]};}};
  const result=await routeTenantReadRequest({method:'GET',url:'/api/v1/inventory/stats',role:'finance',context:{tenantId},db});
  assert.equal(result.status,200);assert.equal(result.data.stats.total_skus,2);
});

test('tenant read router scopes purchasing supplier list',async()=>{
  const db={query:async(sql,params)=>{assert.match(sql,/s\.organization_id=\$1/);assert.equal(params[0],tenantId);return{rows:[{id:'s1',total_count:1}]};}};
  const result=await routeTenantReadRequest({method:'GET',url:'/api/v1/purchasing/suppliers',role:'finance',context:{tenantId,limit:'10',offset:'0'},db});
  assert.equal(result.status,200);assert.equal(result.data.pagination.total,1);
});

test('tenant read router scopes conversations by tenant',async()=>{
  const db={query:async(sql,params)=>{assert.match(sql,/cc\.organization_id=\$1/);assert.equal(params[0],tenantId);return{rows:[{id:'c1',total_count:1}]};}};
  const result=await routeTenantReadRequest({method:'GET',url:'/api/v1/conversations',role:'support',context:{tenantId},db});
  assert.equal(result.status,200);assert.equal(result.data.conversations.length,1);
});

test('tenant read router scopes AI finance anomalies',async()=>{
  const db={query:async(sql,params)=>{assert.match(sql,/organization_id=\$1/);assert.equal(params[0],tenantId);return{rows:[{id:'a1',total_count:1}]};}};
  const result=await routeTenantReadRequest({method:'GET',url:'/api/v1/ai/finance/anomalies',role:'finance',context:{tenantId},db});
  assert.equal(result.status,200);assert.equal(result.data.anomalies[0].id,'a1');
});

test('non sensitive read falls through to legacy router',async()=>{
  const db={query:async()=>{throw new Error('must not query');}};
  const result=await routeTenantReadRequest({method:'GET',url:'/api/v1/customers',role:'support',context:{tenantId},db});
  assert.equal(result,null);
});
