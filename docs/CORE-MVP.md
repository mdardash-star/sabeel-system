# SUBIL OS Core MVP

## First executable slice
The first implementation slice connects these domains without touching the live store:

1. Identity: mobile-first user identity and roles.
2. CRM: customer profile and service locations.
3. Commerce bridge: ingest paid WooCommerce orders through an idempotent adapter.
4. Field Service: create a service job, assign technician, schedule internally, and enforce workflow states.
5. Evidence: require completion evidence according to job policy.
6. Notifications: emit events for assignment, en-route, completion, rating and maintenance reminders.
7. Finance: calculate technician settlement from pre-VAT margin using configurable policies.
8. Audit: record sensitive state changes and actor identity.

## Technician workflow
pending_assignment -> assigned -> scheduled -> en_route -> arrived -> in_progress -> completed

The technician interface must not expose the customer's phone number. Navigation uses the service location. Completion can require image/video evidence. Completion emits rating and finance events.

## Compensation policy
Support fixed-per-job and margin-percentage modes. Percentage progression is policy data, not hard-coded business logic. The initial business policy may start at 30 percent, increase by 5 percentage points when approved performance criteria are met, and cap at 50 percent.

## Safety gates
- No deployment from feature work directly to production.
- No secrets committed to Git.
- WooCommerce webhook ingestion must be authenticated and idempotent.
- Financial recalculation must retain the source inputs and policy version.
- AI actions use the same RBAC and audit controls as human actions.
