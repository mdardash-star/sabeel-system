# Render deployment

The repository includes `render.yaml` for a Render Blueprint deployment containing:

- PostgreSQL database: `subil-postgres`
- API web service: `subil-api`
- Admin web service: `subil-admin`

The API applies pending database migrations before every start. The migration runner uses an advisory lock and records applied files in `schema_migrations`, so parallel starts do not apply the same migration twice.

Required secrets during initial Blueprint setup:

- `OTP_SENDER_URL`
- `OTP_SENDER_API_KEY`

Optional push notification secrets (provide all three together or leave all three unset):

- `PUSH_PROVIDER_URL`
- `PUSH_PROVIDER_API_KEY`
- `PUSH_VAPID_PUBLIC_KEY`

`OTP_HASH_SECRET` is generated automatically by Render. `DATABASE_URL`, the admin origin, and the public API URL are linked automatically between Blueprint resources.

After deployment, verify:

1. `subil-api` health check returns HTTP 200 at `/health`.
2. `subil-admin` loads and can reach the API.
3. OTP request and verification work with the configured provider.
4. Login redirects to the administration dashboard.
5. A paid service order can create a service job in the correct organization.
