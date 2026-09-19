import { withTransaction } from '../persistence/transactions.mjs';

export async function rateCustomerJob(db,{jobId,customerId,actorUserId,score,comment=''}){
  return withTransaction(db,async client=>{
    const {rows:[job]}=await client.query(`SELECT id,customer_id,technician_id,status FROM service_jobs WHERE id=$1 AND customer_id=$2 FOR UPDATE`,[jobId,customerId]);
    if(!job)return null;
    if(job.status!=='completed')throw new Error('Service not completed');
    if(!job.technician_id)throw new Error('Technician missing');
    const {rows:[rating]}=await client.query(`INSERT INTO service_ratings(job_id,customer_id,technician_id,score,comment,verified_service) VALUES($1,$2,$3,$4,$5,true) ON CONFLICT(job_id)DO NOTHING RETURNING id,job_id,customer_id,technician_id,score,comment,verified_service,created_at`,[jobId,customerId,job.technician_id,score,comment]);
    if(!rating)throw new Error('Rating already exists');
    await client.query(`INSERT INTO audit_log(actor_user_id,action,entity_type,entity_id,data) VALUES($1,'service.rating_created','service_job',$2,$3::jsonb)`,[actorUserId,jobId,JSON.stringify({ratingId:rating.id,score})]);
    return rating;
  });
}
