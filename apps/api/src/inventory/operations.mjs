import { withTransaction } from '../persistence/transactions.mjs';

const DEFAULT_ORG = '00000000-0000-4000-8000-000000000001';

async function resolveOrganizationId(client, actorUserId) {
  if (!actorUserId) return DEFAULT_ORG;
  const { rows } = await client.query(
    'SELECT organization_id FROM users WHERE id = $1 AND is_active = true LIMIT 1',
    [actorUserId]
  );
  if (!rows[0]?.organization_id) throw new Error('Active user organization not found');
  return rows[0].organization_id;
}

export async function createInventoryItem(db, { sku, name, unit, reorderLevel, unitCost, actorUserId }) {
  return withTransaction(db, async client => {
    const organizationId = await resolveOrganizationId(client, actorUserId);
    const inserted = await client.query(
      `INSERT INTO inventory_items (organization_id, sku, name, unit, reorder_level, unit_cost)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, organization_id, sku, name, unit, reorder_level, unit_cost, is_active, created_at`,
      [organizationId, sku, name, unit, reorderLevel, unitCost]
    );
    const item = inserted.rows[0];
    await client.query(
      `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, data)
       VALUES ($1, 'inventory.item_created', 'inventory_item', $2, $3::jsonb)`,
      [actorUserId, item.id, JSON.stringify({ organizationId, sku, name, unit, reorderLevel, unitCost })]
    );
    return item;
  });
}

export async function receiveInventory(db, { warehouseId, itemId, quantity, unitCost, reference, notes, actorUserId }) {
  return withTransaction(db, async client => {
    const organizationId = await resolveOrganizationId(client, actorUserId);
    const eligible = await client.query(
      `SELECT i.id, i.sku, w.id AS warehouse_id
       FROM inventory_items i CROSS JOIN warehouses w
       WHERE i.id = $1 AND i.organization_id = $3 AND i.is_active = true
         AND w.id = $2 AND w.organization_id = $3 AND w.is_active = true
       FOR UPDATE OF i, w`,
      [itemId, warehouseId, organizationId]
    );
    if (!eligible.rows[0]) throw new Error('Inventory item or warehouse not found');
    const balance = await client.query(
      `INSERT INTO inventory_balances (organization_id, warehouse_id, item_id, quantity)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (warehouse_id, item_id) DO UPDATE
       SET quantity = inventory_balances.quantity + EXCLUDED.quantity, updated_at = now()
       WHERE inventory_balances.organization_id = EXCLUDED.organization_id
       RETURNING organization_id, warehouse_id, item_id, quantity, updated_at`,
      [organizationId, warehouseId, itemId, quantity]
    );
    if (!balance.rows[0]) throw new Error('Inventory balance tenant mismatch');
    if (unitCost !== null) {
      await client.query(
        'UPDATE inventory_items SET unit_cost = $2, updated_at = now() WHERE id = $1 AND organization_id = $3',
        [itemId, unitCost, organizationId]
      );
    }
    const movement = await client.query(
      `INSERT INTO inventory_movements (organization_id, movement_type, item_id, quantity, unit_cost, to_warehouse_id, reference, notes, created_by)
       VALUES ($1, 'receipt', $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [organizationId, itemId, quantity, unitCost, warehouseId, reference, notes, actorUserId]
    );
    await audit(client, actorUserId, 'inventory.received', movement.rows[0].id, { organizationId, warehouseId, itemId, quantity, reference });
    return { balance: balance.rows[0], movement: movement.rows[0] };
  });
}

export async function transferInventory(db, { fromWarehouseId, toWarehouseId, itemId, quantity, reference, notes, actorUserId }) {
  if (fromWarehouseId === toWarehouseId) throw new Error('Warehouses must be different');
  return withTransaction(db, async client => {
    const organizationId = await resolveOrganizationId(client, actorUserId);
    const destination = await client.query(
      'SELECT id FROM warehouses WHERE id = $1 AND organization_id = $2 AND is_active = true',
      [toWarehouseId, organizationId]
    );
    if (!destination.rows[0]) throw new Error('Destination warehouse not found');
    const source = await client.query(
      `SELECT warehouse_id, item_id, quantity FROM inventory_balances
       WHERE warehouse_id = $1 AND item_id = $2 AND organization_id = $3 FOR UPDATE`,
      [fromWarehouseId, itemId, organizationId]
    );
    if (!source.rows[0]) throw new Error('Inventory balance not found');
    if (Number(source.rows[0].quantity) < quantity) throw new Error('Insufficient inventory balance');
    await client.query(
      'UPDATE inventory_balances SET quantity = quantity - $3, updated_at = now() WHERE warehouse_id = $1 AND item_id = $2 AND organization_id = $4',
      [fromWarehouseId, itemId, quantity, organizationId]
    );
    const target = await client.query(
      `INSERT INTO inventory_balances (organization_id, warehouse_id, item_id, quantity) VALUES ($1, $2, $3, $4)
       ON CONFLICT (warehouse_id, item_id) DO UPDATE
       SET quantity = inventory_balances.quantity + EXCLUDED.quantity, updated_at = now()
       WHERE inventory_balances.organization_id = EXCLUDED.organization_id
       RETURNING organization_id, warehouse_id, item_id, quantity, updated_at`,
      [organizationId, toWarehouseId, itemId, quantity]
    );
    if (!target.rows[0]) throw new Error('Inventory balance tenant mismatch');
    const movement = await client.query(
      `INSERT INTO inventory_movements (organization_id, movement_type, item_id, quantity, from_warehouse_id, to_warehouse_id, reference, notes, created_by)
       VALUES ($1, 'transfer', $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [organizationId, itemId, quantity, fromWarehouseId, toWarehouseId, reference, notes, actorUserId]
    );
    await audit(client, actorUserId, 'inventory.transferred', movement.rows[0].id, { organizationId, fromWarehouseId, toWarehouseId, itemId, quantity, reference });
    return { destinationBalance: target.rows[0], movement: movement.rows[0] };
  });
}

export async function issueInventoryToTechnician(db, { warehouseId, technicianId, itemId, quantity, reference, notes, actorUserId }) {
  return withTransaction(db, async client => {
    const organizationId = await resolveOrganizationId(client, actorUserId);
    const technician = await client.query(
      `SELECT t.id FROM technicians t JOIN users u ON u.id = t.user_id
       WHERE t.id = $1 AND t.is_active = true AND u.is_active = true AND u.organization_id = $2`,
      [technicianId, organizationId]
    );
    if (!technician.rows[0]) throw new Error('Active technician not found');
    const source = await client.query(
      `SELECT warehouse_id, item_id, quantity FROM inventory_balances
       WHERE warehouse_id = $1 AND item_id = $2 AND organization_id = $3 FOR UPDATE`,
      [warehouseId, itemId, organizationId]
    );
    if (!source.rows[0]) throw new Error('Inventory balance not found');
    if (Number(source.rows[0].quantity) < quantity) throw new Error('Insufficient inventory balance');
    await client.query(
      'UPDATE inventory_balances SET quantity = quantity - $3, updated_at = now() WHERE warehouse_id = $1 AND item_id = $2 AND organization_id = $4',
      [warehouseId, itemId, quantity, organizationId]
    );
    const technicianBalance = await client.query(
      `INSERT INTO technician_inventory (organization_id, technician_id, item_id, quantity) VALUES ($1, $2, $3, $4)
       ON CONFLICT (technician_id, item_id) DO UPDATE
       SET quantity = technician_inventory.quantity + EXCLUDED.quantity, updated_at = now()
       WHERE technician_inventory.organization_id = EXCLUDED.organization_id
       RETURNING organization_id, technician_id, item_id, quantity, updated_at`,
      [organizationId, technicianId, itemId, quantity]
    );
    if (!technicianBalance.rows[0]) throw new Error('Technician inventory tenant mismatch');
    const movement = await client.query(
      `INSERT INTO inventory_movements (organization_id, movement_type, item_id, quantity, from_warehouse_id, technician_id, reference, notes, created_by)
       VALUES ($1, 'technician_issue', $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [organizationId, itemId, quantity, warehouseId, technicianId, reference, notes, actorUserId]
    );
    await audit(client, actorUserId, 'inventory.issued_to_technician', movement.rows[0].id, { organizationId, warehouseId, technicianId, itemId, quantity, reference });
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
