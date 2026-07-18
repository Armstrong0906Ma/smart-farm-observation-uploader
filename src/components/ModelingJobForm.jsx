'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';

function toLocalInputValue(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const statusText = {
  queued: '等待處理',
  dispatching: '正在派送建模任務',
  processing: '3D 建模與分析中',
  succeeded: '建模與分析完成',
  failed: '處理失敗'
};

const dataHubStatusText = {
  pending: 'DataHub 等待同步',
  uploading: 'DataHub 同步中',
  uploaded: 'DataHub 已同步',
  failed: 'DataHub 同步失敗'
};

async function readJsonResponse(response) {
  const body = await response.text();
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    const detail = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    throw new Error(`HTTP ${response.status} ${response.statusText}${detail ? `: ${detail}` : ''}`);
  }
}

export function ModelingJobForm() {
  const { getIdToken } = useAuth();
  const [plants, setPlants] = useState([]);
  const [plantId, setPlantId] = useState('A-1-1');
  const [observedAt, setObservedAt] = useState(toLocalInputValue(new Date()));
  const [front, setFront] = useState(null);
  const [right, setRight] = useState(null);
  const [job, setJob] = useState(null);
  const [message, setMessage] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const pollTimer = useRef(null);
  const pollingJobId = useRef(null);
  const submissionKey = useRef(null);
  const succeededNotified = useRef(false);

  useEffect(() => {
    getIdToken().then(token => fetch('/api/plants', {
      headers: { Authorization: `Bearer ${token}` }
    })).then(async response => {
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.error || '讀取植株清單失敗');
      setPlants(data.plants);
      if (data.plants[0]) setPlantId(data.plants[0].plantId);
    }).catch(error => setMessage({ type: 'error', text: error.message }));
  }, [getIdToken]);

  useEffect(() => () => {
    pollingJobId.current = null;
    if (pollTimer.current) window.clearTimeout(pollTimer.current);
  }, []);

  async function pollJob(id) {
    if (pollingJobId.current !== id) return;
    try {
      const token = await getIdToken();
      const response = await fetch(`/api/modeling-jobs/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store'
      });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.error || '查詢任務失敗');
      setJob(data.job);
      const modelingActive = ['queued', 'dispatching', 'processing'].includes(data.job.status);
      const dataHubActive = data.job.status === 'succeeded'
        && !['uploaded', 'failed'].includes(data.job.dataHubStatus);
      if (data.job.status === 'succeeded' && !succeededNotified.current) {
        succeededNotified.current = true;
        window.dispatchEvent(new Event('observations:changed'));
      }
      if (modelingActive || dataHubActive) {
        pollTimer.current = window.setTimeout(() => pollJob(id), 5000);
      } else {
        pollingJobId.current = null;
      }
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
      if (pollingJobId.current === id) {
        pollTimer.current = window.setTimeout(() => pollJob(id), 5000);
      }
    }
  }

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    if (pollTimer.current) window.clearTimeout(pollTimer.current);
    pollingJobId.current = null;
    setMessage(null);
    setJob(null);
    succeededNotified.current = false;
    try {
      const token = await getIdToken();
      const form = new FormData();
      form.set('plantId', plantId);
      form.set('observedAt', new Date(observedAt).toISOString());
      submissionKey.current ||= crypto.randomUUID();
      form.set('submissionKey', submissionKey.current);
      form.set('front', front);
      form.set('right', right);
      const response = await fetch('/api/modeling-jobs', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form
      });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.error || '建立任務失敗');
      setJob(data.job);
      submissionKey.current = null;
      setMessage({ type: 'ok', text: '照片已送出，可以留在此頁查看進度。' });
      pollingJobId.current = data.job.id;
      pollTimer.current = window.setTimeout(() => pollJob(data.job.id), 3000);
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="card modelingCard">
      <div className="sectionHeading">
        <div>
          <p className="eyebrow">Two-view 3D pipeline</p>
          <h2>兩張照片自動建模</h2>
        </div>
        {job && <span className={`status ${job.status}`}>{statusText[job.status] || job.status}</span>}
      </div>
      <p className="muted compactText">上傳正面與右側照片後，系統會產生 GLB、GIF，計算株高與結點，最後自動同步 DataHub。</p>
      <form className="modelingGrid" onSubmit={submit}>
        <label className="field">
          <span>植株編號</span>
          <select value={plantId} onChange={event => setPlantId(event.target.value)} required>
            {plants.map(plant => <option key={plant.plantId}>{plant.plantId}</option>)}
          </select>
        </label>
        <label className="field">
          <span>觀測日期時間</span>
          <input type="datetime-local" value={observedAt} onChange={event => setObservedAt(event.target.value)} required />
        </label>
        <label className="photoDrop">
          <span className="photoLabel">正面照片</span>
          <strong>{front ? front.name : '選擇 Front View'}</strong>
          <input type="file" accept="image/*" onChange={event => setFront(event.target.files[0] || null)} required />
        </label>
        <label className="photoDrop">
          <span className="photoLabel">右側照片</span>
          <strong>{right ? right.name : '選擇 Right View'}</strong>
          <input type="file" accept="image/*" onChange={event => setRight(event.target.files[0] || null)} required />
        </label>
        <button className="primaryButton fullWidth" disabled={submitting || !front || !right}>
          {submitting ? '正在傳送照片...' : '開始 3D 建模與分析'}
        </button>
      </form>
      {message && <div className={`notice ${message.type === 'error' ? 'error' : ''}`}>{message.text}</div>}
      {job?.error && <div className="notice error">{job.error}</div>}
      {job?.dataHubStatus && <p className="recordMeta">{dataHubStatusText[job.dataHubStatus] || `DataHub: ${job.dataHubStatus}`}</p>}
      {job && <p className="recordMeta">任務編號：{job.id}</p>}
    </section>
  );
}
