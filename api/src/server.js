import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import { query } from './db.js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
const SYSTEM_OPTIONS = [
  'Electrical',
  'DAQ',
  'Brakes',
  'Aero',
  'Chassis',
  'Suspension',
  'Powertrain',
  'Drivetrain',
  'Ergonomics',
  'Composites',
  'General'
];

app.use(cors());
app.use(express.json());

await ensureSchema();

app.get('/api/health', async (_req, res, next) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/locations', async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, area, notes
       FROM locations
       ORDER BY area, name`
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post('/api/locations', async (req, res, next) => {
  try {
    const location = normalizeLocation(req.body);
    const { rows } = await query(
      `INSERT INTO locations (name, area, notes)
       VALUES ($1, $2, $3)
       RETURNING id, name, area, notes`,
      [location.name, location.area, location.notes]
    );

    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/locations/:id', async (req, res, next) => {
  try {
    const location = normalizeLocation(req.body);
    const { rows } = await query(
      `UPDATE locations
       SET name = $1, area = $2, notes = $3
       WHERE id = $4
       RETURNING id, name, area, notes`,
      [location.name, location.area, location.notes, req.params.id]
    );

    if (!rows[0]) {
      res.status(404).json({ error: 'Location not found' });
      return;
    }

    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/locations/:id', async (req, res, next) => {
  try {
    const { rows } = await query(
      `DELETE FROM locations
       WHERE id = $1
       RETURNING id`,
      [req.params.id]
    );

    if (!rows[0]) {
      res.status(404).json({ error: 'Location not found' });
      return;
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.get('/api/items', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();
    const system = String(req.query.system || '').trim();
    const category = String(req.query.category || '').trim();

    const filters = [];
    const params = [];

    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      filters.push(`(
        lower(items.name) LIKE $${params.length}
        OR lower(items.system) LIKE $${params.length}
        OR lower(items.part_number) LIKE $${params.length}
        OR lower(items.manufacturer) LIKE $${params.length}
        OR lower(items.notes) LIKE $${params.length}
      )`);
    }

    if (system) {
      params.push(system);
      filters.push(`items.system = $${params.length}`);
    }

    if (category) {
      params.push(category);
      filters.push(`items.category = $${params.length}`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const { rows } = await query(
      `SELECT
        items.id,
        items.name,
        items.system,
        items.category,
        items.manufacturer,
        items.part_number,
        items.quantity,
        items.minimum_quantity,
        items.cost,
        items.unit,
        items.vendor_url,
        items.notes,
        items.location_id,
        locations.name AS location_name,
        locations.area AS location_area
       FROM items
       LEFT JOIN locations ON locations.id = items.location_id
       ${where}
       ORDER BY items.system, items.category, items.name`,
      params
    );

    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.get('/api/categories', async (_req, res, next) => {
  try {
    const system = String(_req.query.system || '').trim();
    const params = [];
    const where = system ? 'WHERE system = $1' : '';

    if (system) {
      params.push(system);
    }

    const { rows } = await query(
      `SELECT DISTINCT category
       FROM items
       ${where}
       ORDER BY category`,
      params
    );
    res.json(rows.map((row) => row.category));
  } catch (error) {
    next(error);
  }
});

app.get('/api/systems', async (_req, res, next) => {
  try {
    res.json(SYSTEM_OPTIONS);
  } catch (error) {
    next(error);
  }
});

app.get('/api/system-values', async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT
        system,
        COALESCE(SUM(quantity * cost), 0) AS value,
        COUNT(*)::int AS item_count
       FROM items
       GROUP BY system`
    );
    const values = new Map(
      rows.map((row) => [
        row.system,
        {
          system: row.system,
          value: Number(row.value),
          item_count: Number(row.item_count)
        }
      ])
    );

    res.json(
      SYSTEM_OPTIONS.map((system) => values.get(system) || {
        system,
        value: 0,
        item_count: 0
      })
    );
  } catch (error) {
    next(error);
  }
});

app.post('/api/items', async (req, res, next) => {
  try {
    const item = normalizeItem(req.body);
    item.locationId = await resolveLocationId(item);
    const { rows } = await query(
      `INSERT INTO items
        (name, system, category, manufacturer, part_number, quantity, minimum_quantity, cost, unit, location_id, vendor_url, notes)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULLIF($10, '')::uuid, $11, $12)
       RETURNING *`,
      [
        item.name,
        item.system,
        item.category,
        item.manufacturer,
        item.partNumber,
        item.quantity,
        item.minimumQuantity,
        item.cost,
        item.unit,
        item.locationId,
        item.vendorUrl,
        item.notes
      ]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/items/:id', async (req, res, next) => {
  try {
    const item = normalizeItem(req.body);
    item.locationId = await resolveLocationId(item);
    const { rows } = await query(
      `UPDATE items
       SET
        name = $1,
        system = $2,
        category = $3,
        manufacturer = $4,
        part_number = $5,
        quantity = $6,
        minimum_quantity = $7,
        cost = $8,
        unit = $9,
        location_id = NULLIF($10, '')::uuid,
        vendor_url = $11,
        notes = $12,
        updated_at = now()
       WHERE id = $13
       RETURNING *`,
      [
        item.name,
        item.system,
        item.category,
        item.manufacturer,
        item.partNumber,
        item.quantity,
        item.minimumQuantity,
        item.cost,
        item.unit,
        item.locationId,
        item.vendorUrl,
        item.notes,
        req.params.id
      ]
    );

    if (!rows[0]) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }

    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/items/:id/quantity', async (req, res, next) => {
  try {
    const quantity = Number(req.body.quantity);

    if (!Number.isInteger(quantity) || quantity < 0) {
      res.status(400).json({ error: 'Quantity must be a non-negative integer' });
      return;
    }

    const { rows } = await query(
      `UPDATE items
       SET quantity = $1, updated_at = now()
       WHERE id = $2
       RETURNING *`,
      [quantity, req.params.id]
    );

    if (!rows[0]) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }

    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/items/:id', async (req, res, next) => {
  try {
    const { rows } = await query(
      `DELETE FROM items
       WHERE id = $1
       RETURNING id`,
      [req.params.id]
    );

    if (!rows[0]) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  res.status(status).json({
    error: status === 500 ? 'Internal server error' : error.message
  });
});

app.listen(port, () => {
  console.log(`Inventory API listening on port ${port}`);
});

function normalizeItem(body) {
  const item = {
    name: String(body.name || '').trim(),
    system: normalizeSystem(body.system || 'General'),
    category: String(body.category || '').trim(),
    manufacturer: String(body.manufacturer || '').trim(),
    partNumber: String(body.partNumber || body.part_number || '').trim(),
    quantity: Number(body.quantity ?? 0),
    minimumQuantity: Number(body.minimumQuantity ?? body.minimum_quantity ?? 0),
    cost: Number(body.cost ?? 0),
    unit: String(body.unit || 'each').trim(),
    locationId: String(body.locationId || body.location_id || '').trim(),
    locationName: String(body.locationName || body.location_name || '').trim(),
    vendorUrl: String(body.vendorUrl || body.vendor_url || '').trim(),
    notes: String(body.notes || '').trim()
  };

  if (!item.name) {
    throw badRequest('Name is required');
  }

  if (!item.category) {
    throw badRequest('Category is required');
  }

  if (!item.system) {
    throw badRequest('System is required');
  }

  if (!Number.isInteger(item.quantity) || item.quantity < 0) {
    throw badRequest('Quantity must be a non-negative integer');
  }

  if (!Number.isInteger(item.minimumQuantity) || item.minimumQuantity < 0) {
    throw badRequest('Minimum quantity must be a non-negative integer');
  }

  if (!Number.isFinite(item.cost) || item.cost < 0) {
    throw badRequest('Cost must be a non-negative number');
  }

  return item;
}

function normalizeSystem(system) {
  const normalized = String(system || '').trim().toLowerCase();
  const matched = SYSTEM_OPTIONS.find((option) => option.toLowerCase() === normalized);

  if (!matched) {
    throw badRequest(`System must be one of: ${SYSTEM_OPTIONS.join(', ')}`);
  }

  return matched;
}

async function resolveLocationId(item) {
  if (item.locationId || !item.locationName) {
    return item.locationId;
  }

  const { rows } = await query(
    `INSERT INTO locations (name, area, notes)
     VALUES ($1, $2, '')
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [item.locationName, item.system || 'Shop']
  );

  return rows[0].id;
}

async function ensureSchema() {
  await query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS system text NOT NULL DEFAULT 'General'`);
  await query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS cost numeric(12, 2) NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS vendor_url text NOT NULL DEFAULT ''`);
  await query(`CREATE INDEX IF NOT EXISTS idx_items_system ON items (system)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_items_cost ON items (cost)`);
  await query(
    `UPDATE items
     SET system = CASE
       WHEN category IN ('Deutsch Connectors', 'Deutsch Contacts', 'PCB Components') THEN 'Electrical'
       WHEN system IN ('Aerodynamics') THEN 'Aero'
       WHEN system IN ('Controls') THEN 'DAQ'
       WHEN system IN ('Cooling') THEN 'Powertrain'
       WHEN system IN ('Steering') THEN 'Chassis'
       WHEN system IN ('Manufacturing', 'Tools') THEN 'General'
       WHEN category = 'Hardware' THEN 'General'
       ELSE 'General'
     END
     WHERE system NOT IN ('Electrical', 'DAQ', 'Brakes', 'Aero', 'Chassis', 'Suspension', 'Powertrain', 'Drivetrain', 'Ergonomics', 'Composites', 'General')
       OR category = 'Hardware'`
  );
  await query(
    `UPDATE items
     SET system = 'Electrical'
     WHERE category IN ('Deutsch Connectors', 'Deutsch Contacts', 'PCB Components')
       AND system = 'General'`
  );
  await query(`UPDATE items SET system = 'General' WHERE category = 'Hardware' AND system = 'Chassis'`);
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function normalizeLocation(body) {
  const location = {
    name: String(body.name || '').trim(),
    area: String(body.area || 'Shop').trim(),
    notes: String(body.notes || '').trim()
  };

  if (!location.name) {
    throw badRequest('Location name is required');
  }

  if (!location.area) {
    throw badRequest('Location area is required');
  }

  return location;
}
