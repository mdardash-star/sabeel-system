export function createRepositories(db) {
  if (!db?.query) throw new Error('Database client with query() is required');

  return {
    technicians: {
      async findActiveByUserId(userId, tenantId = null) {
        const { rows } = await db.query(
          `SELECT t.id, t.user_id, t.city_id, t.branch_id
           FROM technicians t
           JOIN users u ON u.id = t.user_id
           WHERE t.user_id = $1 AND ($2::uuid IS NULL OR u.organization_id = $2)
             AND t.is_active = true AND u.is_active = true
           LIMIT 1`,
          [userId, tenantId]
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
      async findByUserId(userId, tenantId = null) {
        const { rows } = await db.query(
          `SELECT c.id,c.name,c.created_at,u.mobile,
                  (SELECT COUNT(*)::integer FROM orders o WHERE o.customer_id=c.id) AS order_count,
                  (SELECT COUNT(*)::integer FROM installed_assets a WHERE a.customer_id=c.id AND a.status='active') AS active_asset_count
           FROM customers c JOIN users u ON u.id=c.user_id
           WHERE c.user_id=$1 AND ($2::uuid IS NULL OR u.organization_id=$2) LIMIT 1`, [userId,tenantId]
        );
        return rows[0] || null;
      },
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

    marketing: {
      async stats() {
        const { rows } = await db.query(
          `SELECT COUNT(*)::integer AS total,
            COUNT(*) FILTER (WHERE status='draft')::integer AS drafts,
            COUNT(*) FILTER (WHERE status='scheduled')::integer AS scheduled,
            COUNT(*) FILTER (WHERE status='queued')::integer AS queued,
            COALESCE(SUM(recipients.total),0)::integer AS total_recipients,
            COALESCE(SUM(recipients.sent),0)::integer AS sent
           FROM marketing_campaigns mc LEFT JOIN LATERAL (
             SELECT COUNT(*)::integer AS total,COUNT(*) FILTER (WHERE status='sent')::integer AS sent
             FROM campaign_recipients WHERE campaign_id=mc.id
           ) recipients ON true`
        ); return rows[0];
      },
      async segments() {
        const { rows } = await db.query(
          `SELECT cs.*,COUNT(mc.id)::integer AS campaign_count FROM customer_segments cs
           LEFT JOIN marketing_campaigns mc ON mc.segment_id=cs.id WHERE cs.is_active
           GROUP BY cs.id ORDER BY cs.created_at DESC`
        ); return rows;
      },
      async campaigns({ status='all', limit=20, offset=0 }={}) {
        const { rows } = await db.query(
          `SELECT mc.*,cs.name AS segment_name,cs.segment_type,
            COALESCE(r.total,0)::integer AS recipient_count,COALESCE(r.sent,0)::integer AS sent_count,
            COALESCE(r.failed,0)::integer AS failed_count,COUNT(*) OVER()::integer AS total_count
           FROM marketing_campaigns mc JOIN customer_segments cs ON cs.id=mc.segment_id
           LEFT JOIN LATERAL (SELECT COUNT(*) AS total,COUNT(*) FILTER(WHERE status='sent') AS sent,
             COUNT(*) FILTER(WHERE status='failed') AS failed FROM campaign_recipients WHERE campaign_id=mc.id) r ON true
           WHERE ($1='all' OR mc.status=$1) ORDER BY mc.created_at DESC LIMIT $2 OFFSET $3`,[status,limit,offset]
        ); return rows;
      },
      async abandonedStats() {
        const {rows}=await db.query(`SELECT COUNT(*) FILTER(WHERE status IN('open','notified'))::integer AS active,
          COUNT(*) FILTER(WHERE status='recovered')::integer AS recovered,COUNT(*) FILTER(WHERE status='notified')::integer AS notified,
          COALESCE(SUM(cart_value) FILTER(WHERE status IN('open','notified')),0)::numeric(14,2) AS at_risk_value,
          COALESCE(SUM(cart_value) FILTER(WHERE status='recovered'),0)::numeric(14,2) AS recovered_value,
          CASE WHEN COUNT(*) FILTER(WHERE status IN('notified','recovered'))=0 THEN 0 ELSE
          ROUND(COUNT(*) FILTER(WHERE status='recovered')::numeric/COUNT(*) FILTER(WHERE status IN('notified','recovered'))*100,1) END AS recovery_rate
          FROM abandoned_carts`);return rows[0];
      },
      async abandonedCarts({status='active',limit=20,offset=0}={}) {
        const {rows}=await db.query(`SELECT ac.*,c.name AS linked_customer_name,COUNT(*) OVER()::integer AS total_count
          FROM abandoned_carts ac LEFT JOIN customers c ON c.id=ac.customer_id
          WHERE CASE $1 WHEN 'active' THEN ac.status IN('open','notified') WHEN 'all' THEN true ELSE ac.status=$1 END
          ORDER BY CASE WHEN ac.status IN('open','notified') THEN 0 ELSE 1 END,ac.abandoned_at DESC LIMIT $2 OFFSET $3`,[status,limit,offset]);return rows;
      },
      async contentStats() {
        const {rows}=await db.query(`SELECT COUNT(*)::integer AS total,COUNT(*) FILTER(WHERE status='draft')::integer AS drafts,
          COUNT(*) FILTER(WHERE status='review')::integer AS in_review,COUNT(*) FILTER(WHERE status='approved')::integer AS approved,
          COUNT(*) FILTER(WHERE status='scheduled')::integer AS scheduled,COUNT(*) FILTER(WHERE status='published' AND published_at>=date_trunc('month',now()))::integer AS published_this_month,
          COALESCE(ROUND(AVG(seo_score)),0)::integer AS average_seo_score FROM marketing_content`);return rows[0];
      },
      async content({status='all',channel='all',from=null,to=null,limit=50,offset=0}={}) {
        const {rows}=await db.query(`SELECT mc.*,u.mobile AS creator_mobile,COUNT(*) OVER()::integer AS total_count FROM marketing_content mc
          LEFT JOIN users u ON u.id=mc.created_by WHERE($1='all' OR mc.status=$1)AND($2='all' OR mc.channel=$2)
          AND($3::timestamptz IS NULL OR COALESCE(mc.scheduled_at,mc.created_at)>=$3)AND($4::timestamptz IS NULL OR COALESCE(mc.scheduled_at,mc.created_at)<$4)
          ORDER BY COALESCE(mc.scheduled_at,mc.created_at) DESC LIMIT $5 OFFSET $6`,[status,channel,from,to,limit,offset]);return rows;
      },
      async conversationStats() {
        const {rows}=await db.query(`SELECT COUNT(*) FILTER(WHERE status<>'closed')::integer AS active,
          COUNT(*) FILTER(WHERE status='pending_agent')::integer AS pending_agent,
          COUNT(*) FILTER(WHERE status='waiting_customer')::integer AS waiting_customer,
          COUNT(*) FILTER(WHERE priority IN('high','urgent')AND status<>'closed')::integer AS priority,
          COALESCE(SUM(unread_count),0)::integer AS unread FROM customer_conversations`);return rows[0];
      },
      async conversations({status='active',channel='all',query='',limit=20,offset=0}={}) {
        const {rows}=await db.query(`SELECT cc.*,c.name AS customer_name,u.mobile AS assigned_mobile,
          last_message.body AS last_message,last_message.direction AS last_direction,COUNT(*)OVER()::integer AS total_count
          FROM customer_conversations cc LEFT JOIN customers c ON c.id=cc.customer_id LEFT JOIN users u ON u.id=cc.assigned_to
          LEFT JOIN LATERAL(SELECT body,direction FROM conversation_messages WHERE conversation_id=cc.id ORDER BY sent_at DESC,id DESC LIMIT 1)last_message ON true
          WHERE CASE $1 WHEN 'active'THEN cc.status<>'closed' WHEN 'all'THEN true ELSE cc.status=$1 END
          AND($2='all'OR cc.channel=$2)AND($3=''OR COALESCE(c.name,'')ILIKE '%'||$3||'%'OR cc.contact_handle ILIKE '%'||$3||'%'OR cc.subject ILIKE '%'||$3||'%')
          ORDER BY CASE cc.priority WHEN 'urgent'THEN 0 WHEN 'high'THEN 1 WHEN 'normal'THEN 2 ELSE 3 END,cc.last_message_at DESC LIMIT $4 OFFSET $5`,[status,channel,query,limit,offset]);return rows;
      },
      async conversationThread(id) {
        const conversation=(await db.query(`SELECT cc.*,c.name AS customer_name,c.mobile AS customer_mobile,u.mobile AS assigned_mobile FROM customer_conversations cc LEFT JOIN customers c ON c.id=cc.customer_id LEFT JOIN users u ON u.id=cc.assigned_to WHERE cc.id=$1`,[id])).rows[0];
        if(!conversation)return null;const messages=(await db.query(`SELECT cm.*,u.mobile AS agent_mobile FROM conversation_messages cm LEFT JOIN users u ON u.id=cm.sent_by WHERE cm.conversation_id=$1 ORDER BY cm.sent_at ASC,cm.id ASC`,[id])).rows;return{conversation,messages};
      },
      async attribution(from,to) {
        const [summary,channels,campaigns,recent]=await Promise.all([
          db.query(`SELECT COUNT(o.id)::integer AS paid_orders,COUNT(oa.order_id)::integer AS attributed_orders,
            COALESCE(SUM(o.total_ex_vat),0)::numeric(14,2) AS revenue,COALESCE(SUM(o.total_ex_vat)FILTER(WHERE oa.order_id IS NOT NULL),0)::numeric(14,2) AS attributed_revenue,
            COALESCE((SELECT SUM(amount)FROM marketing_spend WHERE spent_on>=$1::date AND spent_on<$2::date),0)::numeric(14,2) AS spend,
            (SELECT COUNT(DISTINCT visitor_id)::integer FROM marketing_touches WHERE occurred_at>=$1 AND occurred_at<$2) AS visitors
            FROM orders o LEFT JOIN order_attribution oa ON oa.order_id=o.id WHERE o.paid_at>=$1 AND o.paid_at<$2`,[from,to]),
          db.query(`SELECT lt.source AS name,lt.medium,COUNT(o.id)::integer AS orders,SUM(o.total_ex_vat)::numeric(14,2) AS revenue,
            COALESCE(sp.spend,0)::numeric(14,2) AS spend,CASE WHEN COALESCE(sp.spend,0)=0 THEN NULL ELSE ROUND(SUM(o.total_ex_vat)/sp.spend,2)END AS roas
            FROM order_attribution oa JOIN orders o ON o.id=oa.order_id JOIN marketing_touches lt ON lt.id=oa.last_touch_id
            LEFT JOIN LATERAL(SELECT SUM(amount)AS spend FROM marketing_spend WHERE source=lt.source AND spent_on>=$1::date AND spent_on<$2::date)sp ON true
            WHERE o.paid_at>=$1 AND o.paid_at<$2 GROUP BY lt.source,lt.medium,sp.spend ORDER BY revenue DESC`,[from,to]),
          db.query(`SELECT COALESCE(NULLIF(lt.campaign,''),'بدون حملة')AS name,lt.source,COUNT(o.id)::integer AS orders,SUM(o.total_ex_vat)::numeric(14,2)AS revenue,
            COALESCE(sp.spend,0)::numeric(14,2)AS spend FROM order_attribution oa JOIN orders o ON o.id=oa.order_id JOIN marketing_touches lt ON lt.id=oa.last_touch_id
            LEFT JOIN LATERAL(SELECT SUM(amount)AS spend FROM marketing_spend WHERE source=lt.source AND campaign=lt.campaign AND spent_on>=$1::date AND spent_on<$2::date)sp ON true
            WHERE o.paid_at>=$1 AND o.paid_at<$2 GROUP BY lt.campaign,lt.source,sp.spend ORDER BY revenue DESC LIMIT 20`,[from,to]),
          db.query(`SELECT o.id,o.external_order_id,o.total_ex_vat,o.paid_at,c.name AS customer_name,ft.source AS first_source,ft.campaign AS first_campaign,
            lt.source AS last_source,lt.campaign AS last_campaign FROM order_attribution oa JOIN orders o ON o.id=oa.order_id JOIN customers c ON c.id=o.customer_id
            LEFT JOIN marketing_touches ft ON ft.id=oa.first_touch_id LEFT JOIN marketing_touches lt ON lt.id=oa.last_touch_id
            WHERE o.paid_at>=$1 AND o.paid_at<$2 ORDER BY o.paid_at DESC LIMIT 30`,[from,to])
        ]);const s=summary.rows[0]||{};s.roas=Number(s.spend)>0?Number(s.attributed_revenue)/Number(s.spend):null;s.attribution_rate=Number(s.paid_orders)>0?Number(s.attributed_orders)/Number(s.paid_orders)*100:0;return{summary:s,channels:channels.rows,campaigns:campaigns.rows,recent:recent.rows};
      }
    },

    ai: {
      async stats(){const{rows}=await db.query(`SELECT COUNT(*) FILTER(WHERE status='draft')::integer AS pending_review,COUNT(*) FILTER(WHERE status='approved')::integer AS approved,COUNT(*) FILTER(WHERE status='used')::integer AS used,COUNT(*) FILTER(WHERE risk_level='high'AND status='draft')::integer AS high_risk,COALESCE(ROUND(AVG(confidence)*100),0)::integer AS average_confidence FROM ai_suggestions`);return rows[0]},
      async suggestions({status='all',limit=20,offset=0}={}){const{rows}=await db.query(`SELECT ai.*,cc.channel,cc.contact_handle,cc.subject,c.name AS customer_name,COUNT(*)OVER()::integer AS total_count FROM ai_suggestions ai JOIN customer_conversations cc ON cc.id=ai.conversation_id LEFT JOIN customers c ON c.id=cc.customer_id WHERE($1='all'OR ai.status=$1)ORDER BY CASE ai.risk_level WHEN 'high'THEN 0 WHEN 'medium'THEN 1 ELSE 2 END,ai.created_at DESC LIMIT $2 OFFSET $3`,[status,limit,offset]);return rows},
      async knowledge({status='approved',limit=50,offset=0}={}){const{rows}=await db.query(`SELECT *,COUNT(*)OVER()::integer AS total_count FROM ai_knowledge_articles WHERE($1='all'OR status=$1)ORDER BY updated_at DESC LIMIT $2 OFFSET $3`,[status,limit,offset]);return rows},
      async insightStats(){const{rows}=await db.query(`SELECT COUNT(*) FILTER(WHERE status='open')::integer AS open,COUNT(*) FILTER(WHERE status='open'AND severity IN('critical','high'))::integer AS high_priority,COUNT(*) FILTER(WHERE status='acknowledged')::integer AS acknowledged,COUNT(*) FILTER(WHERE status='resolved'AND resolved_at>=date_trunc('month',now()))::integer AS resolved_this_month FROM ai_insights`);return rows[0]},
      async insights({status='open',domain='all',limit=50,offset=0}={}){const{rows}=await db.query(`SELECT *,COUNT(*)OVER()::integer AS total_count FROM ai_insights WHERE($1='all'OR status=$1)AND($2='all'OR domain=$2)ORDER BY CASE severity WHEN 'critical'THEN 0 WHEN 'high'THEN 1 WHEN 'medium'THEN 2 ELSE 3 END,created_at DESC LIMIT $3 OFFSET $4`,[status,domain,limit,offset]);return rows},
      async latestBrief(){const brief=(await db.query(`SELECT * FROM ai_executive_briefs ORDER BY brief_date DESC LIMIT 1`)).rows[0];return brief||null},
      async dispatchStats(){const{rows}=await db.query(`SELECT COUNT(*) FILTER(WHERE status='pending')::integer AS pending,COUNT(*) FILTER(WHERE status='approved')::integer AS approved,COUNT(*) FILTER(WHERE status='rejected')::integer AS rejected,COUNT(*) FILTER(WHERE risk_level='high'AND status='pending')::integer AS high_risk FROM ai_dispatch_recommendations`);return rows[0]},
      async dispatchQueue({limit=30,offset=0}={}){const{rows}=await db.query(`SELECT j.id,j.status,j.city_id,j.scheduled_at,j.required_skill_code,j.service_duration_minutes,c.name AS customer_name,o.external_order_id,COUNT(*)OVER()::integer AS total_count FROM service_jobs j JOIN orders o ON o.id=j.order_id JOIN customers c ON c.id=o.customer_id WHERE j.status='pending_assignment'ORDER BY j.created_at ASC LIMIT $1 OFFSET $2`,[limit,offset]);return rows},
      async dispatchRecommendations({status='all',limit=30,offset=0}={}){const{rows}=await db.query(`SELECT r.*,j.city_id,j.required_skill_code,c.name AS customer_name,o.external_order_id,COUNT(*)OVER()::integer AS total_count FROM ai_dispatch_recommendations r JOIN service_jobs j ON j.id=r.job_id JOIN orders o ON o.id=j.order_id JOIN customers c ON c.id=o.customer_id WHERE($1='all'OR r.status=$1)ORDER BY CASE r.status WHEN 'pending'THEN 0 ELSE 1 END,r.created_at DESC LIMIT $2 OFFSET $3`,[status,limit,offset]);return rows},
      async salesStats(){const{rows}=await db.query(`SELECT COUNT(*) FILTER(WHERE status IN('new','approved','contacted'))::integer AS active,COUNT(*) FILTER(WHERE status='new')::integer AS new,COUNT(*) FILTER(WHERE status='contacted')::integer AS contacted,COUNT(*) FILTER(WHERE status='converted'AND updated_at>=date_trunc('month',now()))::integer AS converted_this_month,COALESCE(SUM(estimated_value)FILTER(WHERE status IN('new','approved','contacted')),0)::numeric(14,2)AS pipeline_value FROM ai_sales_opportunities`);return rows[0]},
      async salesOpportunities({status='active',type='all',limit=50,offset=0}={}){const{rows}=await db.query(`SELECT so.*,c.name AS customer_name,c.mobile,u.mobile AS assigned_mobile,COUNT(*)OVER()::integer AS total_count FROM ai_sales_opportunities so JOIN customers c ON c.id=so.customer_id LEFT JOIN users u ON u.id=so.assigned_to WHERE CASE $1 WHEN 'active'THEN so.status IN('new','approved','contacted')WHEN 'all'THEN true ELSE so.status=$1 END AND($2='all'OR so.opportunity_type=$2)ORDER BY so.score DESC,so.estimated_value DESC,so.created_at DESC LIMIT $3 OFFSET $4`,[status,type,limit,offset]);return rows},
      async marketingStats(){const{rows}=await db.query(`SELECT COUNT(*) FILTER(WHERE status IN('new','approved','scheduled'))::integer AS active,COUNT(*) FILTER(WHERE status='new')::integer AS new,COUNT(*) FILTER(WHERE status='scheduled')::integer AS scheduled,COUNT(*) FILTER(WHERE status='completed'AND updated_at>=date_trunc('month',now()))::integer AS completed_this_month,COUNT(*) FILTER(WHERE priority='high'AND status IN('new','approved','scheduled'))::integer AS high_priority FROM ai_marketing_recommendations`);return rows[0]},
      async marketingRecommendations({status='active',type='all',limit=50,offset=0}={}){const{rows}=await db.query(`SELECT *,COUNT(*)OVER()::integer AS total_count FROM ai_marketing_recommendations WHERE CASE $1 WHEN 'active'THEN status IN('new','approved','scheduled')WHEN 'all'THEN true ELSE status=$1 END AND($2='all'OR recommendation_type=$2)ORDER BY CASE priority WHEN 'high'THEN 0 WHEN 'medium'THEN 1 ELSE 2 END,created_at DESC LIMIT $3 OFFSET $4`,[status,type,limit,offset]);return rows},
      async financeStats(){const{rows}=await db.query(`SELECT COUNT(*) FILTER(WHERE status IN('open','reviewed'))::integer AS active,COUNT(*) FILTER(WHERE status='open')::integer AS open,COUNT(*) FILTER(WHERE severity IN('critical','high')AND status IN('open','reviewed'))::integer AS high_priority,COUNT(*) FILTER(WHERE status='resolved'AND resolved_at>=date_trunc('month',now()))::integer AS resolved_this_month,COALESCE(SUM(financial_impact)FILTER(WHERE status IN('open','reviewed')),0)::numeric(14,2)AS financial_exposure FROM ai_finance_anomalies`);return rows[0]},
      async financeAnomalies({status='active',type='all',limit=50,offset=0}={}){const{rows}=await db.query(`SELECT *,COUNT(*)OVER()::integer AS total_count FROM ai_finance_anomalies WHERE CASE $1 WHEN 'active'THEN status IN('open','reviewed')WHEN 'all'THEN true ELSE status=$1 END AND($2='all'OR anomaly_type=$2)ORDER BY CASE severity WHEN 'critical'THEN 0 WHEN 'high'THEN 1 ELSE 2 END,financial_impact DESC,created_at DESC LIMIT $3 OFFSET $4`,[status,type,limit,offset]);return rows}
    },

    reports: {
      async profitability(from, to) {
        const base = `FROM orders o JOIN customers c ON c.id = o.customer_id
          LEFT JOIN LATERAL (SELECT COALESCE(SUM(quantity * unit_cost_snapshot), 0) AS product_cost FROM order_items WHERE order_id = o.id) items ON true
          LEFT JOIN order_costs oc ON oc.order_id = o.id
          LEFT JOIN LATERAL (SELECT COALESCE(SUM(ts.payout_amount) FILTER (WHERE ts.status <> 'rejected'), 0) AS payout FROM service_jobs j JOIN technician_settlements ts ON ts.job_id = j.id WHERE j.order_id = o.id) pay ON true
          LEFT JOIN LATERAL (SELECT city_id FROM service_jobs WHERE order_id = o.id ORDER BY created_at LIMIT 1) job ON true
          WHERE o.paid_at >= $1 AND o.paid_at < $2`;
        const [summary, trend, channels, cities, products, orders] = await Promise.all([
          db.query(`SELECT COUNT(*)::integer AS order_count, COALESCE(SUM(o.total_ex_vat),0)::numeric(14,2) AS revenue,
            COALESCE(SUM(items.product_cost),0)::numeric(14,2) AS product_cost,
            COALESCE(SUM(COALESCE(oc.other_costs,0)),0)::numeric(14,2) AS other_costs,
            COALESCE(SUM(pay.payout),0)::numeric(14,2) AS technician_payout,
            COALESCE(SUM(o.total_ex_vat-items.product_cost-COALESCE(oc.other_costs,0)-pay.payout),0)::numeric(14,2) AS net_profit
            ${base}`, [from, to]),
          db.query(`SELECT date_trunc('day', o.paid_at)::date AS period, COUNT(*)::integer AS orders,
            SUM(o.total_ex_vat)::numeric(14,2) AS revenue,
            SUM(o.total_ex_vat-items.product_cost-COALESCE(oc.other_costs,0)-pay.payout)::numeric(14,2) AS profit
            ${base} GROUP BY 1 ORDER BY 1`, [from, to]),
          db.query(`SELECT o.external_source AS name, COUNT(*)::integer AS orders, SUM(o.total_ex_vat)::numeric(14,2) AS revenue,
            SUM(o.total_ex_vat-items.product_cost-COALESCE(oc.other_costs,0)-pay.payout)::numeric(14,2) AS profit
            ${base} GROUP BY o.external_source ORDER BY revenue DESC`, [from, to]),
          db.query(`SELECT COALESCE(job.city_id,'غير محدد') AS name, COUNT(*)::integer AS orders, SUM(o.total_ex_vat)::numeric(14,2) AS revenue,
            SUM(o.total_ex_vat-items.product_cost-COALESCE(oc.other_costs,0)-pay.payout)::numeric(14,2) AS profit
            ${base} GROUP BY COALESCE(job.city_id,'غير محدد') ORDER BY revenue DESC`, [from, to]),
          db.query(`SELECT oi.product_name AS name, oi.sku, SUM(oi.quantity)::numeric(12,2) AS units,
            SUM(oi.subtotal_ex_vat)::numeric(14,2) AS revenue,
            SUM(oi.subtotal_ex_vat-(oi.quantity*oi.unit_cost_snapshot))::numeric(14,2) AS gross_profit
            FROM order_items oi JOIN orders o ON o.id=oi.order_id
            WHERE o.paid_at >= $1 AND o.paid_at < $2 GROUP BY oi.product_name,oi.sku ORDER BY revenue DESC LIMIT 20`, [from, to]),
          db.query(`SELECT o.id,o.external_order_id,o.external_source,o.paid_at,o.total_ex_vat,c.name AS customer_name,
            COALESCE(job.city_id,'غير محدد') AS city_id,items.product_cost,COALESCE(oc.other_costs,0) AS other_costs,pay.payout AS technician_payout,
            (o.total_ex_vat-items.product_cost-COALESCE(oc.other_costs,0)-pay.payout)::numeric(14,2) AS net_profit
            ${base} ORDER BY o.paid_at DESC LIMIT 50`, [from, to])
        ]);
        return { summary: summary.rows[0], trend: trend.rows, channels: channels.rows, cities: cities.rows, products: products.rows, orders: orders.rows };
      }
    },

    purchasing: {
      async stats() {
        const { rows } = await db.query(
          `SELECT COUNT(*) FILTER (WHERE status IN ('draft','approved','partially_received'))::integer AS open_orders,
                  COUNT(*) FILTER (WHERE status = 'draft')::integer AS pending_approval,
                  COUNT(*) FILTER (WHERE status IN ('approved','partially_received'))::integer AS awaiting_receipt,
                  COUNT(*) FILTER (WHERE status IN ('approved','partially_received') AND expected_at < now())::integer AS overdue,
                  COUNT(*) FILTER (WHERE status = 'received' AND updated_at >= date_trunc('month', now()))::integer AS received_this_month,
                  COALESCE(SUM(subtotal) FILTER (WHERE status IN ('draft','approved','partially_received')), 0)::numeric(14,2) AS open_value
           FROM purchase_orders`
        );
        return rows[0];
      },
      async suppliers({ query = '', limit = 100, offset = 0 } = {}) {
        const { rows } = await db.query(
          `SELECT s.*, COUNT(po.id)::integer AS order_count,
                  COALESCE(SUM(po.subtotal) FILTER (WHERE po.status <> 'cancelled'), 0)::numeric(14,2) AS total_spend,
                  COUNT(*) OVER()::integer AS total_count
           FROM suppliers s LEFT JOIN purchase_orders po ON po.supplier_id = s.id
           WHERE s.is_active AND ($1 = '' OR s.name ILIKE '%' || $1 || '%' OR s.mobile LIKE '%' || $1 || '%')
           GROUP BY s.id ORDER BY s.name ASC LIMIT $2 OFFSET $3`, [query.trim(), limit, offset]
        );
        return rows;
      },
      async list({ query = '', status = 'all', limit = 20, offset = 0 } = {}) {
        const { rows } = await db.query(
          `SELECT po.*, s.name AS supplier_name, w.name AS warehouse_name,
                  COALESCE(lines.item_count, 0)::integer AS item_count,
                  COALESCE(lines.ordered_units, 0)::numeric(12,2) AS ordered_units,
                  COALESCE(lines.received_units, 0)::numeric(12,2) AS received_units,
                  COALESCE(lines.items, '[]'::json) AS items,
                  COUNT(*) OVER()::integer AS total_count
           FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN warehouses w ON w.id = po.warehouse_id
           LEFT JOIN LATERAL (
             SELECT COUNT(*) AS item_count, SUM(poi.ordered_quantity) AS ordered_units, SUM(poi.received_quantity) AS received_units,
                    JSON_AGG(JSON_BUILD_OBJECT('id', poi.id, 'item_id', poi.item_id, 'sku', i.sku, 'name', i.name,
                      'unit', i.unit, 'ordered_quantity', poi.ordered_quantity, 'received_quantity', poi.received_quantity,
                      'unit_cost', poi.unit_cost) ORDER BY i.name) AS items
             FROM purchase_order_items poi JOIN inventory_items i ON i.id = poi.item_id WHERE poi.purchase_order_id = po.id
           ) lines ON true
           WHERE ($1 = '' OR po.po_number ILIKE '%' || $1 || '%' OR s.name ILIKE '%' || $1 || '%')
             AND CASE $2 WHEN 'overdue' THEN po.status IN ('approved','partially_received') AND po.expected_at < now()
                         WHEN 'all' THEN true ELSE po.status = $2 END
           ORDER BY CASE WHEN po.status IN ('approved','partially_received') AND po.expected_at < now() THEN 0 ELSE 1 END,
                    po.created_at DESC LIMIT $3 OFFSET $4`, [query.trim(), status, limit, offset]
        );
        return rows;
      }
    },

    inventory: {
      async stats() {
        const { rows } = await db.query(
          `SELECT COUNT(*) FILTER (WHERE i.is_active)::integer AS total_skus,
                  COALESCE(SUM(stock.quantity), 0)::numeric(14,2) AS total_units,
                  COALESCE(SUM(stock.quantity * i.unit_cost), 0)::numeric(14,2) AS stock_value,
                  COUNT(*) FILTER (WHERE i.is_active AND COALESCE(stock.quantity, 0) = 0)::integer AS out_of_stock,
                  COUNT(*) FILTER (WHERE i.is_active AND COALESCE(stock.quantity, 0) > 0 AND COALESCE(stock.quantity, 0) <= i.reorder_level)::integer AS low_stock
           FROM inventory_items i
           LEFT JOIN LATERAL (SELECT SUM(quantity) AS quantity FROM inventory_balances WHERE item_id = i.id) stock ON true`
        );
        return rows[0] || { total_skus: 0, total_units: 0, stock_value: 0, out_of_stock: 0, low_stock: 0 };
      },
      async list({ query = '', status = 'all', limit = 20, offset = 0 } = {}) {
        const { rows } = await db.query(
          `SELECT i.id, i.sku, i.name, i.unit, i.reorder_level, i.unit_cost, i.is_active,
                  COALESCE(stock.total_quantity, 0)::numeric(12,2) AS total_quantity,
                  COALESCE(stock.balances, '[]'::json) AS balances,
                  COALESCE(tech.technician_quantity, 0)::numeric(12,2) AS technician_quantity,
                  CASE WHEN COALESCE(stock.total_quantity, 0) = 0 THEN 'out'
                       WHEN stock.total_quantity <= i.reorder_level THEN 'low' ELSE 'ok' END AS stock_status,
                  COUNT(*) OVER()::integer AS total_count
           FROM inventory_items i
           LEFT JOIN LATERAL (
             SELECT SUM(b.quantity) AS total_quantity,
                    JSON_AGG(JSON_BUILD_OBJECT('warehouse_id', b.warehouse_id, 'warehouse_name', w.name, 'quantity', b.quantity) ORDER BY w.name) AS balances
             FROM inventory_balances b JOIN warehouses w ON w.id = b.warehouse_id WHERE b.item_id = i.id
           ) stock ON true
           LEFT JOIN LATERAL (SELECT SUM(quantity) AS technician_quantity FROM technician_inventory WHERE item_id = i.id) tech ON true
           WHERE i.is_active AND ($1 = '' OR i.sku ILIKE '%' || $1 || '%' OR i.name ILIKE '%' || $1 || '%')
             AND CASE $2 WHEN 'low' THEN COALESCE(stock.total_quantity, 0) > 0 AND COALESCE(stock.total_quantity, 0) <= i.reorder_level
                         WHEN 'out' THEN COALESCE(stock.total_quantity, 0) = 0 ELSE true END
           ORDER BY CASE WHEN COALESCE(stock.total_quantity, 0) = 0 THEN 0 WHEN stock.total_quantity <= i.reorder_level THEN 1 ELSE 2 END,
                    i.name ASC LIMIT $3 OFFSET $4`,
          [query.trim(), status, limit, offset]
        );
        return rows;
      },
      async movements({ limit = 20, offset = 0 } = {}) {
        const { rows } = await db.query(
          `SELECT m.id, m.movement_type, m.item_id, i.sku, i.name AS item_name, m.quantity, m.unit_cost,
                  m.from_warehouse_id, wf.name AS from_warehouse_name, m.to_warehouse_id, wt.name AS to_warehouse_name,
                  m.technician_id, u.mobile AS technician_mobile, m.reference, m.notes, m.created_at,
                  COUNT(*) OVER()::integer AS total_count
           FROM inventory_movements m JOIN inventory_items i ON i.id = m.item_id
           LEFT JOIN warehouses wf ON wf.id = m.from_warehouse_id
           LEFT JOIN warehouses wt ON wt.id = m.to_warehouse_id
           LEFT JOIN technicians t ON t.id = m.technician_id LEFT JOIN users u ON u.id = t.user_id
           ORDER BY m.created_at DESC, m.id DESC LIMIT $1 OFFSET $2`, [limit, offset]
        );
        return rows;
      },
      async technicianStock(technicianId) {
        const { rows } = await db.query(
          `SELECT ti.technician_id, ti.item_id, i.sku, i.name, i.unit, ti.quantity, ti.updated_at
           FROM technician_inventory ti JOIN inventory_items i ON i.id = ti.item_id
           WHERE ti.technician_id = $1 AND ti.quantity > 0 ORDER BY i.name ASC`, [technicianId]
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
