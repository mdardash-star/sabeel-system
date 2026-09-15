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
      },
      async operationsStats() {
        const { rows } = await db.query(
          `SELECT COUNT(*)::integer AS total,
                  COUNT(*) FILTER (WHERE t.is_active AND u.is_active)::integer AS active,
                  COUNT(*) FILTER (WHERE NOT t.is_active OR NOT u.is_active)::integer AS inactive,
                  COUNT(*) FILTER (WHERE t.is_active AND u.is_active AND EXISTS (
                    SELECT 1 FROM technician_availability a
                    WHERE a.technician_id = t.id AND a.available_from <= now() AND a.available_to >= now()
                  ) AND NOT EXISTS (
                    SELECT 1 FROM service_jobs j WHERE j.technician_id = t.id
                    AND j.status IN ('en_route','arrived','in_progress')
                  ))::integer AS available_now,
                  COUNT(*) FILTER (WHERE EXISTS (
                    SELECT 1 FROM service_jobs j WHERE j.technician_id = t.id
                    AND j.status IN ('en_route','arrived','in_progress')
                  ))::integer AS busy_now,
                  COALESCE((SELECT AVG(score) FROM service_ratings WHERE verified_service = true), 0)::numeric(3,2) AS avg_rating
           FROM technicians t JOIN users u ON u.id = t.user_id`
        );
        return rows[0] || { total: 0, active: 0, inactive: 0, available_now: 0, busy_now: 0, avg_rating: 0 };
      },
      async listForOperations({ query = '', status = 'all', limit = 20, offset = 0 } = {}) {
        const { rows } = await db.query(
          `SELECT t.id, t.user_id, u.mobile, t.city_id, t.branch_id, t.compensation_policy_id,
                  t.is_active, t.created_at,
                  COALESCE(skills.values, ARRAY[]::text[]) AS skills,
                  COALESCE(metrics.jobs_today, 0)::integer AS jobs_today,
                  COALESCE(metrics.active_jobs, 0)::integer AS active_jobs,
                  COALESCE(metrics.completed_30d, 0)::integer AS completed_30d,
                  COALESCE(metrics.on_time_30d, 0)::integer AS on_time_30d,
                  COALESCE(ratings.avg_rating, 0)::numeric(3,2) AS avg_rating,
                  COALESCE(ratings.rating_count, 0)::integer AS rating_count,
                  COUNT(*) OVER()::integer AS total_count
           FROM technicians t
           JOIN users u ON u.id = t.user_id
           LEFT JOIN LATERAL (
             SELECT ARRAY_AGG(skill_code ORDER BY skill_code) AS values
             FROM technician_skills WHERE technician_id = t.id
           ) skills ON true
           LEFT JOIN LATERAL (
             SELECT COUNT(*) FILTER (WHERE scheduled_at >= date_trunc('day', now()) AND scheduled_at < date_trunc('day', now()) + interval '1 day') AS jobs_today,
                    COUNT(*) FILTER (WHERE status IN ('scheduled','en_route','arrived','in_progress')) AS active_jobs,
                    COUNT(*) FILTER (WHERE status = 'completed' AND completed_at >= now() - interval '30 days') AS completed_30d,
                    COUNT(*) FILTER (WHERE status = 'completed' AND completed_at >= now() - interval '30 days'
                      AND completed_at <= scheduled_at + service_duration_minutes * interval '1 minute') AS on_time_30d
             FROM service_jobs WHERE technician_id = t.id
           ) metrics ON true
           LEFT JOIN LATERAL (
             SELECT AVG(score) FILTER (WHERE verified_service = true) AS avg_rating,
                    COUNT(*) FILTER (WHERE verified_service = true) AS rating_count
             FROM service_ratings WHERE technician_id = t.id
           ) ratings ON true
           WHERE ($1 = '' OR u.mobile LIKE '%' || $1 || '%' OR t.id::text ILIKE '%' || $1 || '%'
                  OR t.city_id ILIKE '%' || $1 || '%' OR COALESCE(t.branch_id, '') ILIKE '%' || $1 || '%')
             AND CASE $2 WHEN 'active' THEN t.is_active AND u.is_active
                         WHEN 'inactive' THEN NOT t.is_active OR NOT u.is_active ELSE true END
           ORDER BY t.is_active DESC, metrics.active_jobs DESC, metrics.completed_30d DESC, t.created_at DESC
           LIMIT $3 OFFSET $4`,
          [query.trim(), status, limit, offset]
        );
        return rows;
      },
      async performance(id, from, to) {
        const { rows } = await db.query(
          `SELECT t.id, t.user_id, u.mobile, t.city_id, t.branch_id, t.compensation_policy_id, t.is_active,
                  COALESCE(j.assigned, 0)::integer AS assigned,
                  COALESCE(j.completed, 0)::integer AS completed,
                  COALESCE(j.cancelled, 0)::integer AS cancelled,
                  COALESCE(j.active, 0)::integer AS active,
                  COALESCE(j.on_time, 0)::integer AS on_time,
                  COALESCE(j.avg_completion_minutes, 0)::numeric(10,1) AS avg_completion_minutes,
                  COALESCE(r.avg_rating, 0)::numeric(3,2) AS avg_rating,
                  COALESCE(r.rating_count, 0)::integer AS rating_count,
                  COALESCE(s.total_payout, 0)::numeric(12,2) AS total_payout,
                  COALESCE(s.pending_payout, 0)::numeric(12,2) AS pending_payout
           FROM technicians t JOIN users u ON u.id = t.user_id
           LEFT JOIN LATERAL (
             SELECT COUNT(*) AS assigned,
                    COUNT(*) FILTER (WHERE status = 'completed') AS completed,
                    COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
                    COUNT(*) FILTER (WHERE status IN ('scheduled','en_route','arrived','in_progress')) AS active,
                    COUNT(*) FILTER (WHERE status = 'completed' AND completed_at <= scheduled_at + service_duration_minutes * interval '1 minute') AS on_time,
                    AVG(EXTRACT(EPOCH FROM (completed_at - scheduled_at)) / 60) FILTER (WHERE status = 'completed') AS avg_completion_minutes
             FROM service_jobs WHERE technician_id = t.id AND created_at >= $2 AND created_at < $3
           ) j ON true
           LEFT JOIN LATERAL (
             SELECT AVG(score) FILTER (WHERE verified_service = true) AS avg_rating,
                    COUNT(*) FILTER (WHERE verified_service = true) AS rating_count
             FROM service_ratings WHERE technician_id = t.id AND created_at >= $2 AND created_at < $3
           ) r ON true
           LEFT JOIN LATERAL (
             SELECT SUM(payout_amount) FILTER (WHERE status IN ('approved','paid')) AS total_payout,
                    SUM(payout_amount) FILTER (WHERE status = 'pending_approval') AS pending_payout
             FROM technician_settlements WHERE technician_id = t.id AND created_at >= $2 AND created_at < $3
           ) s ON true
           WHERE t.id = $1 LIMIT 1`,
          [id, from, to]
        );
        return rows[0] || null;
      },
      async recentJobs(id, from, to, limit = 10) {
        const { rows } = await db.query(
          `SELECT j.id, j.status, j.scheduled_at, j.completed_at, j.service_duration_minutes,
                  o.external_order_id, c.name AS customer_name, l.address_text
           FROM service_jobs j
           JOIN orders o ON o.id = j.order_id
           JOIN customers c ON c.id = j.customer_id
           LEFT JOIN service_locations l ON l.id = j.service_location_id
           WHERE j.technician_id = $1 AND j.created_at >= $2 AND j.created_at < $3
           ORDER BY COALESCE(j.completed_at, j.scheduled_at, j.created_at) DESC LIMIT $4`,
          [id, from, to, limit]
        );
        return rows;
      }
    },

    customers: {
      async stats() {
        const { rows } = await db.query(
          `SELECT COUNT(*)::integer AS total,
                  COUNT(*) FILTER (WHERE c.created_at >= date_trunc('month', now()))::integer AS new_this_month,
                  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id))::integer AS with_orders
           FROM customers c`
        );
        return rows[0] || { total: 0, new_this_month: 0, with_orders: 0 };
      },
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
                  (SELECT COUNT(*)::integer FROM orders o WHERE o.customer_id = c.id) AS order_count,
                  (SELECT COALESCE(SUM(o.total_ex_vat), 0)::numeric FROM orders o WHERE o.customer_id = c.id) AS order_total_ex_vat
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
      async addAsset(customerId, { productId, serialNumber, installedAt, warrantyEndsAt, maintenanceIntervalMonths, nextMaintenanceAt }) {
        const { rows } = await db.query(
          `INSERT INTO installed_assets
             (customer_id, product_id, serial_number, installed_at, warranty_ends_at, maintenance_interval_months, next_maintenance_at)
           SELECT id, $2, $3, $4, $5, $6, $7 FROM customers WHERE id = $1
           RETURNING id, customer_id, product_id, serial_number, installed_at, warranty_ends_at,
                     maintenance_interval_months, next_maintenance_at, status, created_at`,
          [customerId, productId, serialNumber, installedAt, warrantyEndsAt, maintenanceIntervalMonths, nextMaintenanceAt]
        );
        return rows[0] || null;
      },
      async listAddresses(customerId, { limit = 20, offset = 0 } = {}) {
        const { rows } = await db.query(
          `SELECT id, customer_id, city_id, address_text, latitude, longitude, created_at,
                  COUNT(*) OVER()::integer AS total_count
           FROM service_locations WHERE customer_id = $1
           ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
          [customerId, limit, offset]
        );
        return rows;
      },
      async listAssets(customerId, { limit = 20, offset = 0 } = {}) {
        const { rows } = await db.query(
          `SELECT id, customer_id, product_id, serial_number, installed_at, warranty_ends_at,
                  last_maintenance_at, next_maintenance_at, status,
                  COUNT(*) OVER()::integer AS total_count
           FROM installed_assets WHERE customer_id = $1
           ORDER BY installed_at DESC, id DESC LIMIT $2 OFFSET $3`,
          [customerId, limit, offset]
        );
        return rows;
      },
      async findAsset(customerId, assetId) {
        const { rows } = await db.query(
          `SELECT id, customer_id, product_id, serial_number, installed_at, warranty_ends_at,
                  maintenance_interval_months, last_maintenance_at, next_maintenance_at, status
           FROM installed_assets WHERE id = $1 AND customer_id = $2 LIMIT 1`,
          [assetId, customerId]
        );
        return rows[0] || null;
      },
      async listAssetHistory(customerId, assetId, { limit = 20, offset = 0 } = {}) {
        const { rows } = await db.query(
          `SELECT e.id, e.asset_id, e.completed_at, e.notes, e.performed_by, e.created_at,
                  COUNT(*) OVER()::integer AS total_count
           FROM asset_maintenance_events e
           JOIN installed_assets a ON a.id = e.asset_id
           WHERE e.asset_id = $1 AND a.customer_id = $2
           ORDER BY e.completed_at DESC, e.id DESC LIMIT $3 OFFSET $4`,
          [assetId, customerId, limit, offset]
        );
        return rows;
      },
      async listOrders(customerId, { limit = 20, offset = 0 } = {}) {
        const { rows } = await db.query(
          `SELECT id, external_source, external_order_id, paid_at, total_ex_vat, created_at,
                  COUNT(*) OVER()::integer AS total_count
           FROM orders WHERE customer_id = $1
           ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
          [customerId, limit, offset]
        );
        return rows;
      },
      async listServiceJobs(customerId, { limit = 20, offset = 0 } = {}) {
        const { rows } = await db.query(
          `SELECT j.id, j.order_id, o.external_order_id, j.technician_id, j.city_id,
                  l.address_text, j.status, j.scheduled_at, j.completed_at, j.created_at,
                  r.score AS rating_score, r.comment AS rating_comment,
                  COUNT(*) OVER()::integer AS total_count
           FROM service_jobs j
           JOIN orders o ON o.id = j.order_id
           LEFT JOIN service_locations l ON l.id = j.service_location_id
           LEFT JOIN service_ratings r ON r.job_id = j.id
           WHERE j.customer_id = $1
           ORDER BY COALESCE(j.completed_at, j.scheduled_at, j.created_at) DESC, j.id DESC
           LIMIT $2 OFFSET $3`,
          [customerId, limit, offset]
        );
        return rows;
      },
      async timeline(customerId, { limit = 20, offset = 0 } = {}) {
        const { rows } = await db.query(
          `SELECT events.*, COUNT(*) OVER()::integer AS total_count FROM (
             SELECT 'order' AS type, o.id::text, o.external_order_id AS reference,
                    CASE WHEN o.paid_at IS NULL THEN 'created' ELSE 'paid' END AS status, o.created_at AS occurred_at
             FROM orders o WHERE o.customer_id = $1
             UNION ALL
             SELECT 'job', j.id::text, j.id::text, j.status, j.created_at
             FROM service_jobs j WHERE j.customer_id = $1
             UNION ALL
             SELECT 'notification', n.id::text, n.event_type, n.status, n.created_at
             FROM notification_events n WHERE n.customer_id = $1
             UNION ALL
             SELECT 'maintenance', e.id::text, a.product_id, 'completed', e.completed_at
             FROM asset_maintenance_events e
             JOIN installed_assets a ON a.id = e.asset_id
             WHERE a.customer_id = $1
           ) events ORDER BY occurred_at DESC, id DESC LIMIT $2 OFFSET $3`,
          [customerId, limit, offset]
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

    escalations: {
      async stats() {
        const { rows } = await db.query(
          `SELECT COUNT(*) FILTER (WHERE status = 'open')::integer AS open,
                  COUNT(*) FILTER (WHERE status = 'open' AND level = 1)::integer AS level_1,
                  COUNT(*) FILTER (WHERE status = 'open' AND level = 2)::integer AS level_2,
                  COUNT(*) FILTER (WHERE status = 'open' AND level = 3)::integer AS level_3,
                  COUNT(*) FILTER (WHERE status = 'resolved' AND resolved_at >= date_trunc('day', now()))::integer AS resolved_today
           FROM job_escalations`
        );
        return rows[0] || { open: 0, level_1: 0, level_2: 0, level_3: 0, resolved_today: 0 };
      },
      async list({ status = 'open', limit = 20, offset = 0 } = {}) {
        const { rows } = await db.query(
          `SELECT e.id, e.job_id, e.level, e.minutes_late, e.status, e.detected_at,
                  e.resolved_at, e.resolution_reason, j.status AS job_status, j.scheduled_at,
                  j.technician_id, c.name AS customer_name, o.external_order_id,
                  l.address_text, COUNT(*) OVER()::integer AS total_count
           FROM job_escalations e
           JOIN service_jobs j ON j.id = e.job_id
           JOIN customers c ON c.id = j.customer_id
           JOIN orders o ON o.id = j.order_id
           LEFT JOIN service_locations l ON l.id = j.service_location_id
           WHERE ($1 = 'all' OR e.status = $1)
           ORDER BY CASE e.status WHEN 'open' THEN 0 ELSE 1 END, e.level DESC, e.detected_at ASC
           LIMIT $2 OFFSET $3`,
          [status, limit, offset]
        );
        return rows;
      }
    },

    jobs: {
      async operationsStats() {
        const { rows } = await db.query(
          `SELECT COUNT(*) FILTER (WHERE status NOT IN ('completed','cancelled'))::integer AS open,
                  COUNT(*) FILTER (WHERE status = 'pending_assignment')::integer AS pending_assignment,
                  COUNT(*) FILTER (WHERE status = 'scheduled' AND scheduled_at >= date_trunc('day', now()) AND scheduled_at < date_trunc('day', now()) + interval '1 day')::integer AS scheduled_today,
                  COUNT(*) FILTER (WHERE status IN ('en_route','arrived','in_progress'))::integer AS in_progress,
                  COUNT(*) FILTER (WHERE status NOT IN ('completed','cancelled','pending_assignment') AND scheduled_at < now())::integer AS overdue,
                  COUNT(*) FILTER (WHERE status = 'completed' AND completed_at >= date_trunc('day', now()))::integer AS completed_today
           FROM service_jobs`
        );
        return rows[0] || { open: 0, pending_assignment: 0, scheduled_today: 0, in_progress: 0, overdue: 0, completed_today: 0 };
      },
      async listForOperations({ query = '', status = 'all', limit = 20, offset = 0 } = {}) {
        const { rows } = await db.query(
          `SELECT j.id, j.order_id, o.external_order_id, j.customer_id, c.name AS customer_name,
                  u.mobile AS customer_mobile, j.service_location_id, l.city_id, l.address_text,
                  j.technician_id, j.required_skill_code, j.service_duration_minutes,
                  j.status, j.scheduled_at, j.completed_at, j.created_at, j.updated_at,
                  CASE
                    WHEN j.status = 'pending_assignment' THEN 'unassigned'
                    WHEN j.status NOT IN ('completed','cancelled') AND j.scheduled_at < now() THEN 'overdue'
                    ELSE 'on_track'
                  END AS sla_state,
                  CASE WHEN j.scheduled_at < now() AND j.status NOT IN ('completed','cancelled')
                    THEN FLOOR(EXTRACT(EPOCH FROM (now() - j.scheduled_at)) / 60)::integer ELSE 0 END AS minutes_late,
                  COUNT(*) OVER()::integer AS total_count
           FROM service_jobs j
           JOIN orders o ON o.id = j.order_id
           JOIN customers c ON c.id = j.customer_id
           LEFT JOIN users u ON u.id = c.user_id
           LEFT JOIN service_locations l ON l.id = j.service_location_id
           WHERE ($1 = '' OR c.name ILIKE '%' || $1 || '%' OR u.mobile LIKE '%' || $1 || '%'
                  OR o.external_order_id ILIKE '%' || $1 || '%' OR l.address_text ILIKE '%' || $1 || '%')
             AND CASE $2
               WHEN 'open' THEN j.status NOT IN ('completed','cancelled')
               WHEN 'pending_assignment' THEN j.status = 'pending_assignment'
               WHEN 'scheduled' THEN j.status = 'scheduled'
               WHEN 'active' THEN j.status IN ('en_route','arrived','in_progress')
               WHEN 'completed' THEN j.status = 'completed'
               WHEN 'cancelled' THEN j.status = 'cancelled'
               WHEN 'overdue' THEN j.status NOT IN ('completed','cancelled','pending_assignment') AND j.scheduled_at < now()
               ELSE true
             END
           ORDER BY
             CASE WHEN j.status = 'pending_assignment' THEN 0 WHEN j.status NOT IN ('completed','cancelled') AND j.scheduled_at < now() THEN 1 ELSE 2 END,
             COALESCE(j.scheduled_at, j.created_at) ASC, j.id ASC
           LIMIT $3 OFFSET $4`,
          [query.trim(), status, limit, offset]
        );
        return rows;
      },
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
      async operationsStats() {
        const { rows } = await db.query(
          `SELECT COUNT(*)::integer AS total,
                  COUNT(*) FILTER (WHERE status = 'pending_approval')::integer AS pending_approval,
                  COUNT(*) FILTER (WHERE status = 'approved')::integer AS approved,
                  COUNT(*) FILTER (WHERE status = 'rejected')::integer AS rejected,
                  COUNT(*) FILTER (WHERE status = 'paid')::integer AS paid,
                  COALESCE(SUM(payout_amount) FILTER (WHERE status = 'pending_approval'), 0)::numeric(12,2) AS pending_amount,
                  COALESCE(SUM(payout_amount) FILTER (WHERE status = 'approved'), 0)::numeric(12,2) AS approved_amount,
                  COALESCE(SUM(payout_amount) FILTER (WHERE status = 'paid' AND approved_at >= date_trunc('month', now())), 0)::numeric(12,2) AS paid_this_month
           FROM technician_settlements`
        );
        return rows[0] || { total: 0, pending_approval: 0, approved: 0, rejected: 0, paid: 0, pending_amount: 0, approved_amount: 0, paid_this_month: 0 };
      },
      async listForOperations({ query = '', status = 'all', limit = 20, offset = 0 } = {}) {
        const { rows } = await db.query(
          `SELECT s.id, s.job_id, s.technician_id, u.mobile AS technician_mobile,
                  j.customer_id, c.name AS customer_name, o.external_order_id,
                  s.sale_ex_vat, s.product_cost, s.other_costs, s.margin,
                  s.policy_version, s.commission_rate, s.fixed_amount, s.payout_amount,
                  s.status, s.approved_by, s.approved_at, s.created_at,
                  COUNT(*) OVER()::integer AS total_count
           FROM technician_settlements s
           JOIN technicians t ON t.id = s.technician_id
           JOIN users u ON u.id = t.user_id
           JOIN service_jobs j ON j.id = s.job_id
           JOIN customers c ON c.id = j.customer_id
           JOIN orders o ON o.id = j.order_id
           WHERE ($1 = '' OR s.id::text ILIKE '%' || $1 || '%' OR s.job_id::text ILIKE '%' || $1 || '%'
                  OR u.mobile LIKE '%' || $1 || '%' OR c.name ILIKE '%' || $1 || '%'
                  OR o.external_order_id ILIKE '%' || $1 || '%')
             AND ($2 = 'all' OR s.status = $2)
           ORDER BY CASE s.status WHEN 'pending_approval' THEN 0 WHEN 'approved' THEN 1 WHEN 'rejected' THEN 2 ELSE 3 END,
                    s.created_at ASC, s.id ASC LIMIT $3 OFFSET $4`,
          [query.trim(), status, limit, offset]
        );
        return rows;
      },
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
      async maintenanceStats() {
        const { rows } = await db.query(
          `SELECT COUNT(*) FILTER (WHERE status = 'active')::integer AS active,
                  COUNT(*) FILTER (WHERE status = 'active' AND next_maintenance_at < now())::integer AS overdue,
                  COUNT(*) FILTER (WHERE status = 'active' AND next_maintenance_at >= now() AND next_maintenance_at < now() + interval '7 days')::integer AS due_7_days,
                  COUNT(*) FILTER (WHERE status = 'active' AND next_maintenance_at >= now() AND next_maintenance_at < now() + interval '30 days')::integer AS due_30_days
           FROM installed_assets`
        );
        return rows[0] || { active: 0, overdue: 0, due_7_days: 0, due_30_days: 0 };
      },
      async listMaintenance({ query = '', window = 'all', limit = 20, offset = 0 } = {}) {
        const { rows } = await db.query(
          `SELECT a.id, a.customer_id, a.product_id, a.serial_number, a.last_maintenance_at,
                  a.next_maintenance_at, a.warranty_ends_at, a.status,
                  c.name AS customer_name, u.mobile AS customer_mobile,
                  location.city_id, location.address_text,
                  CEIL(EXTRACT(EPOCH FROM (a.next_maintenance_at - now())) / 86400)::integer AS days_until_due,
                  COUNT(*) OVER()::integer AS total_count
           FROM installed_assets a
           JOIN customers c ON c.id = a.customer_id
           LEFT JOIN users u ON u.id = c.user_id
           LEFT JOIN LATERAL (
             SELECT city_id, address_text FROM service_locations
             WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 1
           ) location ON true
           WHERE a.status = 'active'
             AND ($1 = '' OR c.name ILIKE '%' || $1 || '%' OR u.mobile LIKE '%' || $1 || '%'
                  OR a.product_id ILIKE '%' || $1 || '%' OR a.serial_number ILIKE '%' || $1 || '%')
             AND CASE $2
               WHEN 'overdue' THEN a.next_maintenance_at < now()
               WHEN '7d' THEN a.next_maintenance_at >= now() AND a.next_maintenance_at < now() + interval '7 days'
               WHEN '30d' THEN a.next_maintenance_at >= now() AND a.next_maintenance_at < now() + interval '30 days'
               ELSE true
             END
           ORDER BY a.next_maintenance_at ASC, a.id ASC LIMIT $3 OFFSET $4`,
          [query.trim(), window, limit, offset]
        );
        return rows;
      },
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
