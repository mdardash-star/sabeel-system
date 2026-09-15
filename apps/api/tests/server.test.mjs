import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiServer } from '../src/server.mjs';

const sessionToken = 'subil-test-session-token-00000001';
const authHeaders = { authorization: `Bearer ${sessionToken}` };

test('CORS preflight allows only configured admin origins', async (t) => {
  const server = createApiServer({ db:null, corsOrigins:['https://admin.subil.store'] });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const {port}=server.address();
  const allowed=await fetch(`http://127.0.0.1:${port}/api/v1/customers`,{method:'OPTIONS',headers:{origin:'https://admin.subil.store','access-control-request-method':'GET','access-control-request-headers':'authorization'}});
  assert.equal(allowed.status,204);
  assert.equal(allowed.headers.get('access-control-allow-origin'),'https://admin.subil.store');
  const blocked=await fetch(`http://127.0.0.1:${port}/api/v1/customers`,{method:'OPTIONS',headers:{origin:'https://evil.example','access-control-request-method':'GET'}});
  assert.equal(blocked.status,403);
  assert.equal(blocked.headers.get('access-control-allow-origin'),null);
});

function withSession(db, { userId = 'user-1', role = 'technician' } = {}) {
  return {
    ...db,
    query: async (sql, params) => {
      if (/FROM auth_sessions s/.test(sql)) return { rows: [{ user_id: userId, role }] };
      return db.query(sql, params);
    }
  };
}

test('live HTTP technician endpoint uses PostgreSQL repositories and date query', async (t) => {
  const queries = [];
  const db = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (/FROM technicians t/.test(sql)) return { rows: [{ id: 'tech-1', user_id: 'user-1' }] };
      return { rows: [{ id: 'job-1', technician_id: 'tech-1', address_text: 'Riyadh' }] };
    }
  };
  const server = createApiServer({ db: withSession(db) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/technicians/me/jobs?from=2026-09-15T00%3A00%3A00Z&to=2026-09-16T00%3A00%3A00Z`, {
    headers: authHeaders
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.technicianId, 'tech-1');
  assert.equal(payload.jobs[0].address_text, 'Riyadh');
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[1].params, ['tech-1', '2026-09-15T00:00:00Z', '2026-09-16T00:00:00Z']);
  assert.doesNotMatch(queries[1].sql, /JOIN customers|\bphone\b|\bmobile\b|whatsapp/i);
});

test('live HTTP technician endpoint fails closed without database', async (t) => {
  const server = createApiServer({ db: null });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/technicians/me/jobs`, {
    headers: authHeaders
  });
  assert.equal(response.status, 503);
});

test('persistent routes ignore forged role and user headers without Bearer session', async (t) => {
  const db = withSession({ query: async () => { throw new Error('must not query without token'); } });
  const server = createApiServer({ db });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/settlements/s1/approve`, {
    method: 'POST',
    headers: { 'x-subil-role': 'super_admin', 'x-subil-user-id': 'forged-user' }
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, 'invalid_or_expired_session');
});

test('live HTTP customer search forwards pagination and query to PostgreSQL', async (t) => {
  const db={query:async(sql,params)=>{
    assert.match(sql,/FROM customers c/);
    assert.deepEqual(params,['نورة',5,10]);
    return{rows:[{id:'customer-1',name:'نورة',mobile:'+966500000000',total_count:13}]};
  }};
  const server=createApiServer({db:withSession(db,{role:'support'})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();
  const response=await fetch(`http://127.0.0.1:${port}/api/v1/customers?q=${encodeURIComponent('نورة')}&limit=5&offset=10`,{headers:authHeaders});
  const payload=await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.customers[0].name,'نورة');
  assert.deepEqual(payload.pagination,{limit:5,offset:10,total:13});
});

test('live HTTP customer stats returns authorized CRM totals', async (t) => {
  const db={query:async(sql)=>{
    assert.match(sql,/new_this_month/);
    return{rows:[{total:42,new_this_month:7,with_orders:31}]};
  }};
  const server=createApiServer({db:withSession(db,{role:'support'})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();
  const response=await fetch(`http://127.0.0.1:${port}/api/v1/customers/stats`,{headers:authHeaders});
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).stats,{total:42,new_this_month:7,with_orders:31});
});

test('live HTTP maintenance stats are authenticated',async(t)=>{
  const db={query:async(sql)=>{assert.match(sql,/due_7_days/);return{rows:[{active:20,overdue:4,due_7_days:3,due_30_days:9}]};}};
  const server=createApiServer({db:withSession(db,{role:'support'})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();const response=await fetch(`http://127.0.0.1:${port}/api/v1/maintenance/stats`,{headers:authHeaders});
  assert.equal(response.status,200);assert.equal((await response.json()).stats.overdue,4);
});

test('live HTTP maintenance worklist forwards filters and pagination',async(t)=>{
  const db={query:async(sql,params)=>{assert.match(sql,/JOIN customers/);assert.deepEqual(params,['سبيل','30d',5,10]);return{rows:[{id:'asset-1',customer_name:'سبيل',days_until_due:12,total_count:11}]};}};
  const server=createApiServer({db:withSession(db,{role:'branch_manager'})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();const response=await fetch(`http://127.0.0.1:${port}/api/v1/maintenance/assets?window=30d&q=${encodeURIComponent('سبيل')}&limit=5&offset=10`,{headers:authHeaders});
  const payload=await response.json();assert.equal(response.status,200);assert.equal(payload.assets[0].days_until_due,12);assert.deepEqual(payload.pagination,{limit:5,offset:10,total:11});
});

test('live HTTP operations job stats are authenticated',async(t)=>{
  const db={query:async(sql)=>{assert.match(sql,/completed_today/);return{rows:[{open:12,pending_assignment:3,scheduled_today:4,in_progress:2,overdue:1,completed_today:8}]};}};
  const server=createApiServer({db:withSession(db,{role:'dispatcher'})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();const response=await fetch(`http://127.0.0.1:${port}/api/v1/jobs/stats`,{headers:authHeaders});
  assert.equal(response.status,200);assert.equal((await response.json()).stats.pending_assignment,3);
});

test('live HTTP operations jobs forward search status and pagination',async(t)=>{
  const db={query:async(sql,params)=>{assert.match(sql,/sla_state/);assert.deepEqual(params,['نورة','active',5,10]);return{rows:[{id:'job-1',customer_name:'نورة',status:'in_progress',sla_state:'on_track',total_count:7}]};}};
  const server=createApiServer({db:withSession(db,{role:'support'})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();const response=await fetch(`http://127.0.0.1:${port}/api/v1/jobs?status=active&q=${encodeURIComponent('نورة')}&limit=5&offset=10`,{headers:authHeaders});
  const payload=await response.json();assert.equal(response.status,200);assert.equal(payload.jobs[0].status,'in_progress');assert.deepEqual(payload.pagination,{limit:5,offset:10,total:7});
});

test('live HTTP escalation queue is authenticated and prioritized',async(t)=>{
  const db={query:async(sql,params)=>{assert.match(sql,/job_escalations/);assert.deepEqual(params,['open',5,0]);return{rows:[{id:'e1',job_id:'j1',level:3,total_count:1}]};}};
  const server=createApiServer({db:withSession(db,{role:'dispatcher'})});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();const response=await fetch(`http://127.0.0.1:${port}/api/v1/jobs/escalations?status=open&limit=5`,{headers:authHeaders});const payload=await response.json();assert.equal(response.status,200);assert.equal(payload.escalations[0].level,3);
});

test('live HTTP dispatcher runs idempotent SLA detection',async(t)=>{
  const client={query:async(sql,params=[])=>{if(['BEGIN','COMMIT'].includes(sql))return{rows:[]};if(/FROM service_jobs/.test(sql))return{rows:[{id:'j1',minutes_late:130}]};if(/INSERT INTO job_escalations/.test(sql))return{rows:[{id:'e1',job_id:'j1',level:params[1],status:'open'}]};if(/INSERT INTO audit_log/.test(sql))return{rows:[]};throw new Error(`unexpected query: ${sql}`);},release(){}};
  const db={query:async()=>({rows:[]}),connect:async()=>client},server=createApiServer({db:withSession(db,{role:'dispatcher',userId:'dispatcher-1'})});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();const response=await fetch(`http://127.0.0.1:${port}/api/v1/jobs/escalations/run`,{method:'POST',headers:{'content-type':'application/json',...authHeaders},body:JSON.stringify({limit:20})});const payload=await response.json();assert.equal(response.status,200);assert.equal(payload.created[0].level,2);
});

test('live HTTP finance worklist forwards status and pagination',async(t)=>{
  const db={query:async(sql,params)=>{assert.match(sql,/technician_mobile/);assert.deepEqual(params,['سبيل','pending_approval',5,10]);return{rows:[{id:'settlement-1',customer_name:'سبيل',total_count:8}]};}};
  const server=createApiServer({db:withSession(db,{role:'finance'})});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();const response=await fetch(`http://127.0.0.1:${port}/api/v1/settlements?status=pending_approval&q=${encodeURIComponent('سبيل')}&limit=5&offset=10`,{headers:authHeaders});const payload=await response.json();assert.equal(response.status,200);assert.equal(payload.settlements[0].id,'settlement-1');assert.equal(payload.pagination.total,8);
});

test('live HTTP finance rejects settlement with audited reason',async(t)=>{
  const client={query:async(sql,params=[])=>{if(['BEGIN','COMMIT'].includes(sql))return{rows:[]};if(/SELECT id, technician_id, payout_amount, status/.test(sql))return{rows:[{id:'s1',technician_id:'t1',payout_amount:'75',status:'pending_approval'}]};if(/UPDATE technician_settlements/.test(sql))return{rows:[{id:'s1',status:'rejected'}]};if(/INSERT INTO audit_log/.test(sql))return{rows:[]};throw new Error(`unexpected query: ${sql}`);},release(){}};
  const db={query:async()=>({rows:[]}),connect:async()=>client},server=createApiServer({db:withSession(db,{role:'finance',userId:'finance-1'})});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();const response=await fetch(`http://127.0.0.1:${port}/api/v1/settlements/s1/reject`,{method:'POST',headers:{'content-type':'application/json',...authHeaders},body:JSON.stringify({reason:'تكلفة ناقصة'})});assert.equal(response.status,200);assert.equal((await response.json()).settlement.status,'rejected');
});

test('live HTTP finance records settlement payment',async(t)=>{
  const client={query:async(sql,params=[])=>{if(['BEGIN','COMMIT'].includes(sql))return{rows:[]};if(/SELECT id, technician_id, payout_amount, status/.test(sql))return{rows:[{id:'s1',technician_id:'t1',payout_amount:'75',status:'approved'}]};if(/UPDATE technician_settlements/.test(sql))return{rows:[{id:'s1',status:'paid'}]};if(/UPDATE wallet_entries|INSERT INTO audit_log/.test(sql))return{rows:[]};throw new Error(`unexpected query: ${sql}`);},release(){}};
  const db={query:async()=>({rows:[]}),connect:async()=>client},server=createApiServer({db:withSession(db,{role:'finance',userId:'finance-1'})});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();const response=await fetch(`http://127.0.0.1:${port}/api/v1/settlements/s1/paid`,{method:'POST',headers:{'content-type':'application/json',...authHeaders},body:JSON.stringify({paymentReference:'TRX-100'})});assert.equal(response.status,200);assert.equal((await response.json()).settlement.status,'paid');
});

test('live HTTP technician roster forwards filters and pagination',async(t)=>{
  const db={query:async(sql,params)=>{assert.match(sql,/on_time_30d/);assert.deepEqual(params,['الرياض','active',5,10]);return{rows:[{id:'tech-1',mobile:'+966500000001',is_active:true,total_count:12}]};}};
  const server=createApiServer({db:withSession(db,{role:'dispatcher'})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();const response=await fetch(`http://127.0.0.1:${port}/api/v1/technicians?status=active&q=${encodeURIComponent('الرياض')}&limit=5&offset=10`,{headers:authHeaders});
  const payload=await response.json();assert.equal(response.status,200);assert.equal(payload.technicians[0].id,'tech-1');assert.deepEqual(payload.pagination,{limit:5,offset:10,total:12});
});

test('live HTTP technician performance returns metrics and recent jobs',async(t)=>{
  const db={query:async(sql)=>/FROM technicians t JOIN users/.test(sql)?{rows:[{id:'tech-1',completed:20,on_time:18}]}:{rows:[{id:'job-1',status:'completed'}]}};
  const server=createApiServer({db:withSession(db,{role:'dispatcher'})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();const response=await fetch(`http://127.0.0.1:${port}/api/v1/technicians/tech-1/performance?from=2026-08-01&to=2026-09-01`,{headers:authHeaders});
  const payload=await response.json();assert.equal(response.status,200);assert.equal(payload.technician.completed,20);assert.equal(payload.recentJobs[0].id,'job-1');
});

test('live HTTP manager deactivates a technician with audited reason',async(t)=>{
  const client={query:async(sql,params=[])=>{if(['BEGIN','COMMIT'].includes(sql))return{rows:[]};if(/FROM technicians t JOIN users/.test(sql))return{rows:[{id:'tech-1',user_id:'user-1',is_active:true}]};if(/UPDATE technicians/.test(sql))return{rows:[{id:'tech-1',is_active:params[1]}]};if(/INSERT INTO audit_log/.test(sql))return{rows:[]};throw new Error(`unexpected query: ${sql}`);},release(){}};
  const db={query:async()=>({rows:[]}),connect:async()=>client};const server=createApiServer({db:withSession(db,{role:'branch_manager',userId:'manager-1'})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();const response=await fetch(`http://127.0.0.1:${port}/api/v1/technicians/tech-1/status`,{method:'PATCH',headers:{'content-type':'application/json',...authHeaders},body:JSON.stringify({isActive:false,reason:'إجازة طويلة'})});
  assert.equal(response.status,200);assert.equal((await response.json()).technician.is_active,false);
});

test('live HTTP dispatcher candidate route ranks eligible technicians',async(t)=>{
  const db={query:async(sql)=>{if(/FROM service_jobs j LEFT JOIN service_locations/.test(sql))return{rows:[{id:'job-1',city_id:'riyadh',status:'pending_assignment',scheduled_at:'2026-09-20T09:00:00Z',service_duration_minutes:60}]};if(/FROM technicians t/.test(sql))return{rows:[{technician_id:'tech-1',distance_km:'1.5',jobs_in_window:0,avg_rating:'4.9'}]};throw new Error('unexpected query');}};
  const server=createApiServer({db:withSession(db,{role:'dispatcher',userId:'dispatcher-1'})});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();const response=await fetch(`http://127.0.0.1:${port}/api/v1/jobs/job-1/candidates`,{headers:authHeaders});const payload=await response.json();assert.equal(response.status,200);assert.equal(payload.candidates[0].technician_id,'tech-1');
});

test('live HTTP dispatcher assignment route commits an audited schedule',async(t)=>{
  const client={query:async(sql,params=[])=>{if(['BEGIN','COMMIT'].includes(sql))return{rows:[]};if(/service_jobs WHERE id=\$1 FOR UPDATE/.test(sql))return{rows:[{id:'job-1',city_id:'riyadh',status:'pending_assignment',service_duration_minutes:60}]};if(/FROM technicians WHERE/.test(sql))return{rows:[{id:'tech-1',city_id:'riyadh'}]};if(/FROM technician_availability/.test(sql))return{rows:[{'?column?':1}]};if(/SELECT id FROM service_jobs/.test(sql))return{rows:[]};if(/UPDATE service_jobs/.test(sql))return{rows:[{id:'job-1',technician_id:'tech-1',status:'scheduled',scheduled_at:params[2]}]};if(/INSERT INTO audit_log/.test(sql))return{rows:[]};throw new Error(`unexpected query: ${sql}`);},release(){}};
  const db={query:async()=>({rows:[]}),connect:async()=>client};const server=createApiServer({db:withSession(db,{role:'dispatcher',userId:'dispatcher-1'})});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();const response=await fetch(`http://127.0.0.1:${port}/api/v1/jobs/job-1/assign`,{method:'POST',headers:{'content-type':'application/json',...authHeaders},body:JSON.stringify({technicianId:'tech-1',scheduledAt:'2026-09-20T10:00:00Z',serviceDurationMinutes:60})});const payload=await response.json();assert.equal(response.status,200);assert.equal(payload.job.status,'scheduled');
});

test('live HTTP customer timeline includes maintenance and pagination',async(t)=>{
  const db={query:async(sql,params)=>{if(/SELECT c\.id, c\.name/.test(sql))return{rows:[{id:'customer-1',name:'عميل'}]};assert.match(sql,/asset_maintenance_events/);assert.deepEqual(params,['customer-1',10,20]);return{rows:[{id:'maintenance-1',type:'maintenance',status:'completed',total_count:24}]};}};
  const server=createApiServer({db:withSession(db,{role:'support'})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();
  const response=await fetch(`http://127.0.0.1:${port}/api/v1/customers/customer-1/timeline?limit=10&offset=20`,{headers:authHeaders});
  const payload=await response.json();assert.equal(response.status,200);assert.equal(payload.timeline[0].type,'maintenance');assert.deepEqual(payload.pagination,{limit:10,offset:20,total:24});
});

for(const collection of ['addresses','assets','orders','jobs']){
  test(`live HTTP customer ${collection} route is authenticated and paginated`,async(t)=>{
    const db={query:async(sql,params)=>{
      if(/SELECT c\.id, c\.name/.test(sql))return{rows:[{id:'customer-1',name:'عميل'}]};
      const matcher={addresses:/FROM service_locations/,assets:/FROM installed_assets/,orders:/FROM orders WHERE/,jobs:/FROM service_jobs/}[collection];
      assert.match(sql,matcher);
      assert.deepEqual(params,['customer-1',5,0]);
      return{rows:[{id:`${collection}-1`,total_count:1}]};
    }};
    const server=createApiServer({db:withSession(db,{role:'branch_manager'})});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    const {port}=server.address();
    const response=await fetch(`http://127.0.0.1:${port}/api/v1/customers/customer-1/${collection}?limit=5`,{headers:authHeaders});
    const payload=await response.json();
    assert.equal(response.status,200);
    assert.equal(payload[collection][0].id,`${collection}-1`);
    assert.deepEqual(payload.pagination,{limit:5,offset:0,total:1});
  });
}

test('live HTTP customer asset registration is authenticated and persisted',async(t)=>{
  const db={query:async(sql,params)=>{
    assert.match(sql,/INSERT INTO installed_assets/);
    assert.equal(params[0],'customer-1');
    assert.equal(params[1],'جهاز تحلية 7 مراحل');
    assert.equal(params[5],6);
    return{rows:[{id:'asset-1',customer_id:'customer-1',product_id:params[1],next_maintenance_at:params[6],status:'active'}]};
  }};
  const server=createApiServer({db:withSession(db,{role:'support'})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();
  const response=await fetch(`http://127.0.0.1:${port}/api/v1/customers/customer-1/assets`,{method:'POST',headers:{'content-type':'application/json',...authHeaders},body:JSON.stringify({productId:'جهاز تحلية 7 مراحل',serialNumber:'SBL-200',installedAt:'2026-09-15',maintenanceIntervalMonths:6})});
  const payload=await response.json();
  assert.equal(response.status,201);
  assert.equal(payload.asset.id,'asset-1');
});

test('live HTTP maintenance completion updates an owned asset atomically',async(t)=>{
  const client={query:async(sql,params)=>{
    if(sql==='BEGIN'||sql==='COMMIT')return{rows:[]};
    if(/FROM installed_assets/.test(sql))return{rows:[{id:'asset-1',customer_id:'customer-1',status:'active',maintenance_interval_months:6}]};
    if(/UPDATE installed_assets/.test(sql))return{rows:[{id:'asset-1',last_maintenance_at:params[2],next_maintenance_at:params[3],status:'active'}]};
    if(/INSERT INTO asset_maintenance_events/.test(sql))return{rows:[{id:'maintenance-1',asset_id:'asset-1',completed_at:params[1],notes:params[2]}]};
    if(/INSERT INTO audit_log/.test(sql))return{rows:[]};
    throw new Error('Unexpected query');
  },release(){}};
  const db={query:async()=>({rows:[]}),connect:async()=>client};
  const server=createApiServer({db:withSession(db,{role:'support',userId:'support-1'})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();
  const response=await fetch(`http://127.0.0.1:${port}/api/v1/customers/customer-1/assets/asset-1/maintenance`,{method:'POST',headers:{'content-type':'application/json',...authHeaders},body:JSON.stringify({completedAt:'2026-09-30',notes:'تم تغيير الفلاتر'})});
  const payload=await response.json();
  assert.equal(response.status,200);assert.equal(payload.maintenance.id,'maintenance-1');
  assert.equal(payload.asset.next_maintenance_at,'2027-03-30T00:00:00.000Z');
});

test('live HTTP asset status update is scoped and audited',async(t)=>{
  const client={query:async(sql)=>{if(sql==='BEGIN'||sql==='COMMIT')return{rows:[]};if(/FROM installed_assets/.test(sql))return{rows:[{id:'asset-1',customer_id:'customer-1',status:'active'}]};if(/UPDATE installed_assets/.test(sql))return{rows:[{id:'asset-1',customer_id:'customer-1',status:'inactive'}]};if(/INSERT INTO audit_log/.test(sql))return{rows:[]};throw new Error('Unexpected query');},release(){}};
  const db={query:async()=>({rows:[]}),connect:async()=>client};
  const server=createApiServer({db:withSession(db,{role:'branch_manager',userId:'manager-1'})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();
  const response=await fetch(`http://127.0.0.1:${port}/api/v1/customers/customer-1/assets/asset-1`,{method:'PATCH',headers:{'content-type':'application/json',...authHeaders},body:JSON.stringify({status:'inactive'})});
  assert.equal(response.status,200);assert.equal((await response.json()).asset.status,'inactive');
});

test('live HTTP technician job details route is connected to PostgreSQL', async (t) => {
  const db = {
    query: async (sql, params) => {
      if (/FROM technicians t/.test(sql)) return { rows: [{ id: 'tech-1', user_id: 'user-1' }] };
      assert.match(sql, /j\.id = \$1 AND j\.technician_id = \$2/);
      assert.deepEqual(params, ['job-1', 'tech-1']);
      return { rows: [{ id: 'job-1', technician_id: 'tech-1', address_text: 'Riyadh' }] };
    }
  };
  const server = createApiServer({ db: withSession(db) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/technicians/me/jobs/job-1`, {
    headers: authHeaders
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.job.id, 'job-1');
});

test('live HTTP technician wallet route uses pagination query parameters', async (t) => {
  const db = {
    query: async (sql, params) => {
      if (/FROM technicians t/.test(sql)) return { rows: [{ id: 'tech-1', user_id: 'user-1' }] };
      if (/COALESCE\(SUM/.test(sql)) return { rows: [{ balance: '80.00' }] };
      assert.deepEqual(params, ['tech-1', 5, 10]);
      return { rows: [{ id: 'w1', amount: '80.00', currency: 'SAR', total_count: 11 }] };
    }
  };
  const server = createApiServer({ db: withSession(db) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/technicians/me/wallet?limit=5&offset=10`, {
    headers: authHeaders
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.balance, 80);
  assert.deepEqual(payload.pagination, { limit: 5, offset: 10, total: 11 });
});

test('live HTTP technician status route persists transition and audit', async (t) => {
  const client = {
    query: async (sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
      if (/FROM service_jobs/.test(sql)) return { rows: [{ id: 'job-1', technician_id: 'tech-1', status: 'scheduled' }] };
      if (/UPDATE service_jobs/.test(sql)) return { rows: [{ id: 'job-1', technician_id: 'tech-1', status: 'en_route' }] };
      if (/INSERT INTO audit_log/.test(sql)) return { rows: [] };
      throw new Error('Unexpected query');
    },
    release() {}
  };
  const db = {
    query: async () => ({ rows: [{ id: 'tech-1', user_id: 'user-1' }] }),
    connect: async () => client
  };
  const server = createApiServer({ db: withSession(db) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/technicians/me/jobs/job-1/status`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...authHeaders },
    body: JSON.stringify({ status: 'en_route' })
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.job.status, 'en_route');
});

test('live HTTP technician completion route persists evidence and settlement', async (t) => {
  const client = {
    query: async (sql, params) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
      if (/FROM service_jobs j/.test(sql)) return { rows: [{
        id: 'job-1', technician_id: 'tech-1', status: 'in_progress', total_ex_vat: '1000.00',
        product_cost: '500.00', other_costs: '100.00', mode: 'percentage', commission_rate: '0.3000', policy_version: 'initial-1'
      }] };
      if (/INSERT INTO job_evidence/.test(sql)) return { rows: [{ id: 'e1', storage_key: params[2] }] };
      if (/UPDATE service_jobs/.test(sql)) return { rows: [{ id: 'job-1', status: 'completed' }] };
      if (/INSERT INTO technician_settlements/.test(sql)) return { rows: [{ id: 's1', payout_amount: '120.00', status: 'pending_approval' }] };
      if (/INSERT INTO audit_log/.test(sql)) return { rows: [] };
      throw new Error('Unexpected query');
    },
    release() {}
  };
  const db = { query: async () => ({ rows: [{ id: 'tech-1', user_id: 'user-1' }] }), connect: async () => client };
  const server = createApiServer({ db: withSession(db) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/technicians/me/jobs/job-1/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders },
    body: JSON.stringify({ evidence: [{ mediaType: 'image', storageKey: 'jobs/job-1/after.jpg' }] })
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.job.status, 'completed');
  assert.equal(payload.settlement.status, 'pending_approval');
});

test('live HTTP finance approval route credits technician wallet', async (t) => {
  const client = {
    query: async (sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
      if (/FOR UPDATE/.test(sql)) return { rows: [{ id: 's1', technician_id: 'tech-1', payout_amount: '90.00', status: 'pending_approval' }] };
      if (/UPDATE technician_settlements/.test(sql)) return { rows: [{ id: 's1', technician_id: 'tech-1', payout_amount: '90.00', status: 'approved' }] };
      if (/INSERT INTO wallet_entries/.test(sql)) return { rows: [{ id: 'w1', technician_id: 'tech-1', amount: '90.00' }] };
      if (/INSERT INTO audit_log/.test(sql)) return { rows: [] };
      throw new Error('Unexpected query');
    },
    release() {}
  };
  const server = createApiServer({ db: withSession({ query: async () => ({ rows: [] }), connect: async () => client }, { userId: 'finance-1', role: 'finance' }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/settlements/s1/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders }
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.settlement.status, 'approved');
  assert.equal(payload.walletEntry.amount, '90.00');
});
