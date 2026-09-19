# Deployment readiness status

Primary target: Render Blueprint (`render.yaml`).
Fallback target: Railway (`railway.json`).

Vercel is not used as the deployment gate because its current failure is a build-rate-limit account restriction rather than a verified application build failure.
Replit publishing is also unavailable on the connected account because usage-based services are disabled.

The repository is therefore prepared for Render as the primary production path, with Railway as a fallback.
