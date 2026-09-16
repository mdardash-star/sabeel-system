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
    }
  };
}
