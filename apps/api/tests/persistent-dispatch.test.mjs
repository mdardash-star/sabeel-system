import test from 'node:test';
import assert from 'node:assert/strict';
import { listDispatchCandidates, assignPersistentJob } from '../src/dispatch/persistent-dispatch.mjs';

test('candidate query enforces city availability skill conflicts and rating ranking', async () => {
  const calls=[];
  const db={query:async(sql,params)=>{
    calls.push({sql,params});
    if(/SELECT id, city_id/.test(sql)) return {rows:[{id:'j1',city_id:'riyadh',status:'pending_assignment',scheduled_at:'2026-09-15T09:00:00Z',required_skill_code:'ro-install'}]};
    if(/FROM technicians t/.test(sql)) return {rows:[{technician_id:'t2',city_id:'riyadh',jobs_in_window:0,avg_rating:'4.90'}]};
    throw new Error('unexpected query');
  }};
  const result=await listDispatchCandidates(db,'j1',{windowEnd:'2026-09-15T13:00:00Z'});
  assert.equal(result.candidates[0].technician_id,'t2');
  const q=calls.find(c=>/FROM technicians t/.test(c.sql));
  assert.equal(q.params[0],'riyadh');
  assert.equal(q.params[3],'ro-install');
  assert.match(q.sql,/technician_availability/);
  assert.match(q.sql,/technician_skills/);
  assert.match(q.sql,/NOT EXISTS/);
  assert.match(q.sql,/avg_rating DESC/);
});

function assignmentDb({skill=true, available=true, conflict=false}={}) {
  const calls=[];
  const client={async query(sql,params=[]){
    calls.push({sql,params});
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)) return {rows:[]};
    if(/service_jobs WHERE id=\$1 FOR UPDATE/.test(sql)) return {rows:[{id:'j1',city_id:'riyadh',status:'pending_assignment',required_skill_code:'ro-install'}]};
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
