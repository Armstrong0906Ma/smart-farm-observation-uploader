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
  failed: '處理失敗',
  cancelled: '任務已取消'
};

const progressPhaseText = {
  queued: '等待處理',
  dispatching: '派送照片至建模主機',
  uploading_sources: '保存前視與右視照片',
  preparing: '檢查並上傳照片',
  submitting: '建立混元建模任務',
  modeling: '混元 3D 建模中',
  downloading: '下載 3D 模型',
  converting: '產生預覽 GIF',
  analyzing: '計算株高與結點',
  simplifying: '建立輕量旋轉模型',
  rendering: '產生節點旋轉 GIF',
  uploading: '上傳模型與分析產物',
  callback_pending: '儲存結果',
  retry_wait: '發生錯誤，等待自動重試',
  completed: '建模與分析完成',
  failed: '處理失敗',
  cancelled: '任務已取消'
};

const retryModeText = {
  resume_creation: '恢復同一筆混元任務，不會再次付費',
  regenerate_remote_terminal: '遠端明確失敗，將重新建立一次建模',
  resubmit_ambiguous: '建立結果不明，將依設定重新送出一次',
  retry_pre_generate: '建立建模任務前失敗，將重新嘗試'
};

function jobProgress(job) {
  if (job?.progress) return job.progress;
  if (job?.status === 'succeeded') return { phase: 'completed', overallPercent: 100 };
  if (job?.status === 'dispatching') return { phase: 'dispatching', overallPercent: 5 };
  if (job?.status === 'processing') return { phase: 'modeling', overallPercent: 15 };
  return { phase: job?.status || 'queued', overallPercent: 2 };
}

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
  const [jobs, setJobs] = useState([]);
  const [message, setMessage] = useState(null);
  const [progressError, setProgressError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const pollTimer = useRef(null);
  const submissionKey = useRef(null);
  const previousJobIds = useRef(new Set());

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

  useEffect(() => {
    let cancelled = false;
    async function pollJobs() {
      let delay = 10_000;
      try {
        const token = await getIdToken();
        const response = await fetch('/api/modeling-jobs', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store'
        });
        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.error || '查詢任務失敗');
        if (cancelled) return;
        const nextJobs = data.jobs || [];
        const nextIds = new Set(nextJobs.map(job => job.id));
        if ([...previousJobIds.current].some(id => !nextIds.has(id))) {
          window.dispatchEvent(new Event('observations:changed'));
        }
        previousJobIds.current = nextIds;
        setJobs(nextJobs);
        setProgressError(null);
        delay = nextJobs.length > 0 ? 2_000 : 10_000;
      } catch (error) {
        if (!cancelled) setProgressError(error.message);
        delay = 5_000;
      }
      if (!cancelled) pollTimer.current = window.setTimeout(pollJobs, delay);
    }
    pollJobs();
    return () => {
      cancelled = true;
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
    };
  }, [getIdToken]);

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
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
      setJobs(current => current.some(job => job.id === data.job.id)
        ? current.map(job => job.id === data.job.id ? data.job : job)
        : [...current, data.job]);
      previousJobIds.current.add(data.job.id);
      submissionKey.current = null;
      setMessage({ type: 'ok', text: '照片已送出，所有登入使用者都能查看進度。' });
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
        {jobs.length > 0 && <span className="status processing">進行中 {jobs.length} 筆</span>}
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
      {progressError && <div className="notice error">進度暫時無法更新：{progressError}</div>}
      {jobs.length > 0 && (
        <div className="runningModelingJobs" aria-live="polite">
          {jobs.map(job => {
            const progress = jobProgress(job);
            return (
              <div className="progressItem modelingProgress" key={job.id}>
                <div className="progressHeading">
                  <strong>{job.plantId} · {progressPhaseText[progress.phase] || statusText[job.status] || '處理中'}</strong>
                  <span className="recordMeta">整體進度 {progress.overallPercent}%</span>
                </div>
                <div
                  className="progressTrack"
                  role="progressbar"
                  aria-label={`${job.plantId} 3D 建模與分析整體進度`}
                  aria-valuemin="0"
                  aria-valuemax="100"
                  aria-valuenow={progress.overallPercent}
                >
                  <div className="progressFill" style={{ width: `${progress.overallPercent}%` }} />
                </div>
                <div className="modelingProgressMeta">
                  <span className="recordMeta">
                    {job.submissionSource === 'robot_camera' ? '機械手臂' : '手動上傳'} · {new Date(job.observedAt).toLocaleString('zh-TW')}
                  </span>
                  <span className="recordMeta">第 {progress.attempt || 1}/{progress.maxAttempts || 2} 次嘗試</span>
                  {progress.phase === 'modeling' && Number.isInteger(progress.remotePercent) && (
                    <span className="recordMeta">混元建模 {progress.remotePercent}%</span>
                  )}
                  {progress.retryMode && <span className="recordMeta retryMeta">{retryModeText[progress.retryMode]}</span>}
                  {job.dataHubStatus && <span className="recordMeta">{dataHubStatusText[job.dataHubStatus] || `DataHub: ${job.dataHubStatus}`}</span>}
                  <span className="recordMeta">任務編號：{job.id}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
