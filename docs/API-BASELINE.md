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
- GET `/technician/me/schedule`
- GET `/technician/me/jobs/:id`
- GET `/technician/me/wallet`

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