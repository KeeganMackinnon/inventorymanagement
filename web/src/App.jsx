import React from 'react';
import { AlertTriangle, Boxes, Edit3, ExternalLink, Minus, Plus, Search, Trash2, Wrench, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import owlsLogo from './assets/logo1.png';
import './styles.css';

const API_URL = import.meta.env.VITE_API_URL || '';
const CHART_COLORS = [
  '#c41230',
  '#102d55',
  '#2f80ed',
  '#7b2cbf',
  '#0f766e',
  '#ef7d00',
  '#64748b',
  '#16a34a',
  '#be123c',
  '#334155',
  '#f59e0b'
];

const emptyForm = {
  name: '',
  system: 'General',
  category: 'Hardware',
  manufacturer: '',
  partNumber: '',
  quantity: 0,
  minimumQuantity: 0,
  cost: 0,
  unit: 'each',
  locationId: '',
  locationName: '',
  vendorUrl: '',
  notes: ''
};

function App() {
  const [items, setItems] = useState([]);
  const [locations, setLocations] = useState([]);
  const [systems, setSystems] = useState([]);
  const [systemValues, setSystemValues] = useState([]);
  const [categories, setCategories] = useState([]);
  const [filterCategories, setFilterCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [systemFilter, setSystemFilter] = useState('');
  const [category, setCategory] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [status, setStatus] = useState('Loading inventory...');
  const [saving, setSaving] = useState(false);
  const [deletingIds, setDeletingIds] = useState([]);
  const [editingItemId, setEditingItemId] = useState('');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [isValueChartCollapsed, setIsValueChartCollapsed] = useState(false);

  useEffect(() => {
    loadReferenceData();
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      loadItems();
    }, 150);

    return () => window.clearTimeout(timeout);
  }, [search, systemFilter, category]);

  useEffect(() => {
    loadFilterCategories(systemFilter);
  }, [systemFilter]);

  const lowStockCount = useMemo(
    () => items.filter((item) => item.quantity <= item.minimum_quantity).length,
    [items]
  );

  const totalQuantity = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity, 0),
    [items]
  );

  const totalInventoryValue = useMemo(
    () => systemValues.reduce((sum, row) => sum + row.value, 0),
    [systemValues]
  );

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) || null,
    [items, selectedItemId]
  );

  const nonZeroSystemValues = useMemo(
    () => systemValues.filter((row) => row.value > 0),
    [systemValues]
  );

  const pieBackground = useMemo(
    () => createPieGradient(systemValues, totalInventoryValue),
    [systemValues, totalInventoryValue]
  );

  async function loadReferenceData() {
    try {
      const [locationData, categoryData, systemData] = await Promise.all([
        fetchJson('/api/locations'),
        fetchJson('/api/categories'),
        fetchJson('/api/systems')
      ]);
      setLocations(locationData);
      setCategories(categoryData);
      setFilterCategories(categoryData);
      setSystems(systemData);
      await loadSystemValues();
      setStatus('');
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function loadItems() {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (systemFilter) params.set('system', systemFilter);
      if (category) params.set('category', category);
      const data = await fetchJson(`/api/items?${params.toString()}`);
      setItems(data);
      setSelectedItemId((current) =>
        current && data.some((item) => item.id === current) ? current : ''
      );
      setStatus('');
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function loadFilterCategories(system) {
    try {
      const params = new URLSearchParams();
      if (system) params.set('system', system);
      const data = await fetchJson(`/api/categories?${params.toString()}`);
      setFilterCategories(data);
      setCategory((current) => (current && data.includes(current) ? current : ''));
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function loadSystemValues() {
    const data = await fetchJson('/api/system-values');
    setSystemValues(data);
  }

  async function saveItem(event) {
    event.preventDefault();
    setSaving(true);

    try {
      const path = editingItemId ? `/api/items/${editingItemId}` : '/api/items';
      const method = editingItemId ? 'PATCH' : 'POST';

      await fetchJson(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      setForm(emptyForm);
      setEditingItemId('');
      await Promise.all([loadReferenceData(), loadItems(), loadSystemValues()]);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setSaving(false);
    }
  }

  function startEditing(item) {
    setEditingItemId(item.id);
    setForm({
      name: item.name,
      system: item.system || 'General',
      category: item.category,
      manufacturer: item.manufacturer || '',
      partNumber: item.part_number || '',
      quantity: item.quantity,
      minimumQuantity: item.minimum_quantity,
      cost: Number(item.cost || 0),
      unit: item.unit || 'each',
      locationId: item.location_id || '',
      locationName: item.location_name || '',
      vendorUrl: item.vendor_url || '',
      notes: item.notes || ''
    });
    setStatus('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEditing() {
    setEditingItemId('');
    setForm(emptyForm);
  }

  async function adjustQuantity(item, delta) {
    const nextQuantity = Math.max(0, item.quantity + delta);
    const updated = await fetchJson(`/api/items/${item.id}/quantity`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: nextQuantity })
    });

    setItems((current) =>
      current.map((candidate) =>
        candidate.id === item.id
          ? { ...candidate, quantity: updated.quantity }
          : candidate
      )
    );
    await loadSystemValues();
  }

  async function deleteItem(item) {
    const confirmed = window.confirm(`Delete ${item.name} from inventory?`);

    if (!confirmed) {
      return;
    }

    setDeletingIds((current) => [...current, item.id]);

    try {
      await fetchJson(`/api/items/${item.id}`, { method: 'DELETE' });
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      await Promise.all([loadReferenceData(), loadSystemValues()]);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setDeletingIds((current) => current.filter((id) => id !== item.id));
    }
  }

  function findLocationId(locationName) {
    const normalized = locationName.trim().toLowerCase();
    const location = locations.find((candidate) =>
      `${candidate.area} / ${candidate.name}`.toLowerCase() === normalized ||
      candidate.name.toLowerCase() === normalized
    );

    return location?.id || '';
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <img src={owlsLogo} alt="Owls Racing logo" />
          <div>
            <h1>Owls Racing Inventory</h1>
          </div>
        </div>
        <div className="summary-strip" aria-label="Inventory summary">
          <SummaryStat icon={<Boxes />} label="Items" value={items.length} />
          <SummaryStat icon={<Wrench />} label="Units" value={totalQuantity} />
          <SummaryStat icon={<AlertTriangle />} label="Low" value={lowStockCount} />
          <SummaryStat icon={<Boxes />} label="Value" value={formatCurrency(totalInventoryValue)} />
        </div>
      </header>

      <section className="workspace">
        <aside className="entry-panel">
          <div className="side-section">
            <div className="form-heading">
              <h2>{editingItemId ? 'Edit Part' : 'Add Part'}</h2>
              {editingItemId ? (
                <button
                  aria-label="Cancel editing"
                  className="ghost-action"
                  title="Cancel editing"
                  type="button"
                  onClick={cancelEditing}
                >
                  <X size={16} />
                </button>
              ) : null}
            </div>
            <form onSubmit={saveItem} className="item-form">
              <label>
                Name
                <input
                  required
                  value={form.name}
                  onChange={(event) => setFormValue('name', event.target.value)}
                  placeholder="DTM 4-pin receptacle"
                />
              </label>
              <label>
                System
                <select
                  required
                  value={form.system}
                  onChange={(event) => setFormValue('system', event.target.value)}
                >
                  {systems.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Category
                <input
                  required
                  value={form.category}
                  onChange={(event) => setFormValue('category', event.target.value)}
                  list="category-options"
                />
              </label>
              <datalist id="category-options">
                {categories.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <label>
                Manufacturer
                <input
                  value={form.manufacturer}
                  onChange={(event) => setFormValue('manufacturer', event.target.value)}
                  placeholder="TE Connectivity"
                />
              </label>
              <label>
                Part Number
                <input
                  value={form.partNumber}
                  onChange={(event) => setFormValue('partNumber', event.target.value)}
                  placeholder="DTM06-4S"
                />
              </label>
              <div className="form-grid">
                <label>
                  Qty
                  <input
                    min="0"
                    type="number"
                    value={form.quantity}
                    onChange={(event) => setFormValue('quantity', Number(event.target.value))}
                  />
                </label>
                <label>
                  Min
                  <input
                    min="0"
                    type="number"
                    value={form.minimumQuantity}
                    onChange={(event) => setFormValue('minimumQuantity', Number(event.target.value))}
                  />
                </label>
                <label>
                  Cost
                  <input
                    min="0"
                    step="0.01"
                    type="number"
                    value={form.cost}
                    onChange={(event) => setFormValue('cost', Number(event.target.value))}
                  />
                </label>
              </div>
              <label>
                Location
                <input
                  value={form.locationName}
                  onChange={(event) => setFormValue('locationName', event.target.value)}
                  list="location-options"
                  placeholder="Electrical Cabinet A3"
                />
                <datalist id="location-options">
                  {locations.map((location) => (
                    <option key={location.id} value={`${location.area} / ${location.name}`}>
                      {location.area} / {location.name}
                    </option>
                  ))}
                </datalist>
              </label>
              <label>
                Vendor Link
                <input
                  value={form.vendorUrl}
                  onChange={(event) => setFormValue('vendorUrl', event.target.value)}
                  placeholder="https://vendor.com/part"
                  type="url"
                />
              </label>
              <label>
                Notes
                <textarea
                  value={form.notes}
                  onChange={(event) => setFormValue('notes', event.target.value)}
                  placeholder="Crimper, mating family, vendor, car subsystem..."
                />
              </label>
              <div className="form-actions">
                <button className="primary-action" disabled={saving} type="submit">
                  {editingItemId ? <Edit3 size={18} /> : <Plus size={18} />}
                  {saving ? 'Saving' : editingItemId ? 'Save Changes' : 'Add Item'}
                </button>
                {editingItemId ? (
                  <button className="secondary-action" type="button" onClick={cancelEditing}>
                    Cancel
                  </button>
                ) : null}
              </div>
            </form>
          </div>

        </aside>

        <section className="inventory-panel">
          <div className="toolbar">
            <label className="search-field">
              <Search size={18} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, part number, manufacturer, notes"
              />
            </label>
            <select
              value={systemFilter}
              onChange={(event) => {
                setSystemFilter(event.target.value);
                setCategory('');
              }}
            >
              <option value="">All systems</option>
              {systems.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">All categories</option>
              {filterCategories.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          {status ? <div className="status">{status}</div> : null}

          <section className="value-dashboard" aria-label="Inventory value by system">
            <button
              className="dashboard-toggle"
              type="button"
              onClick={() => setIsValueChartCollapsed((current) => !current)}
            >
              <span>Value By System</span>
              <strong>{formatCurrency(totalInventoryValue)}</strong>
              <small>{isValueChartCollapsed ? 'Show chart' : 'Hide chart'}</small>
            </button>
            {!isValueChartCollapsed ? (
              <div className="pie-layout">
                <div
                  aria-label="Inventory value pie chart"
                  className="pie-chart"
                  style={{ background: pieBackground }}
                >
                  <span>{formatCurrency(totalInventoryValue)}</span>
                </div>
                <div className="pie-legend">
                  {(nonZeroSystemValues.length ? nonZeroSystemValues : systemValues).map((row, index) => (
                    <div className="legend-row" key={row.system}>
                      <i style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />
                      <span>{row.system}</span>
                      <strong>{formatCurrency(row.value)}</strong>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          {selectedItem ? (
            <section className="item-detail" aria-label="Selected item details">
              <div className="detail-heading">
                <div>
                  <p className="eyebrow detail-eyebrow">Selected Part</p>
                  <h2>{selectedItem.name}</h2>
                </div>
                <button
                  aria-label="Close selected item details"
                  className="ghost-action"
                  title="Close details"
                  type="button"
                  onClick={() => setSelectedItemId('')}
                >
                  <X size={16} />
                </button>
              </div>
              <dl className="detail-grid">
                <div>
                  <dt>Manufacturer</dt>
                  <dd>{selectedItem.manufacturer || 'Not set'}</dd>
                </div>
                <div>
                  <dt>Part Number</dt>
                  <dd>{selectedItem.part_number || 'Not set'}</dd>
                </div>
                <div>
                  <dt>System</dt>
                  <dd>{selectedItem.system || 'General'}</dd>
                </div>
                <div>
                  <dt>Category</dt>
                  <dd>{selectedItem.category}</dd>
                </div>
                <div>
                  <dt>Location</dt>
                  <dd>{selectedItem.location_name || 'Unassigned'}</dd>
                </div>
                <div>
                  <dt>Quantity</dt>
                  <dd>
                    {selectedItem.quantity} {selectedItem.unit} / min {selectedItem.minimum_quantity}
                  </dd>
                </div>
                <div>
                  <dt>Vendor</dt>
                  <dd>
                    {selectedItem.vendor_url ? (
                      <a className="detail-link" href={selectedItem.vendor_url} target="_blank" rel="noreferrer">
                        Reorder
                        <ExternalLink size={14} />
                      </a>
                    ) : (
                      'Not set'
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Cost</dt>
                  <dd>{formatCurrency(Number(selectedItem.cost || 0))}</dd>
                </div>
                <div>
                  <dt>Value</dt>
                  <dd>{formatCurrency(selectedItem.quantity * Number(selectedItem.cost || 0))}</dd>
                </div>
              </dl>
              <div className="detail-notes">
                <h3>Notes</h3>
                <p>{renderLinkedText(selectedItem.notes || 'No notes yet.')}</p>
              </div>
            </section>
          ) : null}

          <div className="inventory-table" role="table" aria-label="Inventory items">
            <div className="table-header" role="row">
              <span>Part</span>
              <span>System</span>
              <span>Category</span>
              <span>Location</span>
              <span>Stock</span>
              <span>Value</span>
              <span>Actions</span>
            </div>
            {items.map((item) => (
              <article
                className={`table-row ${selectedItemId === item.id ? 'selected-row' : ''}`}
                role="row"
                key={item.id}
                onClick={() => setSelectedItemId(item.id)}
              >
                <div className="part-cell">
                  <strong>{item.name}</strong>
                  <span>
                    {[item.manufacturer, item.part_number].filter(Boolean).join(' / ') || 'No part number'}
                  </span>
                </div>
                <span>{item.system || 'General'}</span>
                <span>{item.category}</span>
                <span>{item.location_name || 'Unassigned'}</span>
                <div className="quantity-cell">
                  <button
                    aria-label={`Reduce ${item.name}`}
                    title="Reduce quantity"
                    onClick={(event) => {
                      event.stopPropagation();
                      adjustQuantity(item, -1);
                    }}
                  >
                    <Minus size={16} />
                  </button>
                  <strong className={item.quantity <= item.minimum_quantity ? 'low-stock' : ''}>
                    {item.quantity}
                  </strong>
                  <button
                    aria-label={`Increase ${item.name}`}
                    title="Increase quantity"
                    onClick={(event) => {
                      event.stopPropagation();
                      adjustQuantity(item, 1);
                    }}
                  >
                    <Plus size={16} />
                  </button>
                  <small>min {item.minimum_quantity}</small>
                </div>
                <span>{formatCurrency(item.quantity * Number(item.cost || 0))}</span>
                <div className="action-cell">
                  <button
                    aria-label={`Edit ${item.name}`}
                    className="edit-action"
                    title="Edit item"
                    onClick={(event) => {
                      event.stopPropagation();
                      startEditing(item);
                    }}
                  >
                    <Edit3 size={16} />
                  </button>
                  <button
                    aria-label={`Delete ${item.name}`}
                    className="danger-action"
                    disabled={deletingIds.includes(item.id)}
                    title="Delete item"
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteItem(item);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );

  function setFormValue(key, value) {
    setForm((current) => {
      if (key === 'locationName') {
        return { ...current, locationName: value, locationId: findLocationId(value) };
      }

      return { ...current, [key]: value };
    });
  }
}

function SummaryStat({ icon, label, value }) {
  return (
    <div className="summary-stat">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

async function fetchJson(path, options) {
  const response = await fetch(`${API_URL}${path}`, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }

  return data;
}

function renderLinkedText(text) {
  const urlPattern = /(https?:\/\/[^\s]+)/g;

  return text.split(urlPattern).map((part, index) => {
    if (!part.match(/^https?:\/\//)) {
      return part;
    }

    return (
      <a key={`${part}-${index}`} href={part} target="_blank" rel="noreferrer">
        {part}
        <ExternalLink size={14} />
      </a>
    );
  });
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(Number(value || 0));
}

function createPieGradient(values, total) {
  if (!total) {
    return '#dce6f2';
  }

  let cursor = 0;
  const stops = values
    .filter((row) => row.value > 0)
    .map((row, index) => {
      const start = cursor;
      cursor += (row.value / total) * 100;
      return `${CHART_COLORS[index % CHART_COLORS.length]} ${start}% ${cursor}%`;
    });

  return `conic-gradient(${stops.join(', ')})`;
}

createRoot(document.getElementById('root')).render(<App />);
