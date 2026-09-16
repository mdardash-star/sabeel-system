import test from 'node:test';
import assert from 'node:assert/strict';
import { routePersistentRequest } from '../src/http/persistent-router.mjs';

function customerDb(handler){return{query:handler,connect:async()=>({query:handler,release(){}})}}

test('customer reads only profile linked to signed-in user',async()=>{
  const db=customerDb(async(sql,params)=>{assert.match(sql,/c\.user_id=\$1/);assert.deepEqual(params,['u1']);return{rows:[{id:'c1',name:'سعد',mobile:'+966500000000'}]}});
  const result=await routePersistentRequest({method:'GET',url:'/api/v1/customers/me',role:'customer',context:{userId:'u1'},db});
  assert.equal(result.status,200);assert.equal(result.data.customer.id,'c1');
});

test('non-customer cannot access customer portal',async()=>{
  const result=await routePersistentRequest({method:'GET',url:'/api/v1/customers/me',role:'support',context:{userId:'u1'},db:{query:async()=>{throw new Error('must not query')}}});
  assert.equal(result.status,403);
});

test('customer orders are scoped through resolved profile',async()=>{
  let calls=0;const db=customerDb(async(sql,params)=>{calls++;if(calls===1)return{rows:[{id:'c1'}]};assert.match(sql,/FROM orders WHERE customer_id = \$1/);assert.deepEqual(params,['c1',5,0]);return{rows:[{id:'o1',total_count:1}]}});
  const result=await routePersistentRequest({method:'GET',url:'/api/v1/customers/me/orders',role:'customer',context:{userId:'u1',limit:'5'},db});
  assert.equal(result.status,200);assert.equal(result.data.orders[0].id,'o1');assert.equal(result.data.pagination.total,1);
});

test('customer portal validates pagination before list query',async()=>{
  let calls=0;const db=customerDb(async()=>{calls++;return{rows:[{id:'c1'}]}});
  const result=await routePersistentRequest({method:'GET',url:'/api/v1/customers/me/assets',role:'customer',context:{userId:'u1',limit:'0'},db});
  assert.equal(result.status,400);assert.equal(calls,1);
});

test('customer rates one owned completed service atomically',async()=>{
  const calls=[];const db=customerDb(async(sql,params=[])=>{calls.push({sql,params});if(['BEGIN','COMMIT'].includes(sql))return{rows:[]};if(/c\.user_id=\$1/.test(sql))return{rows:[{id:'c1'}]};if(/FROM service_jobs/.test(sql))return{rows:[{id:'j1',customer_id:'c1',technician_id:'t1',status:'completed'}]};if(/INSERT INTO service_ratings/.test(sql))return{rows:[{id:'r1',job_id:'j1',score:5}]};if(/INSERT INTO audit_log/.test(sql))return{rows:[]};throw new Error(`unexpected ${sql}`)});
  const result=await routePersistentRequest({method:'POST',url:'/api/v1/customers/me/jobs/j1/rating',role:'customer',context:{userId:'u1'},body:{score:5,comment:'خدمة ممتازة'},db});
  assert.equal(result.status,201);assert.equal(result.data.rating.score,5);assert.ok(calls.some(x=>/service\.rating_created/.test(x.sql)));
});

test('customer cannot rate unfinished service',async()=>{
  const db=customerDb(async sql=>{if(sql==='BEGIN'||sql==='ROLLBACK')return{rows:[]};if(/c\.user_id=\$1/.test(sql))return{rows:[{id:'c1'}]};if(/FROM service_jobs/.test(sql))return{rows:[{id:'j1',customer_id:'c1',technician_id:'t1',status:'in_progress'}]};throw new Error(`unexpected ${sql}`)});
  const result=await routePersistentRequest({method:'POST',url:'/api/v1/customers/me/jobs/j1/rating',role:'customer',context:{userId:'u1'},body:{score:4},db});
  assert.equal(result.status,409);assert.equal(result.data.error,'service_not_completed');
});

test('rating validates score before transaction',async()=>{
  let calls=0;const db=customerDb(async()=>{calls++;return{rows:[{id:'c1'}]}});
  const result=await routePersistentRequest({method:'POST',url:'/api/v1/customers/me/jobs/j1/rating',role:'customer',context:{userId:'u1'},body:{score:6},db});
  assert.equal(result.status,400);assert.equal(calls,1);
});
