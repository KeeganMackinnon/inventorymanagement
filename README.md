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
- PostgreSQL: localhost:5432

The default database credentials are intended for local shop use only:

- Database: `fsae_inventory`
- User: `fsae`
- Password: `fsae_dev_password`

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
