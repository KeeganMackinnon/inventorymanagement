import React from 'react';
import { AlertTriangle, Boxes, Minus, Plus, Search, Wrench } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import owlsLogo from './assets/logo1.png';
import './styles.css';

const API_URL = import.meta.env.VITE_API_URL || '';

const emptyForm = {
  name: '',
  category: 'Deutsch Connectors',
  manufacturer: '',
  partNumber: '',
  quantity: 0,
  minimumQuantity: 0,
  unit: 'each',
  locationId: '',
  notes: ''
};

function App() {
  const [items, setItems] = useState([]);
  const [locations, setLocations] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [status, setStatus] = useState('Loading inventory...');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadReferenceData();
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      loadItems();
    }, 150);

    return () => window.clearTimeout(timeout);
  }, [search, category]);

  const lowStockCount = useMemo(
    () => items.filter((item) => item.quantity <= item.minimum_quantity).length,
    [items]
  );

  const totalQuantity = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity, 0),
    [items]
  );

  async function loadReferenceData() {
    try {
      const [locationData, categoryData] = await Promise.all([
        fetchJson('/api/locations'),
        fetchJson('/api/categories')
      ]);
      setLocations(locationData);
      setCategories(categoryData);
      setStatus('');
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function loadItems() {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (category) params.set('category', category);
      const data = await fetchJson(`/api/items?${params.toString()}`);
      setItems(data);
      setStatus('');
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function saveItem(event) {
    event.preventDefault();
    setSaving(true);

    try {
      await fetchJson('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      setForm(emptyForm);
      await Promise.all([loadReferenceData(), loadItems()]);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setSaving(false);
    }
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
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <img src={owlsLogo} alt="Owls Racing logo" />
          <div>
            <p className="eyebrow">FSAE Shop</p>
            <h1>Owls Racing Inventory</h1>
          </div>
        </div>
        <div className="summary-strip" aria-label="Inventory summary">
          <SummaryStat icon={<Boxes />} label="Items" value={items.length} />
          <SummaryStat icon={<Wrench />} label="Units" value={totalQuantity} />
          <SummaryStat icon={<AlertTriangle />} label="Low" value={lowStockCount} />
        </div>
      </header>

      <section className="workspace">
        <aside className="entry-panel">
          <h2>Add Part</h2>
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
            </div>
            <label>
              Location
              <select
                value={form.locationId}
                onChange={(event) => setFormValue('locationId', event.target.value)}
              >
                <option value="">Unassigned</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.area} / {location.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Notes
              <textarea
                value={form.notes}
                onChange={(event) => setFormValue('notes', event.target.value)}
                placeholder="Crimper, mating family, vendor, car subsystem..."
              />
            </label>
            <button className="primary-action" disabled={saving} type="submit">
              <Plus size={18} />
              {saving ? 'Saving' : 'Add Item'}
            </button>
          </form>
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
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">All categories</option>
              {categories.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          {status ? <div className="status">{status}</div> : null}

          <div className="inventory-table" role="table" aria-label="Inventory items">
            <div className="table-header" role="row">
              <span>Part</span>
              <span>Category</span>
              <span>Location</span>
              <span>Stock</span>
            </div>
            {items.map((item) => (
              <article className="table-row" role="row" key={item.id}>
                <div className="part-cell">
                  <strong>{item.name}</strong>
                  <span>
                    {[item.manufacturer, item.part_number].filter(Boolean).join(' / ') || 'No part number'}
                  </span>
                </div>
                <span>{item.category}</span>
                <span>{item.location_name || 'Unassigned'}</span>
                <div className="quantity-cell">
                  <button
                    aria-label={`Reduce ${item.name}`}
                    title="Reduce quantity"
                    onClick={() => adjustQuantity(item, -1)}
                  >
                    <Minus size={16} />
                  </button>
                  <strong className={item.quantity <= item.minimum_quantity ? 'low-stock' : ''}>
                    {item.quantity}
                  </strong>
                  <button
                    aria-label={`Increase ${item.name}`}
                    title="Increase quantity"
                    onClick={() => adjustQuantity(item, 1)}
                  >
                    <Plus size={16} />
                  </button>
                  <small>min {item.minimum_quantity}</small>
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );

  function setFormValue(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
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

createRoot(document.getElementById('root')).render(<App />);
