import test from 'node:test';
import assert from 'node:assert/strict';
import { routePersistentRequest } from '../src/http/persistent-router.mjs';

test('support reads maintenance dashboard stats',async()=>{
  const db={query:async(sql)=>{assert.match(sql,/due_7_days/);assert.match(sql,/due_30_days/);return{rows:[{active:22,overdue:4,due_7_days:3,due_30_days:8}]};}};
  const result=await routePersistentRequest({method:'GET',url:'/api/v1/maintenance/stats',role:'support',db});
  assert.deepEqual(result,{status:200,data:{stats:{active:22,overdue:4,due_7_days:3,due_30_days:8}}});
});

test('support filters and paginates maintenance worklist',async()=>{
  const db={query:async(sql,params)=>{assert.match(sql,/JOIN customers/);assert.match(sql,/days_until_due/);assert.match(sql,/WHEN 'overdue'/);assert.deepEqual(params,['محمد','overdue',10,20]);return{rows:[{id:'asset-1',customer_id:'c1',customer_name:'محمد',days_until_due:-3,total_count:4}]};}};
  const result=await routePersistentRequest({method:'GET',url:'/api/v1/maintenance/assets',role:'branch_manager',context:{query:'محمد',window:'overdue',limit:'10',offset:'20'},db});
  assert.equal(result.status,200);assert.equal(result.data.assets[0].days_until_due,-3);
  assert.deepEqual(result.data.pagination,{limit:10,offset:20,total:4});assert.equal(result.data.window,'overdue');
});

test('maintenance worklist rejects invalid window before database access',async()=>{
  const db={query:async()=>{throw new Error('must not query');}};
  const result=await routePersistentRequest({method:'GET',url:'/api/v1/maintenance/assets',role:'support',context:{window:'year'},db});
  assert.deepEqual(result,{status:400,data:{error:'invalid_maintenance_window'}});
});

test('technician cannot access maintenance management data',async()=>{
  const db={query:async()=>{throw new Error('must not query');}};
  const result=await routePersistentRequest({method:'GET',url:'/api/v1/maintenance/stats',role:'technician',db});
  assert.deepEqual(result,{status:403,data:{error:'forbidden'}});
});
