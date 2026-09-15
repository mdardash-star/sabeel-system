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
      async list({ query = '', limit = 20, offset = 0 } = {}) {
        const search = query.trim();
        const { rows } = await db.query(
          `SELECT c.id, c.name, u.mobile, location.city_id, location.address_text,
                  COUNT(DISTINCT o.id)::integer AS order_count, MAX(o.created_at) AS last_order_at,
                  COUNT(*) OVER()::integer AS total_count
           FROM customers c
           LEFT JOIN users u ON u.id = c.user_id
           LEFT JOIN LATERAL (
             SELECT city_id, address_text FROM service_locations
             WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 1
           ) location ON true
           LEFT JOIN orders o ON o.customer_id = c.id
           WHERE ($1 = '' OR c.name ILIKE '%' || $1 || '%' OR u.mobile LIKE '%' || $1 || '%')
           GROUP BY c.id, u.mobile, location.city_id, location.address_text
           ORDER BY c.created_at DESC, c.id DESC LIMIT $2 OFFSET $3`,
          [search, limit, offset]
        );
        return rows;
      },
      async findDetails(id) {
        const { rows } = await db.query(
          `SELECT c.id, c.name, c.created_at, u.mobile,
                  COALESCE((SELECT json_agg(l ORDER BY l.created_at DESC) FROM service_locations l WHERE l.customer_id = c.id), '[]') AS addresses,
                  COALESCE((SELECT json_agg(a ORDER BY a.created_at DESC) FROM installed_assets a WHERE a.customer_id = c.id), '[]') AS assets,
                  COALESCE((SELECT json_agg(o ORDER BY o.created_at DESC) FROM orders o WHERE o.customer_id = c.id), '[]') AS orders
           FROM customers c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = $1 LIMIT 1`,
          [id]
        );
        return rows[0] || null;
      },
      async create({ name, mobile, cityId, addressText }) {
        if (!db.connect) throw new Error('Database transaction support is required');
        const client = await db.connect();
        try {
          await client.query('BEGIN');
          const userResult = await client.query(
            `INSERT INTO users (mobile, role) VALUES ($1, 'customer')
             ON CONFLICT (mobile) DO NOTHING RETURNING id`, [mobile]
          );
          if (!userResult.rows[0]) throw new Error('Customer mobile already exists');
          const customerResult = await client.query(
            'INSERT INTO customers (user_id, name) VALUES ($1, $2) RETURNING id, name, created_at',
            [userResult.rows[0].id, name]
          );
          const customer = customerResult.rows[0];
          if (cityId || addressText) {
            await client.query(
              'INSERT INTO service_locations (customer_id, city_id, address_text) VALUES ($1, $2, $3)',
              [customer.id, cityId || 'riyadh', addressText || '']
            );
          }
          await client.query('COMMIT');
          return { ...customer, mobile };
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally { client.release(); }
      },
      async update(id, { name, mobile }) {
        if (!db.connect) throw new Error('Database transaction support is required');
        const client = await db.connect();
        try {
          await client.query('BEGIN');
          const current = await client.query(
            `SELECT c.id, c.user_id, c.name, u.mobile FROM customers c
             LEFT JOIN users u ON u.id = c.user_id WHERE c.id = $1 FOR UPDATE OF c`, [id]
          );
          if (!current.rows[0]) { await client.query('ROLLBACK'); return null; }
          const customer = current.rows[0];
          if (mobile && customer.user_id) {
            await client.query('UPDATE users SET mobile = $2, updated_at = now() WHERE id = $1', [customer.user_id, mobile]);
          }
          const updated = await client.query(
            'UPDATE customers SET name = COALESCE($2, name), updated_at = now() WHERE id = $1 RETURNING id, name, created_at, updated_at',
            [id, name || null]
          );
          await client.query('COMMIT');
          return { ...updated.rows[0], mobile: mobile || customer.mobile };
        } catch (error) {
          await client.query('ROLLBACK');
          if (error.code === '23505') throw new Error('Customer mobile already exists');
          throw error;
        } finally { client.release(); }
      },
      async addAddress(customerId, { cityId, addressText }) {
        const { rows } = await db.query(
          `INSERT INTO service_locations (customer_id, city_id, address_text)
           SELECT id, $2, $3 FROM customers WHERE id = $1
           RETURNING id, customer_id, city_id, address_text, created_at`,
          [customerId, cityId, addressText]
        );
        return rows[0] || null;
      },
      async timeline(customerId, limit = 50) {
        const { rows } = await db.query(
          `SELECT * FROM (
             SELECT 'order' AS type, o.id::text, o.external_order_id AS reference,
                    CASE WHEN o.paid_at IS NULL THEN 'created' ELSE 'paid' END AS status, o.created_at AS occurred_at
             FROM orders o WHERE o.customer_id = $1
             UNION ALL
             SELECT 'job', j.id::text, j.id::text, j.status, j.created_at
             FROM service_jobs j WHERE j.customer_id = $1
             UNION ALL
             SELECT 'notification', n.id::text, n.event_type, n.status, n.created_at
             FROM notification_events n WHERE n.customer_id = $1
           ) events ORDER BY occurred_at DESC LIMIT $2`,
          [customerId, limit]
        );
        return rows;
      },
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
      },
      async listForTechnician(technicianId, { limit = 20, offset = 0 } = {}) {
        const { rows } = await db.query(
          `SELECT id, settlement_id, entry_type, amount, currency, status, created_at,
                  COUNT(*) OVER()::integer AS total_count
           FROM wallet_entries
           WHERE technician_id = $1
           ORDER BY created_at DESC, id DESC
           LIMIT $2 OFFSET $3`,
          [technicianId, limit, offset]
        );
        return rows;
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
