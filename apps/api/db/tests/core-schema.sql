\set ON_ERROR_STOP on

INSERT INTO users (id, mobile, role) VALUES
('00000000-0000-0000-0000-000000000001', '+966500000001', 'customer'),
('00000000-0000-0000-0000-000000000002', '+966500000002', 'technician'),
('00000000-0000-0000-0000-000000000003', '+966500000003', 'finance');

INSERT INTO customers (id, user_id, name) VALUES
('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Test Customer');

INSERT INTO customer_external_identities (customer_id, source, identity_key, external_customer_id)
VALUES ('10000000-0000-0000-0000-000000000001', 'woocommerce', 'woocommerce:customer:77', '77');

INSERT INTO technicians (id, user_id, city_id)
VALUES ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'riyadh');

INSERT INTO orders (id, external_source, external_order_id, customer_id, paid_at, total_ex_vat)
VALUES ('30000000-0000-0000-0000-000000000001', 'woocommerce', '9001', '10000000-0000-0000-0000-000000000001', now(), 500);

INSERT INTO order_costs (order_id, product_cost, other_costs)
VALUES ('30000000-0000-0000-0000-000000000001', 250, 50);

INSERT INTO service_jobs (id, order_id, customer_id, city_id, technician_id, status, scheduled_at)
VALUES ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'riyadh', '20000000-0000-0000-0000-000000000001', 'in_progress', now());

INSERT INTO job_evidence (job_id, media_type, storage_key)
VALUES ('40000000-0000-0000-0000-000000000001', 'image', 'jobs/9001/after.jpg');

UPDATE service_jobs SET status = 'completed', completed_at = now() WHERE id = '40000000-0000-0000-0000-000000000001';

INSERT INTO technician_settlements (
 id, job_id, technician_id, sale_ex_vat, product_cost, other_costs, margin, policy_version, commission_rate, payout_amount, status, approved_by, approved_at
) VALUES (
 '50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 500, 250, 50, 200, 'v1', 0.30, 60, 'approved', '00000000-0000-0000-0000-000000000003', now()
);

INSERT INTO wallet_entries (technician_id, settlement_id, entry_type, amount, idempotency_key)
VALUES ('20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'credit', 60, 'settlement:50000000-0000-0000-0000-000000000001');

INSERT INTO installed_assets (id, customer_id, product_id, serial_number, installed_at, next_maintenance_at)
VALUES ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'aqua-gold', 'AG-9001', now(), now() + interval '6 months');

INSERT INTO service_ratings (job_id, customer_id, technician_id, score, comment)
VALUES ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 5, 'Excellent');

DO $$
BEGIN
  IF (SELECT count(*) FROM wallet_entries WHERE technician_id='20000000-0000-0000-0000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'wallet entry missing';
  END IF;
  IF (SELECT customer_id FROM installed_assets WHERE id='60000000-0000-0000-0000-000000000001') <> '10000000-0000-0000-0000-000000000001'::uuid THEN
    RAISE EXCEPTION 'asset customer mismatch';
  END IF;
  IF (SELECT score FROM service_ratings WHERE job_id='40000000-0000-0000-0000-000000000001') <> 5 THEN
    RAISE EXCEPTION 'rating mismatch';
  END IF;
  IF (SELECT commission_rate FROM compensation_policies WHERE id='initial-margin-30') <> 0.3000 THEN
    RAISE EXCEPTION 'default compensation policy missing';
  END IF;
  IF (SELECT product_cost FROM order_costs WHERE order_id='30000000-0000-0000-0000-000000000001') <> 250 THEN
    RAISE EXCEPTION 'order costs missing';
  END IF;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO wallet_entries (technician_id, settlement_id, entry_type, amount, idempotency_key)
    VALUES ('20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'credit', 60, 'settlement:50000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'duplicate idempotency key was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;
