import test from 'node:test';
import assert from 'node:assert/strict';
import { routePersistentRequest } from '../src/http/persistent-router.mjs';
import { issueInventoryToTechnician, receiveInventory, transferInventory } from '../src/inventory/operations.mjs';

test('inventory reader gets stock counters',async()=>{
 const db={query:async sql=>{assert.match(sql,/stock_value/);assert.match(sql,/out_of_stock/);return{rows:[{total_skus:12,low_stock:2,out_of_stock:1}]};}};const result=await routePersistentRequest({method:'GET',url:'/api/v1/inventory/stats',role:'finance',db});assert.equal(result.status,200);assert.equal(result.data.stats.low_stock,2);
});

test('dispatcher searches low stock with pagination',async()=>{
 const db={query:async(sql,params)=>{assert.match(sql,/technician_quantity/);assert.match(sql,/stock_status/);assert.deepEqual(params,['ممبرين','low',10,20]);return{rows:[{id:'i1',sku:'MEM-75',stock_status:'low',total_count:4}]};}};const result=await routePersistentRequest({method:'GET',url:'/api/v1/inventory',role:'dispatcher',context:{query:'ممبرين',status:'low',limit:'10',offset:'20'},db});assert.equal(result.status,200);assert.equal(result.data.items[0].sku,'MEM-75');assert.deepEqual(result.data.pagination,{limit:10,offset:20,total:4});
});

test('support cannot read inventory and finance cannot mutate it',async()=>{
 const db={query:async()=>{throw new Error('must not query');}};const read=await routePersistentRequest({method:'GET',url:'/api/v1/inventory',role:'support',db});const write=await routePersistentRequest({method:'POST',url:'/api/v1/inventory/items',role:'finance',db});assert.equal(read.status,403);assert.equal(write.status,403);
});

test('inventory item validation happens before transaction',async()=>{
 const db={query:async()=>({rows:[]}),connect:async()=>{throw new Error('must not connect');}};const result=await routePersistentRequest({method:'POST',url:'/api/v1/inventory/items',role:'branch_manager',context:{userId:'m1'},body:{sku:'',name:'x'},db});assert.equal(result.status,400);
});

function transactionalClient(handler){const calls=[];return{calls,db:{query:async()=>({rows:[]}),connect:async()=>({query:async(sql,params=[])=>{calls.push({sql,params});if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return{rows:[]};return handler(sql,params);},release(){}})}};}

test('warehouse receipt increases balance and records movement and audit',async()=>{
 const {db,calls}=transactionalClient(async(sql,params)=>{if(/CROSS JOIN warehouses/.test(sql))return{rows:[{id:'i1',warehouse_id:'main'}]};if(/INSERT INTO inventory_balances/.test(sql))return{rows:[{warehouse_id:'main',item_id:'i1',quantity:'10'}]};if(/UPDATE inventory_items/.test(sql))return{rows:[]};if(/INSERT INTO inventory_movements/.test(sql))return{rows:[{id:'mv1',movement_type:'receipt'}]};if(/INSERT INTO audit_log/.test(sql))return{rows:[]};throw new Error(`unexpected ${sql}`);});
 const result=await receiveInventory(db,{warehouseId:'main',itemId:'i1',quantity:10,unitCost:40,reference:'PO-1',notes:'',actorUserId:'m1'});assert.equal(result.balance.quantity,'10');assert.ok(calls.some(call=>call.sql==='COMMIT'));assert.ok(calls.some(call=>/inventory.received/.test(call.params[1]||'')));
});

function transferHandler(balance='10') {return async(sql,params)=>{if(/SELECT id FROM warehouses/.test(sql))return{rows:[{id:'secondary'}]};if(/SELECT warehouse_id, item_id, quantity/.test(sql))return{rows:[{warehouse_id:'main',item_id:'i1',quantity:balance}]};if(/UPDATE inventory_balances/.test(sql))return{rows:[]};if(/INSERT INTO inventory_balances/.test(sql))return{rows:[{warehouse_id:'secondary',item_id:'i1',quantity:params[2]}]};if(/INSERT INTO inventory_movements/.test(sql))return{rows:[{id:'mv2',movement_type:'transfer'}]};if(/INSERT INTO audit_log/.test(sql))return{rows:[]};throw new Error(`unexpected ${sql}`);};}

test('warehouse transfer prevents a negative balance and rolls back',async()=>{
 const {db,calls}=transactionalClient(transferHandler('2'));await assert.rejects(()=>transferInventory(db,{fromWarehouseId:'main',toWarehouseId:'secondary',itemId:'i1',quantity:3,reference:'TR-1',notes:'',actorUserId:'m1'}),/Insufficient/);assert.ok(calls.some(call=>call.sql==='ROLLBACK'));assert.ok(!calls.some(call=>/UPDATE inventory_balances/.test(call.sql)));
});

test('warehouse transfer updates both balances atomically',async()=>{
 const {db,calls}=transactionalClient(transferHandler('10'));const result=await transferInventory(db,{fromWarehouseId:'main',toWarehouseId:'secondary',itemId:'i1',quantity:3,reference:'TR-1',notes:'',actorUserId:'m1'});assert.equal(result.movement.movement_type,'transfer');assert.ok(calls.some(call=>call.sql==='COMMIT'));
});

test('technician issue deducts warehouse and credits custody atomically',async()=>{
 const {db,calls}=transactionalClient(async(sql,params)=>{if(/SELECT id FROM technicians/.test(sql))return{rows:[{id:'t1'}]};if(/SELECT warehouse_id, item_id, quantity/.test(sql))return{rows:[{quantity:'8'}]};if(/UPDATE inventory_balances/.test(sql))return{rows:[]};if(/INSERT INTO technician_inventory/.test(sql))return{rows:[{technician_id:'t1',item_id:'i1',quantity:2}]};if(/INSERT INTO inventory_movements/.test(sql))return{rows:[{id:'mv3',movement_type:'technician_issue'}]};if(/INSERT INTO audit_log/.test(sql))return{rows:[]};throw new Error(`unexpected ${sql}`);});
 const result=await issueInventoryToTechnician(db,{warehouseId:'main',technicianId:'t1',itemId:'i1',quantity:2,reference:'JOB-1',notes:'',actorUserId:'m1'});assert.equal(result.technicianBalance.quantity,2);assert.ok(calls.some(call=>/inventory.issued_to_technician/.test(call.params[1]||'')));
});

test('inventory movement route maps insufficient balance to conflict',async()=>{
 const {db}=transactionalClient(transferHandler('1'));const result=await routePersistentRequest({method:'POST',url:'/api/v1/inventory/transfer',role:'branch_manager',context:{userId:'m1'},body:{fromWarehouseId:'main',toWarehouseId:'secondary',itemId:'i1',quantity:4},db});assert.equal(result.status,409);assert.equal(result.data.error,'inventory_movement_conflict');
});

test('manager reads technician custody without exposing other records',async()=>{
 const db={query:async(sql,params)=>{assert.match(sql,/technician_inventory/);assert.deepEqual(params,['t1']);return{rows:[{technician_id:'t1',sku:'MEM-75',quantity:'3'}]};}};const result=await routePersistentRequest({method:'GET',url:'/api/v1/technicians/t1/inventory',role:'branch_manager',db});assert.equal(result.status,200);assert.equal(result.data.stock[0].quantity,'3');
});
