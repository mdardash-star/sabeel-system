export function createTenantReadRepositories(db, tenantId) {
  if (!db?.query) throw new Error('Database client with query() is required');
  if (!tenantId) throw new Error('Tenant id is required');

  return {
    inventory: {
      async stats() {
        const { rows } = await db.query(`SELECT COUNT(*) FILTER (WHERE i.is_active)::integer AS total_skus,
          COALESCE(SUM(stock.quantity),0)::numeric(14,2) AS total_units,
          COALESCE(SUM(stock.quantity*i.unit_cost),0)::numeric(14,2) AS stock_value,
          COUNT(*) FILTER (WHERE i.is_active AND COALESCE(stock.quantity,0)=0)::integer AS out_of_stock,
          COUNT(*) FILTER (WHERE i.is_active AND COALESCE(stock.quantity,0)>0 AND COALESCE(stock.quantity,0)<=i.reorder_level)::integer AS low_stock
          FROM inventory_items i LEFT JOIN LATERAL (
            SELECT SUM(quantity) AS quantity FROM inventory_balances WHERE organization_id=$1 AND item_id=i.id
          ) stock ON true WHERE i.organization_id=$1`, [tenantId]);
        return rows[0] || { total_skus:0,total_units:0,stock_value:0,out_of_stock:0,low_stock:0 };
      },
      async list({query='',status='all',limit=20,offset=0}={}) {
        const { rows } = await db.query(`SELECT i.id,i.sku,i.name,i.unit,i.reorder_level,i.unit_cost,i.is_active,
          COALESCE(stock.total_quantity,0)::numeric(12,2) AS total_quantity,
          COALESCE(stock.balances,'[]'::json) AS balances,
          COALESCE(tech.technician_quantity,0)::numeric(12,2) AS technician_quantity,
          CASE WHEN COALESCE(stock.total_quantity,0)=0 THEN 'out' WHEN stock.total_quantity<=i.reorder_level THEN 'low' ELSE 'ok' END AS stock_status,
          COUNT(*) OVER()::integer AS total_count
          FROM inventory_items i
          LEFT JOIN LATERAL (SELECT SUM(b.quantity) AS total_quantity,
            JSON_AGG(JSON_BUILD_OBJECT('warehouse_id',b.warehouse_id,'warehouse_name',w.name,'quantity',b.quantity) ORDER BY w.name) AS balances
            FROM inventory_balances b JOIN warehouses w ON w.id=b.warehouse_id AND w.organization_id=$1
            WHERE b.organization_id=$1 AND b.item_id=i.id) stock ON true
          LEFT JOIN LATERAL (SELECT SUM(quantity) AS technician_quantity FROM technician_inventory WHERE organization_id=$1 AND item_id=i.id) tech ON true
          WHERE i.organization_id=$1 AND i.is_active AND ($2='' OR i.sku ILIKE '%'||$2||'%' OR i.name ILIKE '%'||$2||'%')
            AND CASE $3 WHEN 'low' THEN COALESCE(stock.total_quantity,0)>0 AND COALESCE(stock.total_quantity,0)<=i.reorder_level WHEN 'out' THEN COALESCE(stock.total_quantity,0)=0 ELSE true END
          ORDER BY CASE WHEN COALESCE(stock.total_quantity,0)=0 THEN 0 WHEN stock.total_quantity<=i.reorder_level THEN 1 ELSE 2 END,i.name ASC LIMIT $4 OFFSET $5`,
          [tenantId,query.trim(),status,limit,offset]);
        return rows;
      },
      async movements({limit=20,offset=0}={}) {
        const { rows } = await db.query(`SELECT m.id,m.movement_type,m.item_id,i.sku,i.name AS item_name,m.quantity,m.unit_cost,
          m.from_warehouse_id,wf.name AS from_warehouse_name,m.to_warehouse_id,wt.name AS to_warehouse_name,
          m.technician_id,u.mobile AS technician_mobile,m.reference,m.notes,m.created_at,COUNT(*) OVER()::integer AS total_count
          FROM inventory_movements m JOIN inventory_items i ON i.id=m.item_id AND i.organization_id=$1
          LEFT JOIN warehouses wf ON wf.id=m.from_warehouse_id AND wf.organization_id=$1
          LEFT JOIN warehouses wt ON wt.id=m.to_warehouse_id AND wt.organization_id=$1
          LEFT JOIN technicians t ON t.id=m.technician_id LEFT JOIN users u ON u.id=t.user_id AND u.organization_id=$1
          WHERE m.organization_id=$1 ORDER BY m.created_at DESC,m.id DESC LIMIT $2 OFFSET $3`, [tenantId,limit,offset]);
        return rows;
      },
      async technicianStock(technicianId) {
        const { rows } = await db.query(`SELECT ti.technician_id,ti.item_id,i.sku,i.name,i.unit,ti.quantity,ti.updated_at
          FROM technician_inventory ti JOIN inventory_items i ON i.id=ti.item_id AND i.organization_id=$1
          JOIN technicians t ON t.id=ti.technician_id JOIN users u ON u.id=t.user_id AND u.organization_id=$1
          WHERE ti.organization_id=$1 AND ti.technician_id=$2 AND ti.quantity>0 ORDER BY i.name ASC`, [tenantId,technicianId]);
        return rows;
      }
    },

    purchasing: {
      async stats() {
        const { rows } = await db.query(`SELECT COUNT(*) FILTER (WHERE status IN ('draft','approved','partially_received'))::integer AS open_orders,
          COUNT(*) FILTER (WHERE status='draft')::integer AS pending_approval,
          COUNT(*) FILTER (WHERE status IN ('approved','partially_received'))::integer AS awaiting_receipt,
          COUNT(*) FILTER (WHERE status IN ('approved','partially_received') AND expected_at<now())::integer AS overdue,
          COUNT(*) FILTER (WHERE status='received' AND updated_at>=date_trunc('month',now()))::integer AS received_this_month,
          COALESCE(SUM(subtotal) FILTER (WHERE status IN ('draft','approved','partially_received')),0)::numeric(14,2) AS open_value
          FROM purchase_orders WHERE organization_id=$1`, [tenantId]);
        return rows[0];
      },
      async suppliers({query='',limit=100,offset=0}={}) {
        const { rows } = await db.query(`SELECT s.*,COUNT(po.id)::integer AS order_count,
          COALESCE(SUM(po.subtotal) FILTER (WHERE po.status<>'cancelled'),0)::numeric(14,2) AS total_spend,
          COUNT(*) OVER()::integer AS total_count
          FROM suppliers s LEFT JOIN purchase_orders po ON po.supplier_id=s.id AND po.organization_id=$1
          WHERE s.organization_id=$1 AND s.is_active AND ($2='' OR s.name ILIKE '%'||$2||'%' OR s.mobile LIKE '%'||$2||'%')
          GROUP BY s.id ORDER BY s.name ASC LIMIT $3 OFFSET $4`, [tenantId,query.trim(),limit,offset]);
        return rows;
      },
      async list({query='',status='all',limit=20,offset=0}={}) {
        const { rows } = await db.query(`SELECT po.*,s.name AS supplier_name,w.name AS warehouse_name,
          COALESCE(lines.item_count,0)::integer AS item_count,COALESCE(lines.ordered_units,0)::numeric(12,2) AS ordered_units,
          COALESCE(lines.received_units,0)::numeric(12,2) AS received_units,COALESCE(lines.items,'[]'::json) AS items,
          COUNT(*) OVER()::integer AS total_count
          FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id AND s.organization_id=$1
          JOIN warehouses w ON w.id=po.warehouse_id AND w.organization_id=$1
          LEFT JOIN LATERAL (SELECT COUNT(*) AS item_count,SUM(poi.ordered_quantity) AS ordered_units,SUM(poi.received_quantity) AS received_units,
            JSON_AGG(JSON_BUILD_OBJECT('id',poi.id,'item_id',poi.item_id,'sku',i.sku,'name',i.name,'unit',i.unit,'ordered_quantity',poi.ordered_quantity,'received_quantity',poi.received_quantity,'unit_cost',poi.unit_cost) ORDER BY i.name) AS items
            FROM purchase_order_items poi JOIN inventory_items i ON i.id=poi.item_id AND i.organization_id=$1
            WHERE poi.organization_id=$1 AND poi.purchase_order_id=po.id) lines ON true
          WHERE po.organization_id=$1 AND ($2='' OR po.po_number ILIKE '%'||$2||'%' OR s.name ILIKE '%'||$2||'%')
            AND CASE $3 WHEN 'overdue' THEN po.status IN ('approved','partially_received') AND po.expected_at<now() WHEN 'all' THEN true ELSE po.status=$3 END
          ORDER BY CASE WHEN po.status IN ('approved','partially_received') AND po.expected_at<now() THEN 0 ELSE 1 END,po.created_at DESC LIMIT $4 OFFSET $5`,
          [tenantId,query.trim(),status,limit,offset]);
        return rows;
      }
    },

    marketing: {
      async stats() {
        const { rows } = await db.query(`SELECT COUNT(*)::integer AS total,
          COUNT(*) FILTER (WHERE mc.status='draft')::integer AS drafts,
          COUNT(*) FILTER (WHERE mc.status='scheduled')::integer AS scheduled,
          COUNT(*) FILTER (WHERE mc.status='queued')::integer AS queued,
          COALESCE(SUM(recipients.total),0)::integer AS total_recipients,
          COALESCE(SUM(recipients.sent),0)::integer AS sent
          FROM marketing_campaigns mc LEFT JOIN LATERAL (
            SELECT COUNT(*)::integer AS total,COUNT(*) FILTER (WHERE status='sent')::integer AS sent
            FROM campaign_recipients WHERE organization_id=$1 AND campaign_id=mc.id
          ) recipients ON true WHERE mc.organization_id=$1`, [tenantId]);
        return rows[0];
      },
      async segments() {
        const { rows } = await db.query(`SELECT cs.*,COUNT(mc.id)::integer AS campaign_count FROM customer_segments cs
          LEFT JOIN marketing_campaigns mc ON mc.segment_id=cs.id AND mc.organization_id=$1
          WHERE cs.organization_id=$1 AND cs.is_active GROUP BY cs.id ORDER BY cs.created_at DESC`, [tenantId]);
        return rows;
      },
      async campaigns({status='all',limit=20,offset=0}={}) {
        const { rows } = await db.query(`SELECT mc.*,cs.name AS segment_name,cs.segment_type,
          COALESCE(r.total,0)::integer AS recipient_count,COALESCE(r.sent,0)::integer AS sent_count,
          COALESCE(r.failed,0)::integer AS failed_count,COUNT(*) OVER()::integer AS total_count
          FROM marketing_campaigns mc JOIN customer_segments cs ON cs.id=mc.segment_id AND cs.organization_id=$1
          LEFT JOIN LATERAL (SELECT COUNT(*) AS total,COUNT(*) FILTER(WHERE status='sent') AS sent,
            COUNT(*) FILTER(WHERE status='failed') AS failed FROM campaign_recipients WHERE organization_id=$1 AND campaign_id=mc.id) r ON true
          WHERE mc.organization_id=$1 AND ($2='all' OR mc.status=$2) ORDER BY mc.created_at DESC LIMIT $3 OFFSET $4`,
          [tenantId,status,limit,offset]);
        return rows;
      },
      async conversationStats() {
        const { rows } = await db.query(`SELECT COUNT(*) FILTER(WHERE status<>'closed')::integer AS active,
          COUNT(*) FILTER(WHERE status='pending_agent')::integer AS pending_agent,
          COUNT(*) FILTER(WHERE status='waiting_customer')::integer AS waiting_customer,
          COUNT(*) FILTER(WHERE priority IN('high','urgent')AND status<>'closed')::integer AS priority,
          COALESCE(SUM(unread_count),0)::integer AS unread FROM customer_conversations WHERE organization_id=$1`, [tenantId]);
        return rows[0];
      },
      async conversations({status='active',channel='all',query='',limit=20,offset=0}={}) {
        const { rows } = await db.query(`SELECT cc.*,c.name AS customer_name,u.mobile AS assigned_mobile,
          last_message.body AS last_message,last_message.direction AS last_direction,COUNT(*)OVER()::integer AS total_count
          FROM customer_conversations cc LEFT JOIN customers c ON c.id=cc.customer_id AND c.organization_id=$1
          LEFT JOIN users u ON u.id=cc.assigned_to AND u.organization_id=$1
          LEFT JOIN LATERAL(SELECT body,direction FROM conversation_messages WHERE organization_id=$1 AND conversation_id=cc.id ORDER BY sent_at DESC,id DESC LIMIT 1)last_message ON true
          WHERE cc.organization_id=$1 AND CASE $2 WHEN 'active'THEN cc.status<>'closed' WHEN 'all'THEN true ELSE cc.status=$2 END
          AND($3='all'OR cc.channel=$3)AND($4=''OR COALESCE(c.name,'')ILIKE '%'||$4||'%'OR cc.contact_handle ILIKE '%'||$4||'%'OR cc.subject ILIKE '%'||$4||'%')
          ORDER BY CASE cc.priority WHEN 'urgent'THEN 0 WHEN 'high'THEN 1 WHEN 'normal'THEN 2 ELSE 3 END,cc.last_message_at DESC LIMIT $5 OFFSET $6`,
          [tenantId,status,channel,query,limit,offset]);
        return rows;
      },
      async conversationThread(id) {
        const conversation=(await db.query(`SELECT cc.*,c.name AS customer_name,u.mobile AS assigned_mobile
          FROM customer_conversations cc LEFT JOIN customers c ON c.id=cc.customer_id AND c.organization_id=$1
          LEFT JOIN users u ON u.id=cc.assigned_to AND u.organization_id=$1 WHERE cc.organization_id=$1 AND cc.id=$2`,[tenantId,id])).rows[0];
        if(!conversation)return null;
        const messages=(await db.query(`SELECT cm.*,u.mobile AS agent_mobile FROM conversation_messages cm
          LEFT JOIN users u ON u.id=cm.sent_by AND u.organization_id=$1 WHERE cm.organization_id=$1 AND cm.conversation_id=$2 ORDER BY cm.sent_at ASC,cm.id ASC`,[tenantId,id])).rows;
        return {conversation,messages};
      }
    },

    ai: {
      async stats(){const{rows}=await db.query(`SELECT COUNT(*) FILTER(WHERE status='draft')::integer AS pending_review,COUNT(*) FILTER(WHERE status='approved')::integer AS approved,COUNT(*) FILTER(WHERE status='used')::integer AS used,COUNT(*) FILTER(WHERE risk_level='high'AND status='draft')::integer AS high_risk,COALESCE(ROUND(AVG(confidence)*100),0)::integer AS average_confidence FROM ai_suggestions WHERE organization_id=$1`,[tenantId]);return rows[0]},
      async suggestions({status='all',limit=20,offset=0}={}){const{rows}=await db.query(`SELECT ai.*,cc.channel,cc.contact_handle,cc.subject,c.name AS customer_name,COUNT(*)OVER()::integer AS total_count FROM ai_suggestions ai JOIN customer_conversations cc ON cc.id=ai.conversation_id AND cc.organization_id=$1 LEFT JOIN customers c ON c.id=cc.customer_id AND c.organization_id=$1 WHERE ai.organization_id=$1 AND($2='all'OR ai.status=$2)ORDER BY CASE ai.risk_level WHEN 'high'THEN 0 WHEN 'medium'THEN 1 ELSE 2 END,ai.created_at DESC LIMIT $3 OFFSET $4`,[tenantId,status,limit,offset]);return rows},
      async knowledge({status='approved',limit=50,offset=0}={}){const{rows}=await db.query(`SELECT *,COUNT(*)OVER()::integer AS total_count FROM ai_knowledge_articles WHERE organization_id=$1 AND($2='all'OR status=$2)ORDER BY updated_at DESC LIMIT $3 OFFSET $4`,[tenantId,status,limit,offset]);return rows},
      async insightStats(){const{rows}=await db.query(`SELECT COUNT(*) FILTER(WHERE status='open')::integer AS open,COUNT(*) FILTER(WHERE status='open'AND severity IN('critical','high'))::integer AS high_priority,COUNT(*) FILTER(WHERE status='acknowledged')::integer AS acknowledged,COUNT(*) FILTER(WHERE status='resolved'AND resolved_at>=date_trunc('month',now()))::integer AS resolved_this_month FROM ai_insights WHERE organization_id=$1`,[tenantId]);return rows[0]},
      async insights({status='open',domain='all',limit=50,offset=0}={}){const{rows}=await db.query(`SELECT *,COUNT(*)OVER()::integer AS total_count FROM ai_insights WHERE organization_id=$1 AND($2='all'OR status=$2)AND($3='all'OR domain=$3)ORDER BY CASE severity WHEN 'critical'THEN 0 WHEN 'high'THEN 1 WHEN 'medium'THEN 2 ELSE 3 END,created_at DESC LIMIT $4 OFFSET $5`,[tenantId,status,domain,limit,offset]);return rows},
      async latestBrief(){const brief=(await db.query(`SELECT * FROM ai_executive_briefs WHERE organization_id=$1 ORDER BY brief_date DESC LIMIT 1`,[tenantId])).rows[0];return brief||null},
      async dispatchStats(){const{rows}=await db.query(`SELECT COUNT(*) FILTER(WHERE status='pending')::integer AS pending,COUNT(*) FILTER(WHERE status='approved')::integer AS approved,COUNT(*) FILTER(WHERE status='rejected')::integer AS rejected,COUNT(*) FILTER(WHERE risk_level='high'AND status='pending')::integer AS high_risk FROM ai_dispatch_recommendations WHERE organization_id=$1`,[tenantId]);return rows[0]},
      async dispatchQueue({limit=30,offset=0}={}){const{rows}=await db.query(`SELECT j.id,j.status,j.city_id,j.scheduled_at,j.required_skill_code,j.service_duration_minutes,c.name AS customer_name,o.external_order_id,COUNT(*)OVER()::integer AS total_count FROM service_jobs j JOIN orders o ON o.id=j.order_id JOIN customers c ON c.id=o.customer_id WHERE j.organization_id=$1 AND c.organization_id=$1 AND j.status='pending_assignment' ORDER BY j.created_at ASC LIMIT $2 OFFSET $3`,[tenantId,limit,offset]);return rows},
      async dispatchRecommendations({status='all',limit=30,offset=0}={}){const{rows}=await db.query(`SELECT r.*,j.city_id,j.required_skill_code,c.name AS customer_name,o.external_order_id,COUNT(*)OVER()::integer AS total_count FROM ai_dispatch_recommendations r JOIN service_jobs j ON j.id=r.job_id AND j.organization_id=$1 JOIN orders o ON o.id=j.order_id JOIN customers c ON c.id=o.customer_id AND c.organization_id=$1 WHERE r.organization_id=$1 AND($2='all'OR r.status=$2)ORDER BY CASE r.status WHEN 'pending'THEN 0 ELSE 1 END,r.created_at DESC LIMIT $3 OFFSET $4`,[tenantId,status,limit,offset]);return rows},
      async salesStats(){const{rows}=await db.query(`SELECT COUNT(*) FILTER(WHERE status IN('new','approved','contacted'))::integer AS active,COUNT(*) FILTER(WHERE status='new')::integer AS new,COUNT(*) FILTER(WHERE status='contacted')::integer AS contacted,COUNT(*) FILTER(WHERE status='converted'AND updated_at>=date_trunc('month',now()))::integer AS converted_this_month,COALESCE(SUM(estimated_value)FILTER(WHERE status IN('new','approved','contacted')),0)::numeric(14,2)AS pipeline_value FROM ai_sales_opportunities WHERE organization_id=$1`,[tenantId]);return rows[0]},
      async salesOpportunities({status='active',type='all',limit=50,offset=0}={}){const{rows}=await db.query(`SELECT so.*,c.name AS customer_name,u.mobile AS assigned_mobile,COUNT(*)OVER()::integer AS total_count FROM ai_sales_opportunities so JOIN customers c ON c.id=so.customer_id AND c.organization_id=$1 LEFT JOIN users u ON u.id=so.assigned_to AND u.organization_id=$1 WHERE so.organization_id=$1 AND CASE $2 WHEN 'active'THEN so.status IN('new','approved','contacted')WHEN 'all'THEN true ELSE so.status=$2 END AND($3='all'OR so.opportunity_type=$3)ORDER BY so.score DESC,so.estimated_value DESC,so.created_at DESC LIMIT $4 OFFSET $5`,[tenantId,status,type,limit,offset]);return rows},
      async marketingStats(){const{rows}=await db.query(`SELECT COUNT(*) FILTER(WHERE status IN('new','approved','scheduled'))::integer AS active,COUNT(*) FILTER(WHERE status='new')::integer AS new,COUNT(*) FILTER(WHERE status='scheduled')::integer AS scheduled,COUNT(*) FILTER(WHERE status='completed'AND updated_at>=date_trunc('month',now()))::integer AS completed_this_month,COUNT(*) FILTER(WHERE priority='high'AND status IN('new','approved','scheduled'))::integer AS high_priority FROM ai_marketing_recommendations WHERE organization_id=$1`,[tenantId]);return rows[0]},
      async marketingRecommendations({status='active',type='all',limit=50,offset=0}={}){const{rows}=await db.query(`SELECT *,COUNT(*)OVER()::integer AS total_count FROM ai_marketing_recommendations WHERE organization_id=$1 AND CASE $2 WHEN 'active'THEN status IN('new','approved','scheduled')WHEN 'all'THEN true ELSE status=$2 END AND($3='all'OR recommendation_type=$3)ORDER BY CASE priority WHEN 'high'THEN 0 WHEN 'medium'THEN 1 ELSE 2 END,created_at DESC LIMIT $4 OFFSET $5`,[tenantId,status,type,limit,offset]);return rows},
      async financeStats(){const{rows}=await db.query(`SELECT COUNT(*) FILTER(WHERE status IN('open','reviewed'))::integer AS active,COUNT(*) FILTER(WHERE status='open')::integer AS open,COUNT(*) FILTER(WHERE severity IN('critical','high')AND status IN('open','reviewed'))::integer AS high_priority,COUNT(*) FILTER(WHERE status='resolved'AND resolved_at>=date_trunc('month',now()))::integer AS resolved_this_month,COALESCE(SUM(financial_impact)FILTER(WHERE status IN('open','reviewed')),0)::numeric(14,2)AS financial_exposure FROM ai_finance_anomalies WHERE organization_id=$1`,[tenantId]);return rows[0]},
      async financeAnomalies({status='active',type='all',limit=50,offset=0}={}){const{rows}=await db.query(`SELECT *,COUNT(*)OVER()::integer AS total_count FROM ai_finance_anomalies WHERE organization_id=$1 AND CASE $2 WHEN 'active'THEN status IN('open','reviewed')WHEN 'all'THEN true ELSE status=$2 END AND($3='all'OR anomaly_type=$3)ORDER BY CASE severity WHEN 'critical'THEN 0 WHEN 'high'THEN 1 ELSE 2 END,financial_impact DESC,created_at DESC LIMIT $4 OFFSET $5`,[tenantId,status,type,limit,offset]);return rows}
    }
  };
}
