import test from 'node:test';
import assert from 'node:assert/strict';
import { routeUserAdminRequest } from '../src/http/user-admin-router.mjs';

const context={userId:'admin-1',tenantId:'org-1'};

test('non admin cannot access user administration',async()=>{
 const result=await routeUserAdminRequest({method:'GET',url:'/api/v1/users',role:'support',context,db:{query:async()=>{throw new Error('must not query')}}});
 assert.equal(result.status,403);
});

test('admin lists only users in current tenant and hides super admin',async()=>{
 const calls=[];const db={query:async(sql,params)=>{calls.push({sql,params});return{rows:[{id:'u1',mobile:'+966500000001',role:'support',is_active:true,total_count:1}]}}};
 const result=await routeUserAdminRequest({method:'GET',url:'/api/v1/users',role:'admin',context:{...context,query:'500'},db});
 assert.equal(result.status,200);assert.equal(result.data.users.length,1);assert.equal(calls[0].params[0],'org-1');assert.equal(calls[0].params[6],false);
});

test('admin cannot create super admin',async()=>{
 const result=await routeUserAdminRequest({method:'POST',url:'/api/v1/users',role:'admin',context,body:{mobile:'0500000001',role:'super_admin'},db:{query:async()=>{throw new Error('must not query')}}});
 assert.equal(result.status,400);
});

test('admin cannot remove own access',async()=>{
 const result=await routeUserAdminRequest({method:'PATCH',url:'/api/v1/users/admin-1',role:'admin',context,body:{isActive:false},db:{query:async()=>{throw new Error('must not query')}}});
 assert.equal(result.status,409);assert.equal(result.data.error,'cannot_modify_own_access');
});

test('role change revokes active sessions and writes audit',async()=>{
 const calls=[];const db={query:async(sql,params=[])=>{calls.push({sql,params});if(/SELECT id,mobile,role,is_active/.test(sql))return{rows:[{id:'u2',mobile:'+966500000002',role:'support',is_active:true}]};if(/UPDATE users SET role/.test(sql))return{rows:[{id:'u2',mobile:'+966500000002',role:'finance',is_active:true}]};if(/UPDATE auth_sessions/.test(sql)||/INSERT INTO audit_log/.test(sql))return{rows:[]};throw new Error(`unexpected ${sql}`)}};
 const result=await routeUserAdminRequest({method:'PATCH',url:'/api/v1/users/u2',role:'admin',context,body:{role:'finance'},db});
 assert.equal(result.status,200);assert.equal(result.data.user.role,'finance');assert.ok(calls.some(x=>/UPDATE auth_sessions/.test(x.sql)));assert.ok(calls.some(x=>/user.access_updated/.test(x.params[1]||'')));
});
