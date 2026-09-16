import { withTransaction } from '../persistence/transactions.mjs';

export async function createSupplier(db, input) {
  return withTransaction(db, async client => {
    const result = await client.query(
      `INSERT INTO suppliers (name, contact_name, mobile, email, vat_number)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, contact_name, mobile, email, vat_number, is_active, created_at`,
      [input.name, input.contactName || null, input.mobile || null, input.email || null, input.vatNumber || null]
    );
    const supplier = result.rows[0];
    await writeAudit(client, input.actorUserId, 'supplier.created', 'supplier', supplier.id, { name: supplier.name });
    return supplier;
  });
}

export async function createPurchaseOrder(db, input) {
  return withTransaction(db, async client => {
    const eligible = await client.query(
      `SELECT s.id AS supplier_id, w.id AS warehouse_id FROM suppliers s CROSS JOIN warehouses w
       WHERE s.id = $1 AND s.is_active = true AND w.id = $2 AND w.is_active = true`,
      [input.supplierId, input.warehouseId]
    );
    if (!eligible.rows[0]) throw new Error('Supplier or warehouse not found');
    const itemIds = input.items.map(item => item.itemId);
    const itemRows = await client.query('SELECT id FROM inventory_items WHERE id = ANY($1::uuid[]) AND is_active = true', [itemIds]);
    if (itemRows.rows.length !== itemIds.length) throw new Error('Purchase order item not found');
    const subtotal = input.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
    const orderResult = await client.query(
      `INSERT INTO purchase_orders (po_number, supplier_id, warehouse_id, expected_at, notes, subtotal, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [input.poNumber, input.supplierId, input.warehouseId, input.expectedAt || null, input.notes, subtotal, input.actorUserId]
    );
    const order = orderResult.rows[0];
    const items = [];
    for (const line of input.items) {
      const saved = await client.query(
        `INSERT INTO purchase_order_items (purchase_order_id, item_id, ordered_quantity, unit_cost)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [order.id, line.itemId, line.quantity, line.unitCost]
      );
      items.push(saved.rows[0]);
    }
    await writeAudit(client, input.actorUserId, 'purchase_order.created', 'purchase_order', order.id, { poNumber: input.poNumber, subtotal, itemCount: items.length });
    return { order, items };
  });
}

export async function approvePurchaseOrder(db, { purchaseOrderId, actorUserId }) {
  return withTransaction(db, async client => {
    const current = (await client.query('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [purchaseOrderId])).rows[0];
    if (!current) return null;
    if (current.status !== 'draft') throw new Error('Purchase order is not approvable');
    const order = (await client.query(
      `UPDATE purchase_orders SET status = 'approved', approved_by = $2, approved_at = now(), updated_at = now()
       WHERE id = $1 RETURNING *`, [purchaseOrderId, actorUserId]
    )).rows[0];
    await writeAudit(client, actorUserId, 'purchase_order.approved', 'purchase_order', purchaseOrderId, { poNumber: order.po_number, subtotal: order.subtotal });
    return order;
  });
}

export async function receivePurchaseOrder(db, { purchaseOrderId, lines, actorUserId, notes = '' }) {
  return withTransaction(db, async client => {
    const order = (await client.query('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [purchaseOrderId])).rows[0];
    if (!order) return null;
    if (!['approved', 'partially_received'].includes(order.status)) throw new Error('Purchase order is not receivable');
    const currentItems = (await client.query(
      `SELECT id, item_id, ordered_quantity, received_quantity, unit_cost
       FROM purchase_order_items WHERE purchase_order_id = $1 FOR UPDATE`, [purchaseOrderId]
    )).rows;
    const byId = new Map(currentItems.map(item => [item.id, item]));
    const seen = new Set();
    for (const line of lines) {
      const current = byId.get(line.purchaseOrderItemId);
      if (!current || seen.has(line.purchaseOrderItemId)) throw new Error('Invalid purchase order receipt line');
      seen.add(line.purchaseOrderItemId);
      if (Number(current.received_quantity) + line.quantity > Number(current.ordered_quantity)) throw new Error('Purchase order over-receipt is not allowed');
    }
    for (const line of lines) {
      const current = byId.get(line.purchaseOrderItemId);
      const nextReceived = Number(current.received_quantity) + line.quantity;
      current.received_quantity = nextReceived;
      await client.query('UPDATE purchase_order_items SET received_quantity = $2 WHERE id = $1', [current.id, nextReceived]);
      await client.query(
        `INSERT INTO inventory_balances (warehouse_id, item_id, quantity) VALUES ($1, $2, $3)
         ON CONFLICT (warehouse_id, item_id) DO UPDATE SET quantity = inventory_balances.quantity + EXCLUDED.quantity, updated_at = now()`,
        [order.warehouse_id, current.item_id, line.quantity]
      );
      await client.query('UPDATE inventory_items SET unit_cost = $2, updated_at = now() WHERE id = $1', [current.item_id, current.unit_cost]);
      await client.query(
        `INSERT INTO inventory_movements (movement_type, item_id, quantity, unit_cost, to_warehouse_id, reference, notes, created_by)
         VALUES ('receipt', $1, $2, $3, $4, $5, $6, $7)`,
        [current.item_id, line.quantity, current.unit_cost, order.warehouse_id, order.po_number, notes, actorUserId]
      );
    }
    const status = currentItems.every(item => Number(item.received_quantity) >= Number(item.ordered_quantity)) ? 'received' : 'partially_received';
    const updated = (await client.query('UPDATE purchase_orders SET status = $2, updated_at = now() WHERE id = $1 RETURNING *', [purchaseOrderId, status])).rows[0];
    await writeAudit(client, actorUserId, 'purchase_order.received', 'purchase_order', purchaseOrderId, { poNumber: order.po_number, status, lines });
    return updated;
  });
}

async function writeAudit(client, actorUserId, action, entityType, entityId, data) {
  await client.query(
    `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, data)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [actorUserId, action, entityType, entityId, JSON.stringify(data)]
  );
}
