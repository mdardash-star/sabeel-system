# Render hardening

- Runtime is pinned to Node 20 for reproducible builds.
- Admin builds explicitly include devDependencies because TypeScript and @types packages are required by Next.js build.
- API readiness is exposed through `/health` and `/ready`.
- Production API remains fail-closed until DATABASE_URL and OTP provider credentials are configured.
