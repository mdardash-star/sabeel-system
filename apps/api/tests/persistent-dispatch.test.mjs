import test from 'node:test';
import assert from 'node:assert/strict';
import { listDispatchCandidates, assignPersistentJob } from '../src/dispatch/persistent-dispatch.mjs';

test('candidate query enforces city availability skill conflicts and rating ranking', async () => {
  const calls=[];
  const db={query:async(sql,params)=>{
    calls.push({sql,params});
    if(/SELECT id, city_id/.test(sql)) return {rows:[{id:'j1',city_id:'riyadh',status:'pending_assignment',scheduled_at:'2026-09-15T09:00:00Z',required_skill_code:'ro-install'}]};
    if(/FROM technicians t/.test(sql)) return {rows:[{technician_id:'t2',city_id:'riyadh',jobs_in_window:0,avg_rating:'4.90'},{technician_id:'t1',city_id:'riyadh',jobs_in_window:0,avg_rating:'4.60'}]};
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

test('assignment requires active technician in same city and commits atomically', async () => {
  const calls=[];
  const client={
    async query(sql,params=[]){
      calls.push({sql,params});
      if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK') return {rows:[]};
      if(/service_jobs WHERE id=\$1 FOR UPDATE/.test(sql)) return {rows:[{id:'j1',city_id:'riyadh',status:'pending_assignment'}]};
      if(/FROM technicians WHERE/.test(sql)) { assert.deepEqual(params,['t1','riyadh']); return {rows:[{id:'t1',city_id:'riyadh',is_active:true}]}; }
      if(/UPDATE service_jobs/.test(sql)) return {rows:[{id:'j1',technician_id:'t1',status:'scheduled',scheduled_at:params[2]}]};
      if(/INSERT INTO audit_log/.test(sql)) return {rows:[]};
      throw new Error(`unexpected query: ${sql}`);
    },
    release(){calls.push({sql:'RELEASE'});}
  };
  const db={connect:async()=>client};
  const job=await assignPersistentJob(db,{jobId:'j1',technicianId:'t1',scheduledAt:'2026-09-15T10:00:00Z',actorUserId:'dispatcher-1'});
  assert.equal(job.status,'scheduled');
  assert.equal(job.technician_id,'t1');
  assert.ok(calls.some(c=>c.sql==='COMMIT'));
  assert.ok(calls.some(c=>/job\.assigned/.test(c.sql)));
});

test('assignment rejects technician from another city and rolls back', async () => {
  const calls=[];
  const client={
    async query(sql){
      calls.push(sql);
      if(sql==='BEGIN'||sql==='ROLLBACK') return {rows:[]};
      if(/FOR UPDATE/.test(sql)) return {rows:[{id:'j1',city_id:'riyadh',status:'pending_assignment'}]};
      if(/FROM technicians WHERE/.test(sql)) return {rows:[]};
      throw new Error('unexpected query');
    },
    release(){calls.push('RELEASE');}
  };
  await assert.rejects(()=>assignPersistentJob({connect:async()=>client},{jobId:'j1',technicianId:'t-jeddah',scheduledAt:'2026-09-15T10:00:00Z',actorUserId:'d1'}),/not eligible/);
  assert.ok(calls.includes('ROLLBACK'));
});
