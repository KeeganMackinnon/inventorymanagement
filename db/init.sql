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
  category text NOT NULL,
  manufacturer text NOT NULL DEFAULT '',
  part_number text NOT NULL DEFAULT '',
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  minimum_quantity integer NOT NULL DEFAULT 0 CHECK (minimum_quantity >= 0),
  unit text NOT NULL DEFAULT 'each',
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_items_name ON items (lower(name));
CREATE INDEX IF NOT EXISTS idx_items_category ON items (category);
CREATE INDEX IF NOT EXISTS idx_items_part_number ON items (part_number);

INSERT INTO locations (name, area, notes)
VALUES
  ('Electrical Cabinet A3', 'Electrical', 'Deutsch and autosport wiring supplies'),
  ('PCB Bench Bins', 'Electrical', 'Small SMT/THT electronics inventory'),
  ('General Hardware Rack', 'Shop', 'Fasteners, brackets, and consumables')
ON CONFLICT (name) DO NOTHING;

INSERT INTO items
  (name, category, manufacturer, part_number, quantity, minimum_quantity, unit, location_id, notes)
VALUES
  (
    'DTM 2-pin plug housing',
    'Deutsch Connectors',
    'TE Connectivity',
    'DTM06-2S',
    24,
    10,
    'each',
    (SELECT id FROM locations WHERE name = 'Electrical Cabinet A3'),
    'Common low-current sensor connector'
  ),
  (
    'Size 20 solid socket contact',
    'Deutsch Contacts',
    'TE Connectivity',
    '0462-201-20141',
    150,
    50,
    'each',
    (SELECT id FROM locations WHERE name = 'Electrical Cabinet A3'),
    'Used with DTM connector family'
  ),
  (
    '0603 10k resistor',
    'PCB Components',
    'Yageo',
    'RC0603FR-0710KL',
    500,
    100,
    'each',
    (SELECT id FROM locations WHERE name = 'PCB Bench Bins'),
    'General pull-up and divider resistor'
  ),
  (
    'M5 nylock nut',
    'Hardware',
    '',
    '',
    80,
    25,
    'each',
    (SELECT id FROM locations WHERE name = 'General Hardware Rack'),
    'Metric hardware'
  )
ON CONFLICT DO NOTHING;
