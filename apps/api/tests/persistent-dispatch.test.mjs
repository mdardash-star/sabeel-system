import test from 'node:test';
import assert from 'node:assert/strict';
import { listDispatchCandidates, assignPersistentJob } from '../src/dispatch/persistent-dispatch.mjs';

test('candidate query ranks eligible technicians by proximity then workload and rating', async () => {
  const calls=[];
  const db={query:async(sql,params)=>{
    calls.push({sql,params});
    if(/FROM service_jobs j LEFT JOIN service_locations/.test(sql)) return {rows:[{id:'j1',city_id:'riyadh',status:'pending_assignment',scheduled_at:'2026-09-15T09:00:00Z',required_skill_code:'ro-install',latitude:'24.700000',longitude:'46.680000'}]};
    if(/FROM technicians t/.test(sql)) return {rows:[{technician_id:'near',distance_km:'1.20',jobs_in_window:0,avg_rating:'4.70'},{technician_id:'far',distance_km:'8.40',jobs_in_window:0,avg_rating:'4.90'}]};
    throw new Error(`unexpected query: ${sql}`);
  }};
  const result=await listDispatchCandidates(db,'j1',{windowEnd:'2026-09-15T13:00:00Z'});
  assert.equal(result.candidates[0].technician_id,'near');
  const q=calls.find(c=>/FROM technicians t/.test(c.sql));
  assert.equal(q.params[0],'riyadh');
  assert.equal(q.params[3],'ro-install');
  assert.equal(q.params[6],'24.700000');
  assert.equal(q.params[7],'46.680000');
  assert.match(q.sql,/technician_locations/);
  assert.match(q.sql,/6371/);
  assert.match(q.sql,/distance_km ASC NULLS LAST, jobs_in_window ASC, avg_rating DESC/);
});

function assignmentDb({skill=true, available=true, conflict=false,status='pending_assignment'}={}) {
  const calls=[];
  const client={async query(sql,params=[]){
    calls.push({sql,params});
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)) return {rows:[]};
    if(/service_jobs WHERE id=\$1 FOR UPDATE/.test(sql)) return {rows:[{id:'j1',city_id:'riyadh',status,required_skill_code:'ro-install'}]};
    if(/FROM technicians WHERE/.test(sql)) return {rows:[{id:'t1',city_id:'riyadh',is_active:true}]};
    if(/FROM technician_skills/.test(sql)) return {rows:skill?[{'?column?':1}]:[]};
    if(/FROM technician_availability/.test(sql)) return {rows:available?[{'?column?':1}]:[]};
    if(/SELECT id FROM service_jobs/.test(sql)) return {rows:conflict?[{id:'j-conflict'}]:[]};
    if(/UPDATE service_jobs/.test(sql)) return {rows:[{id:'j1',technician_id:'t1',status:'scheduled',scheduled_at:params[2]}]};
    if(/INSERT INTO audit_log/.test(sql)) return {rows:[]};
    throw new Error(`unexpected query: ${sql}`);
  },release(){calls.push({sql:'RELEASE'});}};
  return {db:{connect:async()=>client},calls};
}

test('assignment revalidates skill availability and conflict then commits', async () => {
  const {db,calls}=assignmentDb();
  const job=await assignPersistentJob(db,{jobId:'j1',technicianId:'t1',scheduledAt:'2026-09-15T10:00:00Z',actorUserId:'d1'});
  assert.equal(job.status,'scheduled');
  assert.ok(calls.some(c=>/technician_skills/.test(c.sql)));
  assert.ok(calls.some(c=>/technician_availability/.test(c.sql)));
  assert.ok(calls.some(c=>/SELECT id FROM service_jobs/.test(c.sql)));
  assert.ok(calls.some(c=>c.sql==='COMMIT'));
});

test('assignment rejects missing required skill and rolls back', async () => {
  const {db,calls}=assignmentDb({skill:false});
  await assert.rejects(()=>assignPersistentJob(db,{jobId:'j1',technicianId:'t1',scheduledAt:'2026-09-15T10:00:00Z',actorUserId:'d1'}),/lacks required skill/);
  assert.ok(calls.some(c=>c.sql==='ROLLBACK'));
});

test('assignment rejects unavailable technician and rolls back', async () => {
  const {db,calls}=assignmentDb({available:false});
  await assert.rejects(()=>assignPersistentJob(db,{jobId:'j1',technicianId:'t1',scheduledAt:'2026-09-15T10:00:00Z',actorUserId:'d1'}),/unavailable/);
  assert.ok(calls.some(c=>c.sql==='ROLLBACK'));
});

test('assignment rejects scheduling conflict and rolls back', async () => {
  const {db,calls}=assignmentDb({conflict:true});
  await assert.rejects(()=>assignPersistentJob(db,{jobId:'j1',technicianId:'t1',scheduledAt:'2026-09-15T10:00:00Z',actorUserId:'d1'}),/scheduling conflict/);
  assert.ok(calls.some(c=>c.sql==='ROLLBACK'));
});
