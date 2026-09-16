import test from 'node:test';
import assert from 'node:assert/strict';
import { routePersistentRequest } from '../src/http/persistent-router.mjs';

test('finance reads tenant-scoped settlement counters and amounts',async()=>{
 const db={query:async(sql,params)=>{assert.match(sql,/j\.organization_id = \$1/);assert.deepEqual(params,['org-1']);return{rows:[{pending_approval:4,pending_amount:'320.00',approved_amount:'190.00'}]};}};
 const result=await routePersistentRequest({method:'GET',url:'/api/v1/settlements/stats',role:'finance',context:{tenantId:'org-1'},db});assert.equal(result.status,200);assert.equal(result.data.stats.pending_approval,4);
});

test('branch manager reads filtered settlement worklist',async()=>{
 const db={query:async(sql,params)=>{assert.match(sql,/j\.organization_id = \$5/);assert.deepEqual(params,['سبيل','pending_approval',10,20,'org-1']);return{rows:[{id:'s1',customer_name:'سبيل',total_count:6}]};}};
 const result=await routePersistentRequest({method:'GET',url:'/api/v1/settlements',role:'branch_manager',context:{query:'سبيل',status:'pending_approval',limit:'10',offset:'20',tenantId:'org-1'},db});assert.equal(result.status,200);assert.deepEqual(result.data.pagination,{limit:10,offset:20,total:6});
});

test('invalid settlement status is rejected before database access',async()=>{
 const db={query:async()=>{throw new Error('must not query');}};const result=await routePersistentRequest({method:'GET',url:'/api/v1/settlements',role:'finance',context:{status:'unknown'},db});assert.equal(result.status,400);
});

test('dispatcher cannot access finance worklist',async()=>{
 const db={query:async()=>{throw new Error('must not query');}};const result=await routePersistentRequest({method:'GET',url:'/api/v1/settlements',role:'dispatcher',db});assert.deepEqual(result,{status:403,data:{error:'forbidden'}});
});

function financeDb(status='pending_approval'){
 const calls=[];const client={query:async(sql,params=[])=>{calls.push({sql,params});if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return{rows:[]};if(/SELECT s\.id, s\.technician_id/.test(sql))return{rows:[{id:'s1',technician_id:'t1',payout_amount:'75.00',status}]};if(/UPDATE technician_settlements/.test(sql))return{rows:[{id:'s1',technician_id:'t1',payout_amount:'75.00',status:/paid/.test(sql)?'paid':'rejected'}]};if(/UPDATE wallet_entries/.test(sql))return{rows:[]};if(/INSERT INTO audit_log/.test(sql))return{rows:[]};throw new Error(`unexpected query: ${sql}`);},release(){}};return{db:{query:async()=>({rows:[]}),connect:async()=>client},calls};
}

test('settlement rejection requires a reason',async()=>{
 const db={query:async()=>({rows:[]})};const result=await routePersistentRequest({method:'POST',url:'/api/v1/settlements/s1/reject',role:'finance',context:{userId:'f1'},body:{},db});assert.deepEqual(result,{status:400,data:{error:'rejection_reason_required'}});
});

test('finance rejects pending settlement and audits the reason',async()=>{
 const {db,calls}=financeDb();const result=await routePersistentRequest({method:'POST',url:'/api/v1/settlements/s1/reject',role:'finance',context:{userId:'f1'},body:{reason:'بيانات التكلفة ناقصة'},db});assert.equal(result.status,200);const audit=calls.find(call=>/INSERT INTO audit_log/.test(call.sql));assert.match(audit.params[2],/بيانات التكلفة ناقصة/);assert.ok(calls.some(call=>call.sql==='COMMIT'));
});

test('payment requires reference and approved settlement',async()=>{
 const missing=await routePersistentRequest({method:'POST',url:'/api/v1/settlements/s1/paid',role:'finance',context:{userId:'f1'},body:{},db:{query:async()=>({rows:[]})}});assert.equal(missing.status,400);
 const {db,calls}=financeDb('pending_approval');const invalid=await routePersistentRequest({method:'POST',url:'/api/v1/settlements/s1/paid',role:'finance',context:{userId:'f1'},body:{paymentReference:'TRX-100'},db});assert.equal(invalid.status,409);assert.ok(calls.some(call=>call.sql==='ROLLBACK'));
});

test('finance marks approved settlement and wallet credit paid atomically',async()=>{
 const {db,calls}=financeDb('approved');const result=await routePersistentRequest({method:'POST',url:'/api/v1/settlements/s1/paid',role:'finance',context:{userId:'f1'},body:{paymentReference:'TRX-100'},db});assert.equal(result.status,200);assert.equal(result.data.settlement.status,'paid');assert.ok(calls.some(call=>/UPDATE wallet_entries/.test(call.sql)));const audit=calls.find(call=>/INSERT INTO audit_log/.test(call.sql));assert.match(audit.params[2],/TRX-100/);
});

test('settlement mutation is constrained to authenticated tenant',async()=>{
 const {db,calls}=financeDb();await routePersistentRequest({method:'POST',url:'/api/v1/settlements/s1/reject',role:'finance',context:{userId:'f1',tenantId:'org-1'},body:{reason:'بيانات ناقصة'},db});const lock=calls.find(call=>/SELECT s\.id, s\.technician_id/.test(call.sql));assert.match(lock.sql,/j\.organization_id=\$2/);assert.equal(lock.params[1],'org-1');
});
