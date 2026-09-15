import test from 'node:test';
import assert from 'node:assert/strict';
import { routePersistentRequest } from '../src/http/persistent-router.mjs';

test('dispatcher reads ranked candidates for a dispatchable job',async()=>{
  const calls=[];const db={query:async(sql,params)=>{calls.push({sql,params});if(/FROM service_jobs j LEFT JOIN service_locations/.test(sql))return{rows:[{id:'job-1',city_id:'riyadh',status:'pending_assignment',scheduled_at:'2026-09-20T09:00:00Z',service_duration_minutes:60}]};if(/FROM technicians t/.test(sql))return{rows:[{technician_id:'tech-1',distance_km:'2.10',jobs_in_window:1,avg_rating:'4.80'}]};throw new Error('unexpected query');}};
  const result=await routePersistentRequest({method:'GET',url:'/api/v1/jobs/job-1/candidates',role:'dispatcher',context:{limit:'5'},db});
  assert.equal(result.status,200);assert.equal(result.data.candidates[0].technician_id,'tech-1');assert.equal(calls[1].params[5],5);
});

function assignmentDb(status='pending_assignment'){
  const calls=[];const client={query:async(sql,params=[])=>{calls.push({sql,params});if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return{rows:[]};if(/service_jobs WHERE id=\$1 FOR UPDATE/.test(sql))return{rows:[{id:'job-1',city_id:'riyadh',status,service_duration_minutes:60,technician_id:'old-tech',scheduled_at:'2026-09-20T09:00:00Z'}]};if(/FROM technicians WHERE/.test(sql))return{rows:[{id:'tech-1',city_id:'riyadh'}]};if(/FROM technician_availability/.test(sql))return{rows:[{'?column?':1}]};if(/SELECT id FROM service_jobs/.test(sql))return{rows:[]};if(/UPDATE service_jobs/.test(sql))return{rows:[{id:'job-1',technician_id:'tech-1',scheduled_at:params[2],service_duration_minutes:params[3],status:'scheduled'}]};if(/INSERT INTO audit_log/.test(sql))return{rows:[]};throw new Error(`unexpected query: ${sql}`);},release(){}};return{db:{query:async()=>({rows:[]}),connect:async()=>client},calls};
}

test('dispatcher assigns and schedules through persistent HTTP router',async()=>{
  const {db,calls}=assignmentDb();const result=await routePersistentRequest({method:'POST',url:'/api/v1/jobs/job-1/assign',role:'dispatcher',context:{userId:'dispatcher-1'},body:{technicianId:'tech-1',scheduledAt:'2026-09-20T10:00:00Z',serviceDurationMinutes:90},db});
  assert.equal(result.status,200);assert.equal(result.data.job.status,'scheduled');assert.ok(calls.some(call=>/job\.assigned/.test(call.sql)));
});

test('dispatcher reassigns only with a recorded reason',async()=>{
  const invalid=await routePersistentRequest({method:'POST',url:'/api/v1/jobs/job-1/reassign',role:'dispatcher',context:{userId:'dispatcher-1'},body:{technicianId:'tech-1',scheduledAt:'2026-09-20T10:00:00Z'},db:{query:async()=>({rows:[]})}});assert.equal(invalid.status,400);
  const {db,calls}=assignmentDb('scheduled');const result=await routePersistentRequest({method:'POST',url:'/api/v1/jobs/job-1/reassign',role:'dispatcher',context:{userId:'dispatcher-1'},body:{technicianId:'tech-1',scheduledAt:'2026-09-20T10:00:00Z',reason:'طلب العميل تغيير الموعد'},db});
  assert.equal(result.status,200);const audit=calls.find(call=>/job\.reassigned/.test(call.sql));assert.match(audit.params[2],/طلب العميل/);
});

test('support cannot assign jobs without dispatch permissions',async()=>{
  const result=await routePersistentRequest({method:'POST',url:'/api/v1/jobs/job-1/assign',role:'support',context:{userId:'support-1'},body:{},db:{query:async()=>{throw new Error('must not query');}}});
  assert.deepEqual(result,{status:403,data:{error:'forbidden'}});
});
