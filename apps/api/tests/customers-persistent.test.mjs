import test from 'node:test';
import assert from 'node:assert/strict';
import { routePersistentRequest } from '../src/http/persistent-router.mjs';

test('support lists customers with search and pagination', async () => {
  const db = { query: async (sql, params) => {
    assert.match(sql, /FROM customers c/);
    assert.deepEqual(params, ['نورة', 10, 20]);
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

test('customer details return CRM aggregates to authorized role', async () => {
  const db={query:async(sql,params)=>{assert.match(sql,/installed_assets/);assert.deepEqual(params,['c1']);return {rows:[{id:'c1',name:'محمد',addresses:[],assets:[],orders:[]}]};}};
  const result=await routePersistentRequest({method:'GET',url:'/api/v1/customers/c1',role:'admin',db});
  assert.equal(result.status,200);
  assert.equal(result.data.customer.id,'c1');
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

test('support reads an ordered customer timeline', async () => {
  const db={query:async(sql,params)=>{if(/SELECT c\.id/.test(sql))return{rows:[{id:'c1'}]};assert.match(sql,/UNION ALL/);assert.match(sql,/ORDER BY occurred_at DESC/);assert.deepEqual(params,['c1',25]);return{rows:[{type:'order',id:'o1',status:'paid'}]};}};
  const result=await routePersistentRequest({method:'GET',url:'/api/v1/customers/c1/timeline',role:'support',context:{limit:'25'},db});
  assert.equal(result.status,200);
  assert.equal(result.data.timeline[0].type,'order');
});

for (const collection of ['addresses','assets']) {
  test(`support reads paginated customer ${collection}`, async () => {
    const db={query:async(sql,params)=>{if(/SELECT c\.id/.test(sql))return{rows:[{id:'c1'}]};assert.match(sql,collection==='addresses'?/FROM service_locations/:/FROM installed_assets/);assert.deepEqual(params,['c1',5,10]);return{rows:[{id:`${collection}-1`,total_count:12}]};}};
    const result=await routePersistentRequest({method:'GET',url:`/api/v1/customers/c1/${collection}`,role:'branch_manager',context:{limit:'5',offset:'10'},db});
    assert.equal(result.status,200);
    assert.equal(result.data[collection][0].id,`${collection}-1`);
    assert.deepEqual(result.data.pagination,{limit:5,offset:10,total:12});
  });
}
