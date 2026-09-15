export async function withTransaction(db, work) {
  if (!db?.connect) throw new Error('Database pool with connect() is required');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function approveSettlementAndCreditWallet(db, { settlementId, approverUserId }) {
  return withTransaction(db, async (client) => {
    const locked = await client.query(
      `SELECT * FROM technician_settlements WHERE id = $1 FOR UPDATE`,
      [settlementId]
    );
    const settlement = locked.rows[0];
    if (!settlement) throw new Error('Settlement not found');
    if (settlement.status !== 'pending_approval' && settlement.status !== 'approved') {
      throw new Error('Settlement is not approvable');
    }

    let approved = settlement;
    if (settlement.status === 'pending_approval') {
      const result = await client.query(
        `UPDATE technician_settlements
         SET status = 'approved', approved_by = $2, approved_at = now()
         WHERE id = $1 RETURNING *`,
        [settlementId, approverUserId]
      );
      approved = result.rows[0];
    }

    const wallet = await client.query(
      `INSERT INTO wallet_entries (technician_id, settlement_id, entry_type, amount, idempotency_key)
       VALUES ($1, $2, 'credit', $3, $4)
       ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
       RETURNING *`,
      [approved.technician_id, approved.id, approved.payout_amount, `settlement:${approved.id}`]
    );

    await client.query(
      `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, data)
       VALUES ($1, 'settlement.approved', 'technician_settlement', $2, $3::jsonb)`,
      [approverUserId, approved.id, JSON.stringify({ technicianId: approved.technician_id, payoutAmount: approved.payout_amount })]
    );

    return { settlement: approved, walletEntry: wallet.rows[0] };
  });
}
