# FSAE Inventory Management

Shop-friendly inventory software for FSAE parts: Deutsch connectors, autosport wiring, PCB components, hardware, consumables, and tooling.

## Run With Docker

Install Docker Desktop on the shop PC, then run:

```bash
docker compose up --build
```

Open:

- Web UI: http://localhost:5173
- API health: http://localhost:3000/api/health
- PostgreSQL: localhost:5432, bound to the shop PC only

The web app uses local user accounts before showing inventory. On the first run, the API creates an admin user from environment variables. The Docker defaults are:

- Username: `admin`
- Password: `owls_racing_shop`

Before putting it on the shop network, create a `.env` file next to `docker-compose.yml`:

```bash
cp .env.example .env
```

Then edit `.env` and set a real `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `AUTH_TOKEN_SECRET`.

Roles:

- `admin`: manage users, add/edit/delete inventory
- `member`: add/edit inventory and adjust quantity
- `viewer`: read-only lookup

Inventory edits are logged to item history with the signed-in user and timestamp.

The default database credentials are intended for local shop use only, and the database port is only bound to `127.0.0.1`:

- Database: `fsae_inventory`
- User: `fsae`
- Password: `fsae_dev_password`

To open the app from another device on the same Wi-Fi or LAN, use:

```text
http://SHOP_PC_IP:5173
```

Only the web port should be reachable from other devices. The raw API and database ports are kept local to the shop PC.

## Project Layout

```text
.
├── api/                 Express API connected to PostgreSQL
├── db/                  Database schema and seed data
├── web/                 React web UI
└── docker-compose.yml   One-command local runtime
```

## Useful Commands

```bash
docker compose up --build
docker compose down
docker compose down --volumes
```

Use `docker compose down --volumes` only when you want to delete the local database data.
# inventorymanagement
