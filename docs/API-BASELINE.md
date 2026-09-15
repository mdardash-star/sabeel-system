# SUBIL OS — API Baseline

Base prefix: `/api/v1`

## Identity
- POST `/auth/otp/request`
- POST `/auth/otp/verify`
- POST `/auth/logout`
- GET `/me`

## Customers / CRM
- GET/POST `/customers`
- GET/PATCH `/customers/:id`
- GET/POST `/customers/:id/addresses`
- GET `/customers/:id/timeline`
- GET `/customers/:id/assets`

## Commerce
- GET `/catalog/products`
- POST `/orders/import/woocommerce`
- GET `/orders/:id`

## Field Service
- GET/POST `/jobs`
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

## Finance
- GET/POST `/costs`
- GET/POST `/compensation-policies`
- GET `/technicians/:id/accruals`
- POST `/settlements`
- POST `/settlements/:id/approve` — finance-authorized PostgreSQL transaction that approves once, credits the technician wallet idempotently, and writes an audit event

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
