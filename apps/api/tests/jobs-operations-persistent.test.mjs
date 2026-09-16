import test from 'node:test';
import assert from 'node:assert/strict';
import { routePersistentRequest } from '../src/http/persistent-router.mjs';

test('dispatcher reads tenant-scoped operations job counters',async()=>{
  const db={query:async(sql,params)=>{assert.match(sql,/pending_assignment/);assert.match(sql,/organization_id = \$1/);assert.deepEqual(params,['org-1']);return{rows:[{open:12,pending_assignment:3,scheduled_today:4,in_progress:2,overdue:1,completed_today:8}]};}};
  const result=await routePersistentRequest({method:'GET',url:'/api/v1/jobs/stats',role:'dispatcher',context:{tenantId:'org-1'},db});
  assert.equal(result.status,200);assert.equal(result.data.stats.overdue,1);
});

test('support searches and filters tenant-scoped paginated operations jobs',async()=>{
  const db={query:async(sql,params)=>{assert.match(sql,/JOIN customers/);assert.match(sql,/j\.organization_id = \$5/);assert.match(sql,/WHEN 'overdue'/);assert.deepEqual(params,['محمد','overdue',10,20,'org-1']);return{rows:[{id:'job-1',customer_name:'محمد',sla_state:'overdue',minutes_late:45,total_count:6}]};}};
  const result=await routePersistentRequest({method:'GET',url:'/api/v1/jobs',role:'support',context:{query:'محمد',status:'overdue',limit:'10',offset:'20',tenantId:'org-1'},db});
  assert.equal(result.status,200);assert.equal(result.data.jobs[0].minutes_late,45);assert.equal(result.data.status,'overdue');assert.deepEqual(result.data.pagination,{limit:10,offset:20,total:6});
});

test('operations jobs reject invalid status before database access',async()=>{
  const db={query:async()=>{throw new Error('must not query');}};
  const result=await routePersistentRequest({method:'GET',url:'/api/v1/jobs',role:'support',context:{status:'unknown'},db});
  assert.deepEqual(result,{status:400,data:{error:'invalid_job_status_filter'}});
});

test('customer cannot access operations jobs',async()=>{
  const db={query:async()=>{throw new Error('must not query');}};
  const result=await routePersistentRequest({method:'GET',url:'/api/v1/jobs',role:'customer',db});
  assert.deepEqual(result,{status:403,data:{error:'forbidden'}});
});
