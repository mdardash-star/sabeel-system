export function createRepositories(db) {
  if (!db?.query) throw new Error('Database client with query() is required');

  return {
    technicians: {
      async findActiveByUserId(userId) {
        const { rows } = await db.query(
          `SELECT t.id, t.user_id, t.city_id, t.branch_id
           FROM technicians t
           JOIN users u ON u.id = t.user_id
           WHERE t.user_id = $1 AND t.is_active = true AND u.is_active = true
           LIMIT 1`,
          [userId]
        );
        return rows[0] || null;
      }
    },

    customers: {
      async findByIdentity(source, identityKey) {
        const { rows } = await db.query(
          `SELECT c.* FROM customers c
           JOIN customer_external_identities i ON i.customer_id = c.id
           WHERE i.source = $1 AND i.identity_key = $2 LIMIT 1`,
          [source, identityKey]
        );
        return rows[0] || null;
      }
    },

    jobs: {
      async findById(id) {
        const { rows } = await db.query('SELECT * FROM service_jobs WHERE id = $1 LIMIT 1', [id]);
        return rows[0] || null;
      },
      async listForTechnician(technicianId, from, to) {
        const { rows } = await db.query(
          `SELECT j.id, j.order_id, j.service_location_id, j.city_id, j.technician_id,
                  j.status, j.scheduled_at, j.service_duration_minutes, j.required_skill_code,
                  j.completed_at, j.created_at, j.updated_at,
                  o.external_source, o.external_order_id,
                  l.address_text, l.latitude, l.longitude
           FROM service_jobs j
           JOIN orders o ON o.id = j.order_id
           LEFT JOIN service_locations l ON l.id = j.service_location_id
           WHERE j.technician_id = $1 AND j.scheduled_at >= $2 AND j.scheduled_at < $3
           ORDER BY j.scheduled_at ASC`,
          [technicianId, from, to]
        );
        return rows;
      },
      async findForTechnician(id, technicianId) {
        const { rows } = await db.query(
          `SELECT j.id, j.order_id, j.service_location_id, j.city_id, j.technician_id,
                  j.status, j.scheduled_at, j.service_duration_minutes, j.required_skill_code,
                  j.completed_at, j.created_at, j.updated_at,
                  o.external_source, o.external_order_id,
                  l.address_text, l.latitude, l.longitude
           FROM service_jobs j
           JOIN orders o ON o.id = j.order_id
           LEFT JOIN service_locations l ON l.id = j.service_location_id
           WHERE j.id = $1 AND j.technician_id = $2
           LIMIT 1`,
          [id, technicianId]
        );
        return rows[0] || null;
      },
      async updateStatus(id, status, completedAt = null) {
        const { rows } = await db.query(
          `UPDATE service_jobs SET status = $2, completed_at = COALESCE($3, completed_at), updated_at = now()
           WHERE id = $1 RETURNING *`,
          [id, status, completedAt]
        );
        return rows[0] || null;
      }
    },

    settlements: {
      async findById(id) {
        const { rows } = await db.query('SELECT * FROM technician_settlements WHERE id = $1 LIMIT 1', [id]);
        return rows[0] || null;
      },
      async approve(id, approverUserId) {
        const { rows } = await db.query(
          `UPDATE technician_settlements
           SET status = 'approved', approved_by = $2, approved_at = now()
           WHERE id = $1 AND status = 'pending_approval'
           RETURNING *`,
          [id, approverUserId]
        );
        return rows[0] || null;
      }
    },

    wallet: {
      async addSettlementCredit({ technicianId, settlementId, amount }) {
        const key = `settlement:${settlementId}`;
        const { rows } = await db.query(
          `INSERT INTO wallet_entries (technician_id, settlement_id, entry_type, amount, idempotency_key)
           VALUES ($1, $2, 'credit', $3, $4)
           ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
           RETURNING *`,
          [technicianId, settlementId, amount, key]
        );
        return rows[0];
      },
      async balance(technicianId) {
        const { rows } = await db.query(
          `SELECT COALESCE(SUM(CASE WHEN entry_type='credit' THEN amount ELSE -amount END), 0)::numeric AS balance
           FROM wallet_entries WHERE technician_id = $1 AND status <> 'void'`,
          [technicianId]
        );
        return Number(rows[0].balance);
      }
    },

    assets: {
      async dueBefore(at) {
        const { rows } = await db.query(
          `SELECT * FROM installed_assets
           WHERE status = 'active' AND next_maintenance_at <= $1
           ORDER BY next_maintenance_at ASC`,
          [at]
        );
        return rows;
      }
    }
  };
}
