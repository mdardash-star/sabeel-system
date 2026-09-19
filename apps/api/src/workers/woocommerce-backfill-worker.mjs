import { createWooCommerceCatalogClient } from '../integrations/woocommerce-catalog.mjs';
import { persistPaidServiceOrder } from '../integrations/woocommerce-persistence.mjs';

const DEFAULT_ORG = '00000000-0000-4000-8000-000000000001';

export async function runWooCommerceBackfillBatch(db,{batchSize=25,organizationId=DEFAULT_ORG}={}){
  const woo=createWooCommerceCatalogClient();
  if(!woo.configured)return{status:'disabled',reason:'woocommerce_not_configured'};

  const latest=(await db.query(`SELECT data FROM audit_log
    WHERE action='woocommerce.backfill_auto_batch'
    ORDER BY created_at DESC LIMIT 1`)).rows[0]?.data||null;

  if(latest?.done)return{status:'complete',page:Number(latest.page||0),cutoff:latest.cutoff||null};

  const page=Math.max(1,Number(latest?.nextPage||1));
  const cutoff=latest?.cutoff||new Date().toISOString();
  const perPage=Math.min(25,Math.max(1,Number(batchSize||25)));
  const orders=await woo.listRawOrders({page,perPage,status:'completed',before:cutoff});

  const summary={page,perPage,cutoff,processed:0,created:0,duplicates:0,failed:0,done:false,nextPage:null};
  for(const order of orders){
    summary.processed++;
    try{
      const result=await persistPaidServiceOrder(db,order,{organizationId});
      if(result?.duplicate)summary.duplicates++;else summary.created++;
    }catch(error){
      summary.failed++;
    }
  }
  summary.done=orders.length<perPage;
  summary.nextPage=summary.done?null:page+1;

  await db.query(`INSERT INTO audit_log(actor_user_id,action,entity_type,entity_id,data)
    VALUES(NULL,'woocommerce.backfill_auto_batch','woocommerce','completed_orders',$1::jsonb)`,
    [JSON.stringify(summary)]);

  return{status:summary.done?'complete':'progress',...summary};
}
