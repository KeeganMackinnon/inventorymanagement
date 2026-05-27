CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  area text NOT NULL DEFAULT 'Shop',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  system text NOT NULL DEFAULT 'General',
  category text NOT NULL,
  manufacturer text NOT NULL DEFAULT '',
  part_number text NOT NULL DEFAULT '',
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  minimum_quantity integer NOT NULL DEFAULT 0 CHECK (minimum_quantity >= 0),
  cost numeric(12, 2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  unit text NOT NULL DEFAULT 'each',
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  vendor_url text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_items_name ON items (lower(name));
CREATE INDEX IF NOT EXISTS idx_items_system ON items (system);
CREATE INDEX IF NOT EXISTS idx_items_category ON items (category);
CREATE INDEX IF NOT EXISTS idx_items_cost ON items (cost);
CREATE INDEX IF NOT EXISTS idx_items_part_number ON items (part_number);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (role IN ('admin', 'member', 'viewer'))
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);

CREATE TABLE IF NOT EXISTS item_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid REFERENCES items(id) ON DELETE SET NULL,
  item_name text NOT NULL DEFAULT '',
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_events_item_id ON item_events (item_id);
CREATE INDEX IF NOT EXISTS idx_item_events_created_at ON item_events (created_at DESC);

INSERT INTO locations (name, area, notes)
VALUES
  ('Electrical Cabinet A3', 'Electrical', 'Deutsch and autosport wiring supplies'),
  ('PCB Bench Bins', 'Electrical', 'Small SMT/THT electronics inventory'),
  ('General Hardware Rack', 'Shop', 'Fasteners, brackets, and consumables')
ON CONFLICT (name) DO NOTHING;

INSERT INTO items
  (name, system, category, manufacturer, part_number, quantity, minimum_quantity, cost, unit, location_id, vendor_url, notes)
VALUES
  (
    'DTM 2-pin plug housing',
    'Electrical',
    'Deutsch Connectors',
    'TE Connectivity',
    'DTM06-2S',
    24,
    10,
    0,
    'each',
    (SELECT id FROM locations WHERE name = 'Electrical Cabinet A3'),
    '',
    'Common low-current sensor connector'
  ),
  (
    'Size 20 solid socket contact',
    'Electrical',
    'Deutsch Contacts',
    'TE Connectivity',
    '0462-201-20141',
    150,
    50,
    0,
    'each',
    (SELECT id FROM locations WHERE name = 'Electrical Cabinet A3'),
    '',
    'Used with DTM connector family'
  ),
  (
    '0603 10k resistor',
    'Electrical',
    'PCB Components',
    'Yageo',
    'RC0603FR-0710KL',
    500,
    100,
    0,
    'each',
    (SELECT id FROM locations WHERE name = 'PCB Bench Bins'),
    '',
    'General pull-up and divider resistor'
  ),
  (
    'M5 nylock nut',
    'General',
    'Hardware',
    '',
    '',
    80,
    25,
    0,
    'each',
    (SELECT id FROM locations WHERE name = 'General Hardware Rack'),
    '',
    'Metric hardware'
  )
ON CONFLICT DO NOTHING;
