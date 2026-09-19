# ADR-001 — Initial Platform Stack

Status: Accepted for foundation phase.

## Decision
SUBIL OS will use a TypeScript monorepo with clear application boundaries.

- Web/Admin: Next.js
- Customer mobile and technician mobile: Expo/React Native
- Backend/API: Node.js TypeScript service
- Database: PostgreSQL
- Cache/queues: Redis
- Object/media storage: S3-compatible storage
- Contracts: shared typed package
- CI: GitHub Actions

## Principles
1. API-first and modular.
2. No production writes from experimental code.
3. Every sensitive action is auditable.
4. Integrations use adapters.
5. AI agents cannot bypass permissions or approval policies.
6. WordPress/WooCommerce is treated as an integration source during migration, not as the long-term core database.

## Migration strategy
The existing store remains live. SUBIL OS is built and tested separately, then WooCommerce data is synchronized through a bridge until cutover is explicitly approved.