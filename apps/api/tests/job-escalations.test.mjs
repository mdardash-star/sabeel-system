import test from 'node:test';
import assert from 'node:assert/strict';
import { escalationLevel, detectJobEscalations, resolveJobEscalations } from '../src/jobs/escalations.mjs';
import { routePersistentRequest } from '../src/http/persistent-router.mjs';

test('SLA escalation levels increase at two and four hours',()=>{
 assert.equal(escalationLevel(0),0);assert.equal(escalationLevel(45),1);assert.equal(escalationLevel(120),2);assert.equal(escalationLevel(239),2);assert.equal(escalationLevel(240),3);
});

function escalationDb({insert=true}={}){
 const calls=[];const client={query:async(sql,params=[])=>{calls.push({sql,params});if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return{rows:[]};if(/FROM service_jobs/.test(sql))return{rows:[{id:'j1',minutes_late:130},{id:'j2',minutes_late:260}]};if(/INSERT INTO job_escalations/.test(sql))return{rows:insert?[{id:`e-${params[0]}`,job_id:params[0],level:params[1],minutes_late:params[2],status:'open'}]:[]};if(/UPDATE job_escalations/.test(sql))return{rows:[{id:'e1',job_id:'j1',status:'resolved'}]};if(/INSERT INTO audit_log/.test(sql))return{rows:[]};throw new Error(`unexpected query: ${sql}`);},release(){}};return{db:{query:async()=>({rows:[]}),connect:async()=>client},calls};
}

test('detector creates only new escalation levels and audits them',async()=>{
 const {db,calls}=escalationDb();const result=await detectJobEscalations(db,{actorUserId:'d1',limit:50});assert.equal(result.scanned,2);assert.equal(result.created.length,2);assert.equal(result.created[0].level,2);assert.equal(result.created[1].level,3);assert.equal(calls.filter(call=>/INSERT INTO audit_log/.test(call.sql)).length,2);
});

test('detector is idempotent when escalation level already exists',async()=>{
 const {db,calls}=escalationDb({insert:false});const result=await detectJobEscalations(db,{actorUserId:'d1'});assert.equal(result.created.length,0);assert.equal(calls.filter(call=>/INSERT INTO audit_log/.test(call.sql)).length,0);
});

test('resolving escalation updates all open levels and audits once',async()=>{
 const {db,calls}=escalationDb();const result=await resolveJobEscalations(db,{jobId:'j1',reason:'تم التواصل وإعادة الجدولة',actorUserId:'d1'});assert.equal(result.length,1);const update=calls.find(call=>/UPDATE job_escalations/.test(call.sql));assert.equal(update.params[2],'تم التواصل وإعادة الجدولة');assert.ok(calls.some(call=>/job.sla_resolved/.test(call.sql)));
});

test('dispatcher reads escalation stats and queue',async()=>{
 const db={query:async(sql,params)=>{if(/resolved_today/.test(sql))return{rows:[{open:3,level_3:1}]};assert.match(sql,/JOIN service_jobs/);assert.deepEqual(params,['open',5,10]);return{rows:[{id:'e1',level:3,total_count:3}]};}};
 const stats=await routePersistentRequest({method:'GET',url:'/api/v1/jobs/escalations/stats',role:'dispatcher',db});const list=await routePersistentRequest({method:'GET',url:'/api/v1/jobs/escalations',role:'dispatcher',context:{status:'open',limit:'5',offset:'10'},db});assert.equal(stats.data.stats.level_3,1);assert.equal(list.data.escalations[0].level,3);assert.equal(list.data.pagination.total,3);
});

test('dispatcher runs escalation detector through persistent route',async()=>{
 const {db}=escalationDb();const result=await routePersistentRequest({method:'POST',url:'/api/v1/jobs/escalations/run',role:'dispatcher',context:{userId:'d1'},body:{limit:20},db});assert.equal(result.status,200);assert.equal(result.data.created.length,2);
});

test('escalation resolution requires reason and dispatch permission',async()=>{
 const db={query:async()=>({rows:[]})};const missing=await routePersistentRequest({method:'POST',url:'/api/v1/jobs/j1/escalations/resolve',role:'dispatcher',context:{userId:'d1'},body:{},db});const forbidden=await routePersistentRequest({method:'POST',url:'/api/v1/jobs/escalations/run',role:'support',context:{userId:'s1'},db});assert.equal(missing.status,400);assert.equal(forbidden.status,403);
});
