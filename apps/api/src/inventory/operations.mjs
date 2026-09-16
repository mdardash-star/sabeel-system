import { withTransaction } from '../persistence/transactions.mjs';

export async function createInventoryItem(db, { sku, name, unit, reorderLevel, unitCost, actorUserId }) {
  return withTransaction(db, async client => {
    const inserted = await client.query(
      `INSERT INTO inventory_items (sku, name, unit, reorder_level, unit_cost)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, sku, name, unit, reorder_level, unit_cost, is_active, created_at`,
      [sku, name, unit, reorderLevel, unitCost]
    );
    const item = inserted.rows[0];
    await client.query(
      `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, data)
       VALUES ($1, 'inventory.item_created', 'inventory_item', $2, $3::jsonb)`,
      [actorUserId, item.id, JSON.stringify({ sku, name, unit, reorderLevel, unitCost })]
    );
    return item;
  });
}

export async function receiveInventory(db, { warehouseId, itemId, quantity, unitCost, reference, notes, actorUserId }) {
  return withTransaction(db, async client => {
    const eligible = await client.query(
      `SELECT i.id, i.sku, w.id AS warehouse_id FROM inventory_items i CROSS JOIN warehouses w
       WHERE i.id = $1 AND i.is_active = true AND w.id = $2 AND w.is_active = true FOR UPDATE OF i, w`,
      [itemId, warehouseId]
    );
    if (!eligible.rows[0]) throw new Error('Inventory item or warehouse not found');
    const balance = await client.query(
      `INSERT INTO inventory_balances (warehouse_id, item_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (warehouse_id, item_id) DO UPDATE
       SET quantity = inventory_balances.quantity + EXCLUDED.quantity, updated_at = now()
       RETURNING warehouse_id, item_id, quantity, updated_at`,
      [warehouseId, itemId, quantity]
    );
    if (unitCost !== null) await client.query('UPDATE inventory_items SET unit_cost = $2, updated_at = now() WHERE id = $1', [itemId, unitCost]);
    const movement = await client.query(
      `INSERT INTO inventory_movements (movement_type, item_id, quantity, unit_cost, to_warehouse_id, reference, notes, created_by)
       VALUES ('receipt', $1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [itemId, quantity, unitCost, warehouseId, reference, notes, actorUserId]
    );
    await audit(client, actorUserId, 'inventory.received', movement.rows[0].id, { warehouseId, itemId, quantity, reference });
    return { balance: balance.rows[0], movement: movement.rows[0] };
  });
}

export async function transferInventory(db, { fromWarehouseId, toWarehouseId, itemId, quantity, reference, notes, actorUserId }) {
  if (fromWarehouseId === toWarehouseId) throw new Error('Warehouses must be different');
  return withTransaction(db, async client => {
    const destination = await client.query('SELECT id FROM warehouses WHERE id = $1 AND is_active = true', [toWarehouseId]);
    if (!destination.rows[0]) throw new Error('Destination warehouse not found');
    const source = await client.query(
      `SELECT warehouse_id, item_id, quantity FROM inventory_balances
       WHERE warehouse_id = $1 AND item_id = $2 FOR UPDATE`, [fromWarehouseId, itemId]
    );
    if (!source.rows[0]) throw new Error('Inventory balance not found');
    if (Number(source.rows[0].quantity) < quantity) throw new Error('Insufficient inventory balance');
    await client.query('UPDATE inventory_balances SET quantity = quantity - $3, updated_at = now() WHERE warehouse_id = $1 AND item_id = $2', [fromWarehouseId, itemId, quantity]);
    const target = await client.query(
      `INSERT INTO inventory_balances (warehouse_id, item_id, quantity) VALUES ($1, $2, $3)
       ON CONFLICT (warehouse_id, item_id) DO UPDATE SET quantity = inventory_balances.quantity + EXCLUDED.quantity, updated_at = now()
       RETURNING warehouse_id, item_id, quantity, updated_at`, [toWarehouseId, itemId, quantity]
    );
    const movement = await client.query(
      `INSERT INTO inventory_movements (movement_type, item_id, quantity, from_warehouse_id, to_warehouse_id, reference, notes, created_by)
       VALUES ('transfer', $1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [itemId, quantity, fromWarehouseId, toWarehouseId, reference, notes, actorUserId]
    );
    await audit(client, actorUserId, 'inventory.transferred', movement.rows[0].id, { fromWarehouseId, toWarehouseId, itemId, quantity, reference });
    return { destinationBalance: target.rows[0], movement: movement.rows[0] };
  });
}

export async function issueInventoryToTechnician(db, { warehouseId, technicianId, itemId, quantity, reference, notes, actorUserId }) {
  return withTransaction(db, async client => {
    const technician = await client.query('SELECT id FROM technicians WHERE id = $1 AND is_active = true', [technicianId]);
    if (!technician.rows[0]) throw new Error('Active technician not found');
    const source = await client.query(
      `SELECT warehouse_id, item_id, quantity FROM inventory_balances
       WHERE warehouse_id = $1 AND item_id = $2 FOR UPDATE`, [warehouseId, itemId]
    );
    if (!source.rows[0]) throw new Error('Inventory balance not found');
    if (Number(source.rows[0].quantity) < quantity) throw new Error('Insufficient inventory balance');
    await client.query('UPDATE inventory_balances SET quantity = quantity - $3, updated_at = now() WHERE warehouse_id = $1 AND item_id = $2', [warehouseId, itemId, quantity]);
    const technicianBalance = await client.query(
      `INSERT INTO technician_inventory (technician_id, item_id, quantity) VALUES ($1, $2, $3)
       ON CONFLICT (technician_id, item_id) DO UPDATE SET quantity = technician_inventory.quantity + EXCLUDED.quantity, updated_at = now()
       RETURNING technician_id, item_id, quantity, updated_at`, [technicianId, itemId, quantity]
    );
    const movement = await client.query(
      `INSERT INTO inventory_movements (movement_type, item_id, quantity, from_warehouse_id, technician_id, reference, notes, created_by)
       VALUES ('technician_issue', $1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [itemId, quantity, warehouseId, technicianId, reference, notes, actorUserId]
    );
    await audit(client, actorUserId, 'inventory.issued_to_technician', movement.rows[0].id, { warehouseId, technicianId, itemId, quantity, reference });
    return { technicianBalance: technicianBalance.rows[0], movement: movement.rows[0] };
  });
}

async function audit(client, actorUserId, action, entityId, data) {
  await client.query(
    `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, data)
     VALUES ($1, $2, 'inventory_movement', $3, $4::jsonb)`,
    [actorUserId, action, entityId, JSON.stringify(data)]
  );
}
