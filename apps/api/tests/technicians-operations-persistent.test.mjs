import test from 'node:test';
import assert from 'node:assert/strict';
import { routePersistentRequest } from '../src/http/persistent-router.mjs';

test('dispatcher reads technician operations counters',async()=>{
  const db={query:async(sql)=>{assert.match(sql,/available_now/);assert.match(sql,/busy_now/);return{rows:[{total:8,active:7,inactive:1,available_now:3,busy_now:4,avg_rating:'4.76'}]};}};
  const result=await routePersistentRequest({method:'GET',url:'/api/v1/technicians/stats',role:'dispatcher',db});
  assert.equal(result.status,200);assert.equal(result.data.stats.available_now,3);
});

test('branch manager filters paginated technician performance roster',async()=>{
  const db={query:async(sql,params)=>{assert.match(sql,/technician_skills/);assert.match(sql,/on_time_30d/);assert.deepEqual(params,['9665','active',10,20]);return{rows:[{id:'tech-1',mobile:'+966500000001',is_active:true,total_count:14}]};}};
  const result=await routePersistentRequest({method:'GET',url:'/api/v1/technicians',role:'branch_manager',context:{query:'9665',status:'active',limit:'10',offset:'20'},db});
  assert.equal(result.status,200);assert.equal(result.data.technicians[0].id,'tech-1');assert.deepEqual(result.data.pagination,{limit:10,offset:20,total:14});
});

test('technician performance includes bounded metrics and recent jobs',async()=>{
  let calls=0;const db={query:async(sql,params)=>{calls++;assert.equal(params[0],'tech-1');if(/FROM technicians t JOIN users/.test(sql)){assert.equal(params[1],'2026-08-01T00:00:00.000Z');return{rows:[{id:'tech-1',completed:22,on_time:20,total_payout:'1900.00'}]};}assert.match(sql,/JOIN customers/);return{rows:[{id:'job-1',status:'completed'}]};}};
  const result=await routePersistentRequest({method:'GET',url:'/api/v1/technicians/tech-1/performance',role:'dispatcher',context:{from:'2026-08-01',to:'2026-09-01'},db});
  assert.equal(result.status,200);assert.equal(result.data.technician.completed,22);assert.equal(result.data.recentJobs[0].id,'job-1');assert.equal(calls,2);
});

test('technician performance rejects inverted or excessive range before querying',async()=>{
  const db={query:async()=>{throw new Error('must not query');}};
  const inverted=await routePersistentRequest({method:'GET',url:'/api/v1/technicians/tech-1/performance',role:'dispatcher',context:{from:'2026-09-02',to:'2026-09-01'},db});
  const excessive=await routePersistentRequest({method:'GET',url:'/api/v1/technicians/tech-1/performance',role:'dispatcher',context:{from:'2024-01-01',to:'2026-09-01'},db});
  assert.equal(inverted.status,400);assert.equal(excessive.status,400);
});

test('support cannot access technician management data',async()=>{
  const db={query:async()=>{throw new Error('must not query');}};
  const result=await routePersistentRequest({method:'GET',url:'/api/v1/technicians',role:'support',db});
  assert.deepEqual(result,{status:403,data:{error:'forbidden'}});
});

test('technician deactivation requires a reason',async()=>{
  const db={query:async()=>({rows:[]})};
  const result=await routePersistentRequest({method:'PATCH',url:'/api/v1/technicians/tech-1/status',role:'branch_manager',context:{userId:'manager-1'},body:{isActive:false},db});
  assert.deepEqual(result,{status:400,data:{error:'deactivation_reason_required'}});
});

function statusDb(current=true){
  const calls=[];const client={query:async(sql,params=[])=>{calls.push({sql,params});if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return{rows:[]};if(/FROM technicians t JOIN users/.test(sql))return{rows:[{id:'tech-1',user_id:'user-1',is_active:current,user_is_active:true}]};if(/UPDATE technicians/.test(sql))return{rows:[{id:'tech-1',is_active:params[1]}]};if(/INSERT INTO audit_log/.test(sql))return{rows:[]};throw new Error(`unexpected query: ${sql}`);},release(){}};return{db:{query:async()=>({rows:[]}),connect:async()=>client},calls};
}

test('branch manager deactivates technician and records the reason atomically',async()=>{
  const {db,calls}=statusDb(true);const result=await routePersistentRequest({method:'PATCH',url:'/api/v1/technicians/tech-1/status',role:'branch_manager',context:{userId:'manager-1'},body:{isActive:false,reason:'إجازة طويلة'},db});
  assert.equal(result.status,200);assert.equal(result.data.technician.is_active,false);const audit=calls.find(call=>/INSERT INTO audit_log/.test(call.sql));assert.match(audit.params[2],/إجازة طويلة/);assert.ok(calls.some(call=>call.sql==='COMMIT'));
});

test('unchanged technician status returns conflict and rolls back',async()=>{
  const {db,calls}=statusDb(false);const result=await routePersistentRequest({method:'PATCH',url:'/api/v1/technicians/tech-1/status',role:'branch_manager',context:{userId:'manager-1'},body:{isActive:false,reason:'لا يزال متوقفًا'},db});
  assert.equal(result.status,409);assert.ok(calls.some(call=>call.sql==='ROLLBACK'));assert.ok(!calls.some(call=>/UPDATE technicians/.test(call.sql)));
});
