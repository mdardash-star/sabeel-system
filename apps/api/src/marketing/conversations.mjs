import { withTransaction } from '../persistence/transactions.mjs';

const DEFAULT_ORG = '00000000-0000-4000-8000-000000000001';

export async function ingestConversationMessage(db,input){return withTransaction(db,async c=>{
 const organizationId=input.organizationId||DEFAULT_ORG;
 const conversation=(await c.query(`INSERT INTO customer_conversations(organization_id,customer_id,channel,external_thread_id,contact_handle,subject,status,last_message_at)
 VALUES($1,$2,$3,$4,$5,$6,'pending_agent',$7) ON CONFLICT(organization_id,channel,external_thread_id)DO UPDATE SET customer_id=COALESCE(customer_conversations.customer_id,EXCLUDED.customer_id),contact_handle=EXCLUDED.contact_handle,subject=CASE WHEN customer_conversations.subject='' THEN EXCLUDED.subject ELSE customer_conversations.subject END,status=CASE WHEN customer_conversations.status='closed' THEN 'pending_agent' ELSE customer_conversations.status END,last_message_at=GREATEST(customer_conversations.last_message_at,EXCLUDED.last_message_at),updated_at=now() RETURNING *`,[organizationId,input.customerId||null,input.channel,input.externalThreadId,input.contactHandle||'',input.subject||'',input.sentAt])).rows[0];
 const message=(await c.query(`INSERT INTO conversation_messages(organization_id,conversation_id,external_message_id,direction,sender_type,body,delivery_status,sent_at,metadata)VALUES($1,$2,$3,'inbound','customer',$4,'received',$5,$6::jsonb)ON CONFLICT(organization_id,external_message_id)WHERE external_message_id IS NOT NULL DO NOTHING RETURNING *`,[organizationId,conversation.id,input.externalMessageId||null,input.body,input.sentAt,JSON.stringify(input.metadata||{})])).rows[0];
 if(message)await c.query(`UPDATE customer_conversations SET unread_count=unread_count+1,status='pending_agent',last_message_at=$3,updated_at=now()WHERE id=$1 AND organization_id=$2`,[conversation.id,organizationId,input.sentAt]);
 return{conversation:{...conversation,unread_count:conversation.unread_count+(message?1:0)},message:message||null,duplicate:!message};
})}

export async function replyToConversation(db,input){return withTransaction(db,async c=>{
 const organizationId=input.organizationId||DEFAULT_ORG;
 const conversation=(await c.query(`SELECT * FROM customer_conversations WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[input.conversationId,organizationId])).rows[0];
 if(!conversation)return null;if(conversation.status==='closed')throw new Error('Conversation is closed');
 const message=(await c.query(`INSERT INTO conversation_messages(organization_id,conversation_id,direction,sender_type,body,delivery_status,sent_by,metadata)VALUES($1,$2,'outbound','agent',$3,'queued',$4,$5::jsonb)RETURNING *`,[organizationId,input.conversationId,input.body,input.actorUserId,JSON.stringify(input.metadata||{})])).rows[0];
 const updated=(await c.query(`UPDATE customer_conversations SET status='waiting_customer',assigned_to=COALESCE(assigned_to,$3),unread_count=0,last_message_at=$4,updated_at=now()WHERE id=$1 AND organization_id=$2 RETURNING *`,[input.conversationId,organizationId,input.actorUserId,message.sent_at])).rows[0];
 await audit(c,input.actorUserId,'conversation.replied','customer_conversation',input.conversationId,{messageId:message.id,channel:conversation.channel,organizationId});return{conversation:updated,message};
})}

export async function updateConversation(db,input){return withTransaction(db,async c=>{
 const organizationId=input.organizationId||DEFAULT_ORG;
 const current=(await c.query(`SELECT * FROM customer_conversations WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[input.conversationId,organizationId])).rows[0];if(!current)return null;
 const updated=(await c.query(`UPDATE customer_conversations SET status=COALESCE($3,status),priority=COALESCE($4,priority),assigned_to=CASE WHEN $5::boolean THEN $6 ELSE assigned_to END,unread_count=CASE WHEN $3='closed' THEN 0 ELSE unread_count END,updated_at=now()WHERE id=$1 AND organization_id=$2 RETURNING *`,[input.conversationId,organizationId,input.status||null,input.priority||null,input.assignProvided,input.assignedTo||null])).rows[0];
 await audit(c,input.actorUserId,'conversation.updated','customer_conversation',input.conversationId,{status:input.status||null,priority:input.priority||null,assignedTo:input.assignProvided?(input.assignedTo||null):undefined,organizationId});return updated;
})}

async function audit(c,userId,action,entityType,entityId,data){await c.query(`INSERT INTO audit_log(actor_user_id,action,entity_type,entity_id,data)VALUES($1,$2,$3,$4,$5::jsonb)`,[userId,action,entityType,entityId,JSON.stringify(data)])}
