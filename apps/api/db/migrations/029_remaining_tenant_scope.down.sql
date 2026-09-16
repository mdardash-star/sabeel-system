BEGIN;

DROP INDEX IF EXISTS ai_finance_org_worklist_idx;
DROP INDEX IF EXISTS ai_marketing_org_worklist_idx;
DROP INDEX IF EXISTS ai_sales_org_worklist_idx;
DROP INDEX IF EXISTS ai_dispatch_org_worklist_idx;
DROP INDEX IF EXISTS ai_insights_org_worklist_idx;
DROP INDEX IF EXISTS ai_suggestions_org_worklist_idx;
DROP INDEX IF EXISTS customer_conversations_org_worklist_idx;
DROP INDEX IF EXISTS marketing_spend_org_period_idx;
DROP INDEX IF EXISTS marketing_touches_org_customer_idx;
DROP INDEX IF EXISTS marketing_content_org_calendar_idx;
DROP INDEX IF EXISTS abandoned_carts_org_recovery_idx;
DROP INDEX IF EXISTS marketing_campaigns_org_status_idx;
DROP INDEX IF EXISTS purchase_orders_org_status_idx;
DROP INDEX IF EXISTS suppliers_org_active_idx;
DROP INDEX IF EXISTS inventory_movements_org_created_idx;
DROP INDEX IF EXISTS technician_inventory_org_idx;
DROP INDEX IF EXISTS inventory_balances_org_idx;
DROP INDEX IF EXISTS warehouses_org_active_idx;
DROP INDEX IF EXISTS inventory_items_org_active_idx;

DROP INDEX IF EXISTS ai_finance_org_active_idx;
CREATE UNIQUE INDEX IF NOT EXISTS ai_finance_active_idx ON ai_finance_anomalies(fingerprint) WHERE status IN ('open','reviewed');
DROP INDEX IF EXISTS ai_marketing_org_active_idx;
CREATE UNIQUE INDEX IF NOT EXISTS ai_marketing_active_idx ON ai_marketing_recommendations(fingerprint) WHERE status IN ('new','approved','scheduled');
DROP INDEX IF EXISTS ai_sales_org_active_opportunity_idx;
CREATE UNIQUE INDEX IF NOT EXISTS ai_sales_active_opportunity_idx ON ai_sales_opportunities(customer_id,opportunity_type) WHERE status IN ('new','approved','contacted');
DROP INDEX IF EXISTS ai_dispatch_org_one_pending_idx;
CREATE UNIQUE INDEX IF NOT EXISTS ai_dispatch_one_pending_idx ON ai_dispatch_recommendations(job_id) WHERE status='pending';

DROP INDEX IF EXISTS ai_executive_briefs_org_date_uq;
ALTER TABLE ai_executive_briefs ADD CONSTRAINT ai_executive_briefs_brief_date_key UNIQUE (brief_date);
DROP INDEX IF EXISTS ai_insights_org_fingerprint_day_uq;
ALTER TABLE ai_insights ADD CONSTRAINT ai_insights_fingerprint_detected_on_key UNIQUE (fingerprint,detected_on);

DROP INDEX IF EXISTS conversation_messages_org_external_idx;
CREATE UNIQUE INDEX IF NOT EXISTS conversation_messages_external_idx ON conversation_messages (external_message_id) WHERE external_message_id IS NOT NULL;
DROP INDEX IF EXISTS customer_conversations_org_thread_uq;
ALTER TABLE customer_conversations ADD CONSTRAINT customer_conversations_channel_external_thread_id_key UNIQUE (channel,external_thread_id);
DROP INDEX IF EXISTS marketing_content_org_slug_uq;
ALTER TABLE marketing_content ADD CONSTRAINT marketing_content_slug_key UNIQUE (slug);
DROP INDEX IF EXISTS abandoned_carts_org_external_uq;
ALTER TABLE abandoned_carts ADD CONSTRAINT abandoned_carts_external_source_external_cart_id_key UNIQUE (external_source,external_cart_id);
DROP INDEX IF EXISTS customer_segments_org_name_uq;
ALTER TABLE customer_segments ADD CONSTRAINT customer_segments_name_key UNIQUE (name);
DROP INDEX IF EXISTS purchase_orders_org_po_number_uq;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_po_number_key UNIQUE (po_number);
DROP INDEX IF EXISTS suppliers_org_name_uq;
ALTER TABLE suppliers ADD CONSTRAINT suppliers_name_key UNIQUE (name);
DROP INDEX IF EXISTS inventory_items_org_sku_uq;
ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_sku_key UNIQUE (sku);

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'ai_finance_anomalies','ai_marketing_recommendations','ai_sales_opportunities','ai_dispatch_recommendations',
    'ai_executive_briefs','ai_insights','ai_suggestions','ai_knowledge_articles','conversation_messages','customer_conversations',
    'marketing_spend','order_attribution','marketing_touches','marketing_content','abandoned_carts','campaign_recipients',
    'marketing_campaigns','customer_segments','purchase_order_items','purchase_orders','suppliers','inventory_movements',
    'technician_inventory','inventory_balances','warehouses','inventory_items'
  ] LOOP
    EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS organization_id', tbl);
  END LOOP;
END $$;

COMMIT;
