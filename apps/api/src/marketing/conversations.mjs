import { withTransaction } from '../persistence/transactions.mjs';

export async function ingestConversationMessage(db,input){return withTransaction(db,async c=>{
 const conversation=(await c.query(`INSERT INTO customer_conversations(customer_id,channel,external_thread_id,contact_handle,subject,status,last_message_at)
 VALUES($1,$2,$3,$4,$5,'pending_agent',$6) ON CONFLICT(channel,external_thread_id)DO UPDATE SET customer_id=COALESCE(customer_conversations.customer_id,EXCLUDED.customer_id),contact_handle=EXCLUDED.contact_handle,subject=CASE WHEN customer_conversations.subject='' THEN EXCLUDED.subject ELSE customer_conversations.subject END,status=CASE WHEN customer_conversations.status='closed' THEN 'pending_agent' ELSE customer_conversations.status END,last_message_at=GREATEST(customer_conversations.last_message_at,EXCLUDED.last_message_at),updated_at=now() RETURNING *`,[input.customerId||null,input.channel,input.externalThreadId,input.contactHandle||'',input.subject||'',input.sentAt])).rows[0];
 const message=(await c.query(`INSERT INTO conversation_messages(conversation_id,external_message_id,direction,sender_type,body,delivery_status,sent_at,metadata)VALUES($1,$2,'inbound','customer',$3,'received',$4,$5::jsonb)ON CONFLICT(external_message_id)WHERE external_message_id IS NOT NULL DO NOTHING RETURNING *`,[conversation.id,input.externalMessageId||null,input.body,input.sentAt,JSON.stringify(input.metadata||{})])).rows[0];
 if(message)await c.query(`UPDATE customer_conversations SET unread_count=unread_count+1,status='pending_agent',last_message_at=$2,updated_at=now()WHERE id=$1`,[conversation.id,input.sentAt]);
 return{conversation:{...conversation,unread_count:conversation.unread_count+(message?1:0)},message:message||null,duplicate:!message};
})}

export async function replyToConversation(db,input){return withTransaction(db,async c=>{
 const conversation=(await c.query(`SELECT * FROM customer_conversations WHERE id=$1 FOR UPDATE`,[input.conversationId])).rows[0];
 if(!conversation)return null;if(conversation.status==='closed')throw new Error('Conversation is closed');
 const message=(await c.query(`INSERT INTO conversation_messages(conversation_id,direction,sender_type,body,delivery_status,sent_by,metadata)VALUES($1,'outbound','agent',$2,'queued',$3,$4::jsonb)RETURNING *`,[input.conversationId,input.body,input.actorUserId,JSON.stringify(input.metadata||{})])).rows[0];
 const updated=(await c.query(`UPDATE customer_conversations SET status='waiting_customer',assigned_to=COALESCE(assigned_to,$2),unread_count=0,last_message_at=$3,updated_at=now()WHERE id=$1 RETURNING *`,[input.conversationId,input.actorUserId,message.sent_at])).rows[0];
 await audit(c,input.actorUserId,'conversation.replied','customer_conversation',input.conversationId,{messageId:message.id,channel:conversation.channel});return{conversation:updated,message};
})}

export async function updateConversation(db,input){return withTransaction(db,async c=>{
 const current=(await c.query(`SELECT * FROM customer_conversations WHERE id=$1 FOR UPDATE`,[input.conversationId])).rows[0];if(!current)return null;
 const updated=(await c.query(`UPDATE customer_conversations SET status=COALESCE($2,status),priority=COALESCE($3,priority),assigned_to=CASE WHEN $4::boolean THEN $5 ELSE assigned_to END,unread_count=CASE WHEN $2='closed' THEN 0 ELSE unread_count END,updated_at=now()WHERE id=$1 RETURNING *`,[input.conversationId,input.status||null,input.priority||null,input.assignProvided,input.assignedTo||null])).rows[0];
 await audit(c,input.actorUserId,'conversation.updated','customer_conversation',input.conversationId,{status:input.status||null,priority:input.priority||null,assignedTo:input.assignProvided?(input.assignedTo||null):undefined});return updated;
})}

async function audit(c,userId,action,entityType,entityId,data){await c.query(`INSERT INTO audit_log(actor_user_id,action,entity_type,entity_id,data)VALUES($1,$2,$3,$4,$5::jsonb)`,[userId,action,entityType,entityId,JSON.stringify(data)])}
