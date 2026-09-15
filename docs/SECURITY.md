# SUBIL OS — Security & Deployment Guardrails

## Environments
- Production: live customer environment; protected from experimental deployment.
- Staging: production-like validation and migration rehearsal.
- Development: active engineering work.

## Identity
- OTP codes expire quickly and are stored hashed, never plaintext.
- Request and verification rate limits are mandatory.
- Admin accounts require stronger authentication than customer OTP.
- Sessions can be revoked.
- Persistent API routes accept a Bearer session token only. Raw tokens are never stored; PostgreSQL stores a SHA-256 hash and rejects expired, revoked, or inactive-user sessions.
- Client-supplied role and user ID headers are ignored by persistent technician and finance routes.

## Authorization
- Deny by default.
- Roles do not replace server-side resource ownership checks.
- Technician access is limited to assigned jobs and required operational fields.

## Secrets
- No API keys, passwords, tokens or provider secrets in Git.
- Secrets are environment variables / managed secrets.
- `.env.example` contains names only, never real values.

## Data
- Encrypt transport with TLS.
- Minimize customer data exposed to integrations and technicians.
- Record consent by purpose/channel for marketing communications.
- Maintain audit events for permission, financial, settlement, scheduling and AI actions.

## Media evidence
- Uploads use signed/authorized access.
- Validate content type and size server-side.
- Evidence retention is configurable.

## Deployment gates
Before production: automated tests, migration rehearsal, backup verification, rollback plan, permissions review, smoke test and explicit production approval.

## AI
AI may draft and recommend broadly, but financial transfers, permission changes, irreversible actions, and externally published content can require human approval according to policy.
