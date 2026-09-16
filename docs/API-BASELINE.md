# SUBIL OS — API Baseline

Base prefix: `/api/v1`

Persistent application routes require `Authorization: Bearer <session-token>`. The server resolves user ID and role from the hashed, active PostgreSQL session; client-supplied identity headers are not trusted.

## Identity
- POST `/auth/otp/request`
- POST `/auth/otp/verify`
- POST `/auth/logout`
- GET `/me`

OTP uses normalized Saudi E.164 mobile numbers (`+9665XXXXXXXX`), six-digit codes, a five-minute expiry, a one-minute resend cooldown, and five verification attempts. Codes are stored only as keyed hashes. Successful verification consumes the challenge and creates a hashed 30-day session. Unknown mobile numbers create a customer identity automatically; inactive users remain blocked. The SMS provider is configured through `OTP_SENDER_URL` and `OTP_SENDER_API_KEY`.

## Customers / CRM
- GET/POST `/customers`
- GET `/customers/stats`
- GET/PATCH `/customers/:id`
- GET/POST `/customers/:id/addresses`
- GET `/customers/:id/timeline?limit=20&offset=0`
- GET/POST `/customers/:id/assets`
- GET `/customers/:id/assets/:assetId/history`
- POST `/customers/:id/assets/:assetId/maintenance`
- PATCH `/customers/:id/assets/:assetId`
- GET `/customers/:id/orders`
- GET `/customers/:id/jobs?limit=20&offset=0` — paginated service history with order, location, technician assignment and verified customer rating

## Commerce
- GET `/catalog/products`
- POST `/orders/import/woocommerce`
- GET `/orders/:id`

## Field Service
- GET/POST `/jobs`
- GET `/jobs?status=all|open|pending_assignment|scheduled|active|overdue|completed|cancelled&q=&limit=20&offset=0` — operations worklist ordered by assignment and SLA urgency
- GET `/jobs/stats` — open, unassigned, scheduled, active, overdue and completed-today counters
- GET `/jobs/:id/candidates?from=<ISO>&to=<ISO>&limit=10` — eligible technicians ranked by distance, workload and rating
- POST `/jobs/:id/assign` — validates city, skill, availability and schedule conflicts before audited assignment
- POST `/jobs/:id/reassign` — requires a reason and preserves the previous assignment in the audit log
- GET `/jobs/escalations?status=open|resolved|all&limit=20&offset=0` — prioritized SLA escalation queue
- GET `/jobs/escalations/stats` — open escalation counters by severity and resolved-today count
- POST `/jobs/escalations/run` — idempotently detects late active jobs at level 1 (under two hours), level 2 (two hours) or level 3 (four hours)
- POST `/jobs/:id/escalations/resolve` — resolves every open escalation for a job with a required reason and audit record
- GET/PATCH `/jobs/:id`
- POST `/jobs/:id/assign`
- POST `/jobs/:id/schedule`
- POST `/jobs/:id/events/en-route`
- POST `/jobs/:id/events/arrived`
- POST `/jobs/:id/events/start`
- POST `/jobs/:id/evidence`
- POST `/jobs/:id/complete`
- POST `/jobs/:id/close`
- POST `/jobs/:id/rating`

## Technician
- GET `/technicians?status=all|active|inactive&q=&limit=20&offset=0` — operations roster with skills, current workload, 30-day completion, punctuality and verified rating metrics
- GET `/technicians/stats` — total, active, inactive, available-now, busy-now and verified-rating counters
- GET `/technicians/:id/performance?from=<ISO>&to=<ISO>` — bounded performance, payout totals and ten most recent jobs; defaults to 30 days and allows up to 366 days
- PATCH `/technicians/:id/status` — branch-manager/admin activation or reason-required deactivation with an audit record
- GET `/technicians/me/jobs?from=<ISO>&to=<ISO>`
- GET `/technicians/me/jobs/:id` — returns the assigned job only; another technician's job returns `404`
- PATCH `/technicians/me/jobs/:id/status` — persists a valid technician workflow transition and audit event; completion uses the evidence endpoint
- POST `/technicians/me/jobs/:id/complete` — atomically saves evidence, completes the owned job, and creates a pending settlement from server-side order costs and compensation policy
- GET `/technicians/me/wallet?limit=20&offset=0` — PostgreSQL-backed balance and paginated ledger scoped to the signed-in technician

The signed-in user is resolved to an active technician profile server-side. Job lists are read from PostgreSQL and expose operational location fields only; customer contact fields are never selected.

## Assets / Maintenance
- GET/POST `/assets`
- GET `/assets/:id/history`
- GET/POST `/maintenance/plans`
- POST `/maintenance/reminders/run`
- GET `/maintenance/stats` — active, overdue and upcoming maintenance counters
- GET `/maintenance/assets?window=overdue|7d|30d|all&q=&limit=20&offset=0` — searchable paginated maintenance worklist

## Finance
- GET/POST `/costs`
- GET/POST `/compensation-policies`
- GET `/technicians/:id/accruals`
- POST `/settlements`
- GET `/settlements?status=all|pending_approval|approved|rejected|paid&q=&limit=20&offset=0` — searchable finance worklist with order margin, policy and technician payout inputs
- GET `/settlements/stats` — approval counts and pending, approved and paid-this-month amounts
- POST `/settlements/:id/approve` — finance-authorized PostgreSQL transaction that approves once, credits the technician wallet idempotently, and writes an audit event
- POST `/settlements/:id/reject` — reason-required finance rejection with an audit event
- POST `/settlements/:id/paid` — records an external payment reference, closes the settlement and marks its wallet credit paid atomically

## Inventory
- GET `/inventory?status=all|low|out&q=&limit=20&offset=0` — stock by item across warehouses with reorder state and technician-held quantity
- GET `/inventory/stats` — SKU, unit, value, low-stock and out-of-stock counters
- GET `/inventory/movements?limit=20&offset=0` — auditable receipt, transfer and technician issue ledger
- GET `/technicians/:id/inventory` — current positive stock held by one technician
- POST `/inventory/items` — creates a uniquely identified SKU with unit, cost and reorder threshold
- POST `/inventory/receive` — atomically receives stock and updates the item's latest operational unit cost
- POST `/inventory/transfer` — atomically moves stock between different active warehouses without allowing a negative balance
- POST `/inventory/technician-issue` — atomically deducts warehouse stock and credits the active technician's custody

## Purchasing
- GET `/purchasing/stats` — open, approval, receipt, overdue and value counters
- GET `/purchasing/suppliers?q=&limit=20&offset=0` — active suppliers with order count and spend
- POST `/purchasing/suppliers` — creates a supplier with an audit record
- GET `/purchasing/orders?status=all|draft|approved|partially_received|received|cancelled|overdue&q=&limit=20&offset=0` — searchable orders with receipt progress and line details
- POST `/purchasing/orders` — creates a costed multi-line draft purchase order
- POST `/purchasing/orders/:id/approve` — approves a draft order
- POST `/purchasing/orders/:id/receive` — atomically records partial or complete receipt, updates item cost and warehouse balance, and prevents over-receipt

## Notifications
- POST `/notifications/events`
- GET `/notifications/deliveries/:id`

## Integration Webhooks
- POST `/webhooks/woocommerce`
- POST `/webhooks/payments/:provider`
- POST `/webhooks/messaging/:provider`

## API rules
- JSON only for application APIs.
- Idempotency keys required for payment, webhook and state-changing integration endpoints.
- RBAC enforced server-side.
- Technician API returns only customer data required to perform the assigned job.
- Pagination is mandatory for collection endpoints.
- Versioned event schemas are used for asynchronous workflows.
- External provider secrets are never returned by APIs.
