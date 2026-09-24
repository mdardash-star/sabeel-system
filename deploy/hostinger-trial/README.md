# Isolated Hostinger VPS trial

This stack tests the four SUBIL services against a **new, empty** PostgreSQL
database. It does not import customer data, configure live OTP or WooCommerce
webhooks, alter DNS, or change the running Render services.

## Requirements

- A Hostinger VPS with Docker Engine and the Compose plugin.
- SSH access to the VPS and a checkout of this repository's `trial/hostinger-vps` branch.
- Enough disk and memory to build three Next.js apps, preferably at least 8 GB RAM.

From this directory, copy `trial.env.example` to `trial.env` and fill both
values with separate outputs of `openssl rand -hex 32`. Do not commit
`trial.env`. Then run:

```sh
docker compose --env-file trial.env -f compose.yaml config --quiet
docker compose --env-file trial.env -f compose.yaml build api
docker compose --env-file trial.env -f compose.yaml build admin
docker compose --env-file trial.env -f compose.yaml build technician
docker compose --env-file trial.env -f compose.yaml build mobile
docker compose --env-file trial.env -f compose.yaml up -d
docker compose --env-file trial.env -f compose.yaml ps
curl --fail http://127.0.0.1:3001/ready
```

The app ports bind only to the VPS loopback interface. To inspect them from
your computer, open an SSH tunnel (replace `USER` and `VPS_IP`):

```sh
ssh -L 3001:127.0.0.1:3001 -L 3002:127.0.0.1:3002 \
    -L 3003:127.0.0.1:3003 -L 3004:127.0.0.1:3004 USER@VPS_IP
```

Open `http://127.0.0.1:3002` (admin), `:3003` (technician), and `:3004`
(customer). The trial API runs on `:3001`. Login OTP is deliberately unavailable
until a real sender is configured. The customer app can still fetch the public
WooCommerce catalog; do not place a real order during infrastructure testing.

This trial uses plain HTTP only inside the SSH tunnel. A public launch requires
HTTPS domains, provider secrets, database backup and restoration verification,
and a controlled migration and cutover of production data. Do not point the
production WooCommerce webhook or DNS to this trial.
