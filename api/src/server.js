import cors from 'cors';
import crypto from 'crypto';
import dotenv from 'dotenv';
import express from 'express';
import { query } from './db.js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
const inventoryPassword = String(process.env.INVENTORY_PASSWORD || '').trim();
const authSecret = String(process.env.AUTH_TOKEN_SECRET || inventoryPassword || 'inventory-dev-secret');
const defaultAdminUsername = String(process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
const defaultAdminName = String(process.env.ADMIN_NAME || 'Owls Racing Admin').trim();
const defaultAdminPassword = String(process.env.ADMIN_PASSWORD || inventoryPassword || 'owls_racing_shop');
const failedLogins = new Map();
const USER_ROLES = ['admin', 'member', 'viewer'];
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
await ensureAdminUser();

app.post('/api/login', async (req, res, next) => {
  const clientKey = req.ip || req.socket.remoteAddress || 'unknown';
  const failure = failedLogins.get(clientKey);

  try {
    if (failure && failure.count >= 10 && Date.now() - failure.lastFailedAt < 15 * 60 * 1000) {
      res.status(429).json({ error: 'Too many failed login attempts. Try again in a few minutes.' });
      return;
    }

    const username = String(req.body.username || defaultAdminUsername).trim().toLowerCase();
    const password = String(req.body.password || '');
    const { rows } = await query(
      `SELECT id, name, username, password_hash, role
       FROM users
       WHERE username = $1`,
      [username]
    );
    const user = rows[0];

    if (!user || !verifyPassword(password, user.password_hash)) {
      const current = failedLogins.get(clientKey) || { count: 0, lastFailedAt: 0 };
      failedLogins.set(clientKey, {
        count: current.count + 1,
        lastFailedAt: Date.now()
      });
      res.status(401).json({ error: 'Incorrect username or password' });
      return;
    }

    failedLogins.delete(clientKey);
    res.json({
      token: makeAuthToken(user),
      user: publicUser(user)
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/health', async (_req, res, next) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.use('/api', requireAuth);

app.get('/api/me', (req, res) => {
  res.json({ user: req.user });
});

app.get('/api/users', requireRole('admin'), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, username, role, created_at
       FROM users
       ORDER BY name, username`
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post('/api/users', requireRole('admin'), async (req, res, next) => {
  try {
    const user = normalizeUser(req.body);
    const { rows } = await query(
      `INSERT INTO users (name, username, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, username, role, created_at`,
      [user.name, user.username, hashPassword(user.password), user.role]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      next(badRequest('Username already exists'));
      return;
    }

    next(error);
  }
});

app.patch('/api/users/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const update = normalizeUserUpdate(req.body);
    const existing = await getUserById(req.params.id);

    if (!existing) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (existing.id === req.user.id && update.role && update.role !== 'admin') {
      res.status(400).json({ error: 'You cannot remove your own admin role' });
      return;
    }

    if (existing.role === 'admin' && update.role && update.role !== 'admin') {
      const adminCount = await getAdminCount();

      if (adminCount <= 1) {
        res.status(400).json({ error: 'At least one admin is required' });
        return;
      }
    }

    const { rows } = await query(
      `UPDATE users
       SET
        name = COALESCE($1, name),
        username = COALESCE($2, username),
        role = COALESCE($3, role),
        password_hash = COALESCE($4, password_hash),
        updated_at = now()
       WHERE id = $5
       RETURNING id, name, username, role, created_at`,
      [
        update.name,
        update.username,
        update.role,
        update.password ? hashPassword(update.password) : null,
        req.params.id
      ]
    );

    res.json(rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      next(badRequest('Username already exists'));
      return;
    }

    next(error);
  }
});

app.delete('/api/users/:id', requireRole('admin'), async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) {
      res.status(400).json({ error: 'You cannot delete your own user' });
      return;
    }

    const existing = await getUserById(req.params.id);

    if (!existing) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (existing.role === 'admin') {
      const adminCount = await getAdminCount();

      if (adminCount <= 1) {
        res.status(400).json({ error: 'At least one admin is required' });
        return;
      }
    }

    await query(`DELETE FROM users WHERE id = $1`, [req.params.id]);
    res.status(204).send();
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

app.post('/api/locations', requireRole('member'), async (req, res, next) => {
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

app.patch('/api/locations/:id', requireRole('member'), async (req, res, next) => {
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

app.delete('/api/locations/:id', requireRole('admin'), async (req, res, next) => {
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

app.post('/api/items', requireRole('member'), async (req, res, next) => {
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
    await recordItemEvent({
      itemId: rows[0].id,
      itemName: rows[0].name,
      userId: req.user.id,
      eventType: 'created',
      beforeData: null,
      afterData: rows[0]
    });
    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.get('/api/items/:id/events', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT
        item_events.id,
        item_events.item_id,
        item_events.item_name,
        item_events.event_type,
        item_events.before_data,
        item_events.after_data,
        item_events.created_at,
        users.name AS user_name,
        users.username AS username
       FROM item_events
       LEFT JOIN users ON users.id = item_events.user_id
       WHERE item_events.item_id = $1
       ORDER BY item_events.created_at DESC
       LIMIT 50`,
      [req.params.id]
    );

    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/items/:id', requireRole('member'), async (req, res, next) => {
  try {
    const item = normalizeItem(req.body);
    item.locationId = await resolveLocationId(item);
    const before = await getItemById(req.params.id);

    if (!before) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }

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

    await recordItemEvent({
      itemId: rows[0].id,
      itemName: rows[0].name,
      userId: req.user.id,
      eventType: 'updated',
      beforeData: before,
      afterData: rows[0]
    });
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/items/:id/quantity', requireRole('member'), async (req, res, next) => {
  try {
    const quantity = Number(req.body.quantity);

    if (!Number.isInteger(quantity) || quantity < 0) {
      res.status(400).json({ error: 'Quantity must be a non-negative integer' });
      return;
    }

    const before = await getItemById(req.params.id);

    if (!before) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }

    const { rows } = await query(
      `UPDATE items
       SET quantity = $1, updated_at = now()
       WHERE id = $2
       RETURNING *`,
      [quantity, req.params.id]
    );

    await recordItemEvent({
      itemId: rows[0].id,
      itemName: rows[0].name,
      userId: req.user.id,
      eventType: 'quantity_changed',
      beforeData: before,
      afterData: rows[0]
    });
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/items/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const before = await getItemById(req.params.id);

    if (!before) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }

    await recordItemEvent({
      itemId: before.id,
      itemName: before.name,
      userId: req.user.id,
      eventType: 'deleted',
      beforeData: before,
      afterData: null
    });

    const { rows } = await query(
      `DELETE FROM items
       WHERE id = $1
       RETURNING id`,
      [req.params.id]
    );

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
  await query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS system text NOT NULL DEFAULT 'General'`);
  await query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS cost numeric(12, 2) NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS vendor_url text NOT NULL DEFAULT ''`);
  await query(`CREATE INDEX IF NOT EXISTS idx_items_system ON items (system)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_items_cost ON items (cost)`);
  await query(
    `CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      username text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      role text NOT NULL DEFAULT 'member',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (role IN ('admin', 'member', 'viewer'))
    )`
  );
  await query(`CREATE INDEX IF NOT EXISTS idx_users_username ON users (username)`);
  await query(
    `CREATE TABLE IF NOT EXISTS item_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      item_id uuid REFERENCES items(id) ON DELETE SET NULL,
      item_name text NOT NULL DEFAULT '',
      user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      event_type text NOT NULL,
      before_data jsonb,
      after_data jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )`
  );
  await query(`CREATE INDEX IF NOT EXISTS idx_item_events_item_id ON item_events (item_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_item_events_created_at ON item_events (created_at DESC)`);
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

async function ensureAdminUser() {
  const { rows } = await query(`SELECT COUNT(*)::int AS count FROM users`);

  if (rows[0].count > 0) {
    return;
  }

  await query(
    `INSERT INTO users (name, username, password_hash, role)
     VALUES ($1, $2, $3, 'admin')`,
    [defaultAdminName || 'Owls Racing Admin', defaultAdminUsername || 'admin', hashPassword(defaultAdminPassword)]
  );
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function requireAuth(req, res, next) {
  const authorization = String(req.headers.authorization || '');
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const user = verifyAuthToken(token);

  if (!user) {
    res.status(401).json({ error: 'Login required' });
    return;
  }

  req.user = user;
  next();
}

function requireRole(minimumRole) {
  return (req, res, next) => {
    if (!hasRole(req.user?.role, minimumRole)) {
      res.status(403).json({ error: 'You do not have permission for that action' });
      return;
    }

    next();
  };
}

function hasRole(role, minimumRole) {
  const rank = {
    viewer: 1,
    member: 2,
    admin: 3
  };

  return (rank[role] || 0) >= (rank[minimumRole] || 0);
}

function makeAuthToken(user) {
  const payload = {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    exp: Date.now() + 1000 * 60 * 60 * 12
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = signTokenBody(body);

  return `${body}.${signature}`;
}

function verifyAuthToken(token) {
  const [body, signature] = String(token || '').split('.');

  if (!body || !signature || !timingSafeEqual(signature, signTokenBody(body))) {
    return null;
  }

  try {
    const user = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));

    if (!user.id || !user.username || !USER_ROLES.includes(user.role) || Date.now() > user.exp) {
      return null;
    }

    return publicUser(user);
  } catch {
    return null;
  }
}

function signTokenBody(body) {
  return crypto.createHmac('sha256', authSecret).update(body).digest('base64url');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('base64url');

  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, passwordHash) {
  const [algorithm, salt, expectedHash] = String(passwordHash || '').split('$');

  if (algorithm !== 'scrypt' || !salt || !expectedHash) {
    return false;
  }

  const actualHash = crypto.scryptSync(String(password), salt, 64).toString('base64url');

  return timingSafeEqual(actualHash, expectedHash);
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role
  };
}

function normalizeUser(body) {
  const user = {
    name: String(body.name || '').trim(),
    username: String(body.username || '').trim().toLowerCase(),
    password: String(body.password || ''),
    role: String(body.role || 'member').trim().toLowerCase()
  };

  if (!user.name) {
    throw badRequest('Name is required');
  }

  if (!user.username) {
    throw badRequest('Username is required');
  }

  if (user.password.length < 8) {
    throw badRequest('Password must be at least 8 characters');
  }

  if (!USER_ROLES.includes(user.role)) {
    throw badRequest(`Role must be one of: ${USER_ROLES.join(', ')}`);
  }

  return user;
}

function normalizeUserUpdate(body) {
  const update = {
    name: body.name === undefined ? null : String(body.name || '').trim(),
    username: body.username === undefined ? null : String(body.username || '').trim().toLowerCase(),
    password: body.password === undefined ? null : String(body.password || ''),
    role: body.role === undefined ? null : String(body.role || '').trim().toLowerCase()
  };

  if (update.name !== null && !update.name) {
    throw badRequest('Name is required');
  }

  if (update.username !== null && !update.username) {
    throw badRequest('Username is required');
  }

  if (update.password !== null && update.password.length < 8) {
    throw badRequest('Password must be at least 8 characters');
  }

  if (update.role !== null && !USER_ROLES.includes(update.role)) {
    throw badRequest(`Role must be one of: ${USER_ROLES.join(', ')}`);
  }

  return update;
}

async function getUserById(id) {
  const { rows } = await query(
    `SELECT id, name, username, role
     FROM users
     WHERE id = $1`,
    [id]
  );

  return rows[0] || null;
}

async function getAdminCount() {
  const { rows } = await query(`SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin'`);
  return rows[0].count;
}

async function getItemById(id) {
  const { rows } = await query(`SELECT * FROM items WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function recordItemEvent({ itemId, itemName, userId, eventType, beforeData, afterData }) {
  await query(
    `INSERT INTO item_events (item_id, item_name, user_id, event_type, before_data, after_data)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [itemId, itemName, userId, eventType, beforeData, afterData]
  );
}

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
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
