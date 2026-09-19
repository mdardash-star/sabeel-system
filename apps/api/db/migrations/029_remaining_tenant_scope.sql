BEGIN;

-- Finish tenant partitioning for inventory, purchasing, marketing, conversations and AI.
-- Existing rows belong to the original Sabeel organization.
DO $$
DECLARE
  default_org uuid := '00000000-0000-4000-8000-000000000001';
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'inventory_items','warehouses','inventory_balances','technician_inventory','inventory_movements',
    'suppliers','purchase_orders','purchase_order_items',
    'customer_segments','marketing_campaigns','campaign_recipients','abandoned_carts','marketing_content',
    'marketing_touches','order_attribution','marketing_spend','customer_conversations','conversation_messages',
    'ai_knowledge_articles','ai_suggestions','ai_insights','ai_executive_briefs','ai_dispatch_recommendations',
    'ai_sales_opportunities','ai_marketing_recommendations','ai_finance_anomalies'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE RESTRICT', tbl);
    EXECUTE format('UPDATE %I SET organization_id = $1 WHERE organization_id IS NULL', tbl) USING default_org;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN organization_id SET NOT NULL', tbl);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN organization_id SET DEFAULT %L::uuid', tbl, default_org::text);
  END LOOP;
END $$;

-- Replace global uniqueness with tenant-scoped uniqueness.
ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_sku_key;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_org_sku_uq ON inventory_items (organization_id, sku);

ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_org_name_uq ON suppliers (organization_id, name);

ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_po_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_org_po_number_uq ON purchase_orders (organization_id, po_number);

ALTER TABLE customer_segments DROP CONSTRAINT IF EXISTS customer_segments_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS customer_segments_org_name_uq ON customer_segments (organization_id, name);

ALTER TABLE abandoned_carts DROP CONSTRAINT IF EXISTS abandoned_carts_external_source_external_cart_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS abandoned_carts_org_external_uq
  ON abandoned_carts (organization_id, external_source, external_cart_id);

ALTER TABLE marketing_content DROP CONSTRAINT IF EXISTS marketing_content_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS marketing_content_org_slug_uq ON marketing_content (organization_id, slug);

ALTER TABLE customer_conversations DROP CONSTRAINT IF EXISTS customer_conversations_channel_external_thread_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS customer_conversations_org_thread_uq
  ON customer_conversations (organization_id, channel, external_thread_id);

DROP INDEX IF EXISTS conversation_messages_external_idx;
CREATE UNIQUE INDEX IF NOT EXISTS conversation_messages_org_external_idx
  ON conversation_messages (organization_id, external_message_id)
  WHERE external_message_id IS NOT NULL;

ALTER TABLE ai_insights DROP CONSTRAINT IF EXISTS ai_insights_fingerprint_detected_on_key;
CREATE UNIQUE INDEX IF NOT EXISTS ai_insights_org_fingerprint_day_uq
  ON ai_insights (organization_id, fingerprint, detected_on);

ALTER TABLE ai_executive_briefs DROP CONSTRAINT IF EXISTS ai_executive_briefs_brief_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS ai_executive_briefs_org_date_uq
  ON ai_executive_briefs (organization_id, brief_date);

DROP INDEX IF EXISTS ai_dispatch_one_pending_idx;
CREATE UNIQUE INDEX IF NOT EXISTS ai_dispatch_org_one_pending_idx
  ON ai_dispatch_recommendations (organization_id, job_id)
  WHERE status = 'pending';

DROP INDEX IF EXISTS ai_sales_active_opportunity_idx;
CREATE UNIQUE INDEX IF NOT EXISTS ai_sales_org_active_opportunity_idx
  ON ai_sales_opportunities (organization_id, customer_id, opportunity_type)
  WHERE status IN ('new','approved','contacted');

DROP INDEX IF EXISTS ai_marketing_active_idx;
CREATE UNIQUE INDEX IF NOT EXISTS ai_marketing_org_active_idx
  ON ai_marketing_recommendations (organization_id, fingerprint)
  WHERE status IN ('new','approved','scheduled');

DROP INDEX IF EXISTS ai_finance_active_idx;
CREATE UNIQUE INDEX IF NOT EXISTS ai_finance_org_active_idx
  ON ai_finance_anomalies (organization_id, fingerprint)
  WHERE status IN ('open','reviewed');

-- Tenant-first indexes for common worklists and joins.
CREATE INDEX IF NOT EXISTS inventory_items_org_active_idx ON inventory_items (organization_id, is_active, name);
CREATE INDEX IF NOT EXISTS warehouses_org_active_idx ON warehouses (organization_id, is_active, city_id);
CREATE INDEX IF NOT EXISTS inventory_balances_org_idx ON inventory_balances (organization_id, warehouse_id, item_id);
CREATE INDEX IF NOT EXISTS technician_inventory_org_idx ON technician_inventory (organization_id, technician_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS inventory_movements_org_created_idx ON inventory_movements (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS suppliers_org_active_idx ON suppliers (organization_id, is_active, name);
CREATE INDEX IF NOT EXISTS purchase_orders_org_status_idx ON purchase_orders (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS marketing_campaigns_org_status_idx ON marketing_campaigns (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS abandoned_carts_org_recovery_idx ON abandoned_carts (organization_id, status, abandoned_at) WHERE status IN ('open','notified');
CREATE INDEX IF NOT EXISTS marketing_content_org_calendar_idx ON marketing_content (organization_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS marketing_touches_org_customer_idx ON marketing_touches (organization_id, customer_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS marketing_spend_org_period_idx ON marketing_spend (organization_id, spent_on, source);
CREATE INDEX IF NOT EXISTS customer_conversations_org_worklist_idx ON customer_conversations (organization_id, status, priority, last_message_at DESC);
CREATE INDEX IF NOT EXISTS ai_suggestions_org_worklist_idx ON ai_suggestions (organization_id, status, risk_level, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_insights_org_worklist_idx ON ai_insights (organization_id, status, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_dispatch_org_worklist_idx ON ai_dispatch_recommendations (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_sales_org_worklist_idx ON ai_sales_opportunities (organization_id, status, score DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_marketing_org_worklist_idx ON ai_marketing_recommendations (organization_id, status, priority, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_finance_org_worklist_idx ON ai_finance_anomalies (organization_id, status, severity, created_at DESC);

COMMIT;
