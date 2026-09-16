import test from 'node:test';
import assert from 'node:assert/strict';
import { routePersistentRequest } from '../src/http/persistent-router.mjs';

test('support reads aggregate customer stats', async () => {
  const db={query:async(sql)=>{assert.match(sql,/new_this_month/);assert.match(sql,/EXISTS/);return{rows:[{total:42,new_this_month:7,with_orders:31}]};}};
  const result=await routePersistentRequest({method:'GET',url:'/api/v1/customers/stats',role:'support',db});
  assert.deepEqual(result,{status:200,data:{stats:{total:42,new_this_month:7,with_orders:31}}});
});

test('support lists customers with search and pagination', async () => {
  const db = { query: async (sql, params) => {
    assert.match(sql, /FROM customers c/);
    assert.deepEqual(params, [null,'نورة',10,20]);
    return { rows: [{ id:'c1', name:'نورة', mobile:'+966500000000', total_count:3 }] };
  }};
  const result = await routePersistentRequest({ method:'GET', url:'/api/v1/customers', role:'support', context:{query:'نورة',limit:'10',offset:'20'}, db });
  assert.equal(result.status, 200);
  assert.equal(result.data.pagination.total, 3);
  assert.equal('total_count' in result.data.customers[0], false);
});

test('technician cannot read customer CRM data', async () => {
  const db = { query: async () => { throw new Error('database must not be queried'); } };
  const result = await routePersistentRequest({ method:'GET', url:'/api/v1/customers', role:'technician', db });
  assert.deepEqual(result, { status:403, data:{error:'forbidden'} });
});

test('support creates customer and normalizes Saudi mobile atomically', async () => {
  const calls=[];
  const client={query:async(sql,params)=>{ calls.push([sql,params]); if(/INSERT INTO users/.test(sql)) return {rows:[{id:'u1'}]}; if(/INSERT INTO customers/.test(sql)) return {rows:[{id:'c1',name:'سارة'}]}; return {rows:[]}; },release(){calls.push(['RELEASE']);}};
  const db={query:async()=>({rows:[]}),connect:async()=>client};
  const result=await routePersistentRequest({method:'POST',url:'/api/v1/customers',role:'support',body:{name:'سارة أحمد',mobile:'0551234567',cityId:'riyadh',addressText:'الياسمين'},db});
  assert.equal(result.status,201);
  assert.equal(result.data.customer.mobile,'+966551234567');
  assert.equal(calls[0][0],'BEGIN');
  assert.equal(calls.at(-2)[0],'COMMIT');
  assert.equal(calls.at(-1)[0],'RELEASE');
});

test('duplicate customer mobile rolls back and returns conflict', async () => {
  const calls=[];
  const client={query:async(sql)=>{calls.push(sql);return {rows:[]};},release(){calls.push('RELEASE');}};
  const result=await routePersistentRequest({method:'POST',url:'/api/v1/customers',role:'branch_manager',body:{name:'عميل جديد',mobile:'0500000000'},db:{query:async()=>({rows:[]}),connect:async()=>client}});
  assert.equal(result.status,409);
  assert.deepEqual(calls.slice(-2),['ROLLBACK','RELEASE']);
});

test('customer details return a lightweight CRM summary to authorized role', async () => {
  const db={query:async(sql,params)=>{assert.match(sql,/order_total_ex_vat/);assert.doesNotMatch(sql,/json_agg/);assert.deepEqual(params,['c1',null]);return {rows:[{id:'c1',name:'محمد',order_count:2,order_total_ex_vat:'2070'}]};}};
  const result=await routePersistentRequest({method:'GET',url:'/api/v1/customers/c1',role:'admin',db});
  assert.equal(result.status,200);
  assert.equal(result.data.customer.id,'c1');
  assert.equal(result.data.customer.order_count,2);
});

test('customer CRM list and details are tenant constrained',async()=>{
  const tenantId='00000000-0000-4000-8000-000000000001',calls=[];
  const db={query:async(sql,params)=>{calls.push({sql,params});return{rows:[]}}};
  await routePersistentRequest({method:'GET',url:'/api/v1/customers',role:'support',context:{tenantId},db});
  await routePersistentRequest({method:'GET',url:'/api/v1/customers/cross-tenant',role:'support',context:{tenantId},db});
  assert.match(calls[0].sql,/c\.organization_id=\$1/);assert.deepEqual(calls[0].params,[tenantId,'',20,0]);
  assert.match(calls[1].sql,/c\.organization_id=\$2/);assert.deepEqual(calls[1].params,['cross-tenant',tenantId]);
});

test('new customer inherits authenticated tenant',async()=>{
  const tenantId='00000000-0000-4000-8000-000000000001',calls=[];
  const client={query:async(sql,params)=>{calls.push({sql,params});if(/INSERT INTO users/.test(sql))return{rows:[{id:'u1'}]};if(/INSERT INTO customers/.test(sql))return{rows:[{id:'c1',name:'عميل'}]};return{rows:[]}},release(){}};
  const result=await routePersistentRequest({method:'POST',url:'/api/v1/customers',role:'support',context:{tenantId},body:{name:'عميل جديد',mobile:'0551234567'},db:{query:async()=>({rows:[]}),connect:async()=>client}});
  assert.equal(result.status,201);assert.deepEqual(calls.find(x=>/INSERT INTO users/.test(x.sql)).params,['+966551234567',tenantId]);assert.deepEqual(calls.find(x=>/INSERT INTO customers/.test(x.sql)).params,['u1','عميل جديد',tenantId]);
});

test('support updates customer name and mobile atomically', async () => {
  const calls=[];
  const client={query:async(sql,params)=>{calls.push([sql,params]);if(/SELECT c\.id/.test(sql))return{rows:[{id:'c1',user_id:'u1',name:'قديم',mobile:'+966500000000'}]};if(/UPDATE customers/.test(sql))return{rows:[{id:'c1',name:'الاسم الجديد'}]};return{rows:[]};},release(){calls.push(['RELEASE']);}};
  const result=await routePersistentRequest({method:'PATCH',url:'/api/v1/customers/c1',role:'support',body:{name:'الاسم الجديد',mobile:'0551234567'},db:{query:async()=>({rows:[]}),connect:async()=>client}});
  assert.equal(result.status,200);
  assert.equal(result.data.customer.mobile,'+966551234567');
  assert.ok(calls.some(([sql])=>/UPDATE users/.test(sql)));
  assert.equal(calls.at(-2)[0],'COMMIT');
});

test('customer update validates payload before database access', async () => {
  const db={query:async()=>{throw new Error('must not query');}};
  const result=await routePersistentRequest({method:'PATCH',url:'/api/v1/customers/c1',role:'support',body:{mobile:'123'},db});
  assert.deepEqual(result,{status:400,data:{error:'invalid_customer_update'}});
});

test('support adds an address only to an existing customer', async () => {
  const db={query:async(sql,params)=>{assert.match(sql,/INSERT INTO service_locations/);assert.deepEqual(params,['c1','riyadh','حي الياسمين']);return{rows:[{id:'a1',customer_id:'c1',city_id:'riyadh',address_text:'حي الياسمين'}]};}};
  const result=await routePersistentRequest({method:'POST',url:'/api/v1/customers/c1/addresses',role:'support',body:{cityId:'riyadh',addressText:'حي الياسمين'},db});
  assert.equal(result.status,201);
  assert.equal(result.data.address.id,'a1');
});

test('support registers a customer asset and derives its next maintenance date', async () => {
  const db={query:async(sql,params)=>{assert.match(sql,/INSERT INTO installed_assets/);assert.deepEqual(params,['c1','جهاز سبيل 7 مراحل','SBL-100','2026-09-15T00:00:00.000Z','2027-09-15T00:00:00.000Z',6,'2027-03-15T00:00:00.000Z']);return{rows:[{id:'asset-1',product_id:params[1],next_maintenance_at:params[6],status:'active'}]};}};
  const result=await routePersistentRequest({method:'POST',url:'/api/v1/customers/c1/assets',role:'support',body:{productId:'جهاز سبيل 7 مراحل',serialNumber:'SBL-100',installedAt:'2026-09-15',warrantyEndsAt:'2027-09-15',maintenanceIntervalMonths:6},db});
  assert.equal(result.status,201);
  assert.equal(result.data.asset.next_maintenance_at,'2027-03-15T00:00:00.000Z');
});

test('customer asset registration rejects invalid dates before database access', async () => {
  const db={query:async()=>{throw new Error('must not query');}};
  const result=await routePersistentRequest({method:'POST',url:'/api/v1/customers/c1/assets',role:'branch_manager',body:{productId:'جهاز سبيل',installedAt:'2026-09-15',warrantyEndsAt:'2025-09-15',maintenanceIntervalMonths:0},db});
  assert.deepEqual(result,{status:400,data:{error:'invalid_asset'}});
});

test('technician cannot register assets for customers', async () => {
  const db={query:async()=>{throw new Error('must not query');}};
  const result=await routePersistentRequest({method:'POST',url:'/api/v1/customers/c1/assets',role:'technician',body:{productId:'جهاز سبيل',installedAt:'2026-09-15'},db});
  assert.deepEqual(result,{status:403,data:{error:'forbidden'}});
});

test('support reads a paginated customer timeline including asset maintenance', async () => {
  const db={query:async(sql,params)=>{if(/SELECT c\.id/.test(sql))return{rows:[{id:'c1'}]};assert.match(sql,/asset_maintenance_events/);assert.match(sql,/ORDER BY occurred_at DESC/);assert.deepEqual(params,['c1',25,10]);return{rows:[{type:'maintenance',id:'m1',status:'completed',total_count:37}]};}};
  const result=await routePersistentRequest({method:'GET',url:'/api/v1/customers/c1/timeline',role:'support',context:{limit:'25',offset:'10'},db});
  assert.equal(result.status,200);
  assert.equal(result.data.timeline[0].type,'maintenance');
  assert.deepEqual(result.data.pagination,{limit:25,offset:10,total:37});
});

for (const collection of ['addresses','assets','orders','jobs']) {
  test(`support reads paginated customer ${collection}`, async () => {
    const db={query:async(sql,params)=>{if(/SELECT c\.id/.test(sql))return{rows:[{id:'c1'}]};const matcher={addresses:/FROM service_locations/,assets:/FROM installed_assets/,orders:/FROM orders WHERE/,jobs:/FROM service_jobs/}[collection];assert.match(sql,matcher);assert.deepEqual(params,['c1',5,10]);return{rows:[{id:`${collection}-1`,rating_score:5,total_count:12}]};}};
    const result=await routePersistentRequest({method:'GET',url:`/api/v1/customers/c1/${collection}`,role:'branch_manager',context:{limit:'5',offset:'10'},db});
    assert.equal(result.status,200);
    assert.equal(result.data[collection][0].id,`${collection}-1`);
    assert.deepEqual(result.data.pagination,{limit:5,offset:10,total:12});
  });
}

test('customer service history joins order, location and verified rating',async()=>{
  const db={query:async(sql,params)=>{
    if(/SELECT c\.id/.test(sql))return{rows:[{id:'c1'}]};
    assert.match(sql,/JOIN orders/);assert.match(sql,/LEFT JOIN service_locations/);assert.match(sql,/LEFT JOIN service_ratings/);
    assert.deepEqual(params,['c1',10,0]);return{rows:[{id:'job-1',external_order_id:'1048',status:'completed',rating_score:5,total_count:1}]};
  }};
  const result=await routePersistentRequest({method:'GET',url:'/api/v1/customers/c1/jobs',role:'support',context:{limit:'10'},db});
  assert.equal(result.status,200);assert.equal(result.data.jobs[0].rating_score,5);
  assert.deepEqual(result.data.pagination,{limit:10,offset:0,total:1});
});

test('support reads paginated maintenance history for an owned asset',async()=>{
  const db={query:async(sql,params)=>{
    if(/FROM installed_assets WHERE id/.test(sql))return{rows:[{id:'asset-1',customer_id:'c1'}]};
    assert.match(sql,/FROM asset_maintenance_events/);assert.deepEqual(params,['asset-1','c1',10,0]);
    return{rows:[{id:'maintenance-1',notes:'تغيير فلاتر',total_count:1}]};
  }};
  const result=await routePersistentRequest({method:'GET',url:'/api/v1/customers/c1/assets/asset-1/history',role:'support',context:{limit:'10'},db});
  assert.equal(result.status,200);assert.equal(result.data.maintenance[0].id,'maintenance-1');
  assert.deepEqual(result.data.pagination,{limit:10,offset:0,total:1});
});

test('asset status update validates state before database access',async()=>{
  const db={query:async()=>{throw new Error('must not query');}};
  const result=await routePersistentRequest({method:'PATCH',url:'/api/v1/customers/c1/assets/asset-1',role:'support',context:{userId:'support-1'},body:{status:'retired'},db});
  assert.deepEqual(result,{status:400,data:{error:'invalid_asset_status'}});
});
