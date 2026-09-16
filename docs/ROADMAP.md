# SUBIL OS — Implementation Roadmap

## Phase 0 — Foundation
- Repository structure and branch policy
- Architecture decisions
- Environment separation
- CI checks
- configuration/secrets policy
- audit/event conventions

## Phase 1 — Core MVP
- Identity / OTP abstraction
- users, roles, permissions
- customer profile
- order ingestion / WooCommerce bridge
- cities, branches, technicians
- jobs and internal scheduling
- technician workflow states
- media evidence
- customer rating
- notification events
- finance: cost, margin, technician compensation

## Phase 2 — Operations
- maintenance plans and reminders
- warranties/assets installed at customer sites
- dispatch rules
- SLA and escalation
- technician performance and automatic commission policy
- dashboards and reports

## Phase 3 — Inventory & Finance
- warehouses and stock movements
- purchasing and suppliers
- technician stock
- profitability by product/order/city/channel
- settlements and approvals

## Phase 4 — Marketing & Social
- content calendar
- social connectors supported by official APIs
- SEO workflow
- abandoned cart automation
- campaigns, attribution, segments
- unified customer conversation where integrations permit

## Phase 5 — AI
- AI customer care with knowledge + CRM context
- AI sales assistant
- AI marketing agent
- AI dispatch recommendations
- AI finance/anomaly insights
- executive daily brief
- approvals, guardrails and full auditability

## Phase 6 — Apps & Scale
- customer mobile app
- technician mobile app
- push notifications
- offline technician mode
- multi-tenant readiness

Multi-tenant readiness starts with an active organization bound to every user and resolved exclusively from the authenticated session. Request headers cannot select or override the tenant. Customer and technician self-service profile resolution is tenant constrained. Customer CRM and technician management reads and mutations are tenant constrained. Remaining jobs, finance, inventory and marketing tables still require tenant partitioning and tenant-scoped unique constraints before hosting another organization.

## Release rule
No feature reaches production until tested outside the live store and reviewed for migration, rollback, permissions and data safety.
