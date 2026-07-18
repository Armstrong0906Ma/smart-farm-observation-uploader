'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';

function toLocalInputValue(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function ObservationForm() {
  const { getIdToken } = useAuth();
  const [plants, setPlants] = useState([]);
  const [message, setMessage] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    plantId: 'A-1-1',
    observedAt: toLocalInputValue(new Date()),
    height: '',
    nodes: '',
    note: ''
  });

  useEffect(() => {
    async function loadPlants() {
      const token = await getIdToken();
      const response = await fetch('/api/plants', { headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (response.ok) {
        setPlants(data.plants);
        if (data.plants[0]) setForm(current => ({ ...current, plantId: current.plantId || data.plants[0].plantId }));
      } else {
        setMessage({ type: 'error', text: data.error || '讀取植株清單失敗' });
      }
    }
    loadPlants().catch(error => setMessage({ type: 'error', text: error.message }));
  }, [getIdToken]);

  useEffect(() => {
    if (!message || message.type === 'error') return undefined;
    const timer = window.setTimeout(() => setMessage(null), 3000);
    return () => window.clearTimeout(timer);
  }, [message]);

  function updateField(name, value) {
    setForm(current => ({ ...current, [name]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const token = await getIdToken();
      const observedAt = new Date(form.observedAt).toISOString();
      const response = await fetch('/api/observations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          plantId: form.plantId,
          observedAt,
          height: Number(form.height),
          nodes: Number(form.nodes),
          note: form.note
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '新增失敗');
      setMessage({ type: 'ok', text: '已儲存到資料庫，尚未同步到 DataHub' });
      setForm(current => ({ ...current, height: '', nodes: '', note: '' }));
      window.dispatchEvent(new Event('observations:changed'));
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="card">
      <h2>新增觀測資料</h2>
      <form className="formGrid" onSubmit={submit}>
        <label className="field">
          <span>植株編號</span>
          <select value={form.plantId} onChange={event => updateField('plantId', event.target.value)} required>
            {plants.map(plant => <option key={plant.plantId} value={plant.plantId}>{plant.plantId}</option>)}
          </select>
        </label>
        <label className="field">
          <span>觀測日期時間</span>
          <input type="datetime-local" value={form.observedAt} onChange={event => updateField('observedAt', event.target.value)} required />
        </label>
        <label className="field">
          <span>植株高度</span>
          <input inputMode="decimal" type="number" value={form.height} onChange={event => updateField('height', event.target.value)} required />
        </label>
        <label className="field">
          <span>結點數</span>
          <input inputMode="numeric" type="number" value={form.nodes} onChange={event => updateField('nodes', event.target.value)} required />
        </label>
        <label className="field">
          <span>備註</span>
          <textarea value={form.note} onChange={event => updateField('note', event.target.value)} />
        </label>
        <button className="primaryButton" disabled={submitting}>{submitting ? '儲存中...' : '儲存到資料庫'}</button>
        {message && <div className={`notice ${message.type === 'error' ? 'error' : ''}`}>{message.text}</div>}
      </form>
    </section>
  );
}
