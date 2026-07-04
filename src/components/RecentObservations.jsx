'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';

function statusText(status) {
  return {
    pending: '尚未同步',
    uploading: '同步中',
    uploaded: '已同步',
    failed: '同步失敗'
  }[status] || status;
}

function canEdit(item) {
  return item.uploadStatus === 'pending' || item.uploadStatus === 'failed';
}

function toLocalInputValue(value) {
  const date = new Date(value);
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function RecentObservations() {
  const { getIdToken } = useAuth();
  const [observations, setObservations] = useState([]);
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState({ page: 1, pageSize: 10, hasNext: false, hasPrev: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);

  async function load(options = {}) {
    setLoading(true);
    setError(null);
    if (options.clearMessage !== false) setMessage(null);
    try {
      const token = await getIdToken();
      const response = await fetch(`/api/observations?limit=10&page=${page}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '讀取失敗');
      setObservations(data.observations);
      setPageInfo({
        page: data.page,
        pageSize: data.pageSize,
        hasNext: data.hasNext,
        hasPrev: data.hasPrev
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load({ clearMessage: false });
  }, [page]);

  useEffect(() => {
    function reloadFromFirstPage() {
      if (page === 1) {
        load();
      } else {
        setPage(1);
      }
    }
    window.addEventListener('observations:changed', reloadFromFirstPage);
    return () => window.removeEventListener('observations:changed', reloadFromFirstPage);
  }, [page]);

  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => setMessage(null), 3000);
    return () => window.clearTimeout(timer);
  }, [message]);

  function startEdit(item) {
    setEditingId(item.id);
    setEditForm({
      plantId: item.plantId,
      observedAt: toLocalInputValue(item.observedAt),
      height: String(item.height),
      nodes: String(item.nodes),
      note: item.note || ''
    });
  }

  function updateEditField(name, value) {
    setEditForm(current => ({ ...current, [name]: value }));
  }

  async function saveEdit(id) {
    const token = await getIdToken();
    const response = await fetch(`/api/observations/${id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        plantId: editForm.plantId,
        observedAt: new Date(editForm.observedAt).toISOString(),
        height: Number(editForm.height),
        nodes: Number(editForm.nodes),
        note: editForm.note
      })
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || '修改失敗');
      return;
    }
    setEditingId(null);
    setEditForm(null);
    setMessage('已更新，狀態維持尚未同步');
    if (page !== 1) setPage(1);
    await load({ clearMessage: false });
  }

  async function deleteObservation(id) {
    if (!window.confirm('確定刪除這筆未同步資料？')) return;
    const token = await getIdToken();
    const response = await fetch(`/api/observations/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || '刪除失敗');
      return;
    }
    setMessage('已刪除未同步資料');
    await load({ clearMessage: false });
  }

  async function syncAll() {
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const token = await getIdToken();
      const response = await fetch('/api/observations/sync', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '同步失敗');
      setMessage(`同步完成：成功 ${data.uploaded} 筆，失敗 ${data.failed} 筆`);
      if (page !== 1) setPage(1);
      await load({ clearMessage: false });
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  }

  const counts = observations.reduce((acc, item) => {
    acc[item.uploadStatus] = (acc[item.uploadStatus] || 0) + 1;
    return acc;
  }, {});
  const unsyncedCount = (counts.pending || 0) + (counts.failed || 0);
  const hasUnsavedEdit = Boolean(editingId);

  return (
    <section className="card">
      <div className="recordHead">
        <h2>最近紀錄</h2>
        <button className="smallButton" onClick={load}>重新整理</button>
      </div>
      {loading && <p className="muted">讀取中...</p>}
      {error && <div className="notice error">{error}</div>}
      {message && <div className="notice">{message}</div>}
      <div className="syncPanel">
        <div className="recordMeta">尚未同步 {counts.pending || 0} 筆，同步失敗 {counts.failed || 0} 筆，已同步 {counts.uploaded || 0} 筆</div>
        {hasUnsavedEdit && <div className="recordMeta">請先儲存或取消目前修改，再同步到 DataHub。</div>}
        <button className="primaryButton" onClick={syncAll} disabled={syncing || unsyncedCount === 0 || hasUnsavedEdit}>
          {syncing ? '同步中...' : `確認同步到 DataHub (${unsyncedCount})`}
        </button>
      </div>
      {!loading && observations.length === 0 && <p className="muted">尚無觀測資料。</p>}
      <div className="pager">
        <button className="smallButton" onClick={() => setPage(current => Math.max(current - 1, 1))} disabled={!pageInfo.hasPrev || loading}>上一頁</button>
        <span className="recordMeta">第 {pageInfo.page} 頁，每頁 10 筆</span>
        <button className="smallButton" onClick={() => setPage(current => current + 1)} disabled={!pageInfo.hasNext || loading}>下一頁</button>
      </div>
      <div className="records">
        {observations.map(item => (
          <article className="record" key={item.id}>
            <div className="recordHead">
              <div>
                <div className="recordTitle">{item.plantId}</div>
                <div className="recordMeta">{new Date(item.observedAt).toLocaleString()}</div>
              </div>
              <span className={`status ${item.uploadStatus}`}>{statusText(item.uploadStatus)}</span>
            </div>
            {editingId === item.id ? (
              <div className="editGrid">
                <label className="field">
                  <span>植株編號</span>
                  <input value={editForm.plantId} onChange={event => updateEditField('plantId', event.target.value)} />
                </label>
                <label className="field">
                  <span>觀測日期時間</span>
                  <input type="datetime-local" value={editForm.observedAt} onChange={event => updateEditField('observedAt', event.target.value)} />
                </label>
                <label className="field">
                  <span>植株高度</span>
                  <input type="number" value={editForm.height} onChange={event => updateEditField('height', event.target.value)} />
                </label>
                <label className="field">
                  <span>結點數</span>
                  <input type="number" value={editForm.nodes} onChange={event => updateEditField('nodes', event.target.value)} />
                </label>
                <label className="field fullWidth">
                  <span>備註</span>
                  <textarea value={editForm.note} onChange={event => updateEditField('note', event.target.value)} />
                </label>
                <div className="actionRow fullWidth">
                  <button className="smallButton" onClick={() => saveEdit(item.id)}>儲存修改</button>
                  <button className="smallButton dangerButton" onClick={() => setEditingId(null)}>取消</button>
                </div>
              </div>
            ) : (
              <>
                <div className="recordMeta">高度 {item.height}，結點 {item.nodes}</div>
                {item.note && <div className="recordMeta">備註：{item.note}</div>}
              </>
            )}
            {item.lastError && <div className="notice error">{item.lastError}</div>}
            {canEdit(item) && editingId !== item.id && (
              <div className="actionRow">
                <button className="smallButton" onClick={() => startEdit(item)}>修改</button>
                <button className="smallButton dangerButton" onClick={() => deleteObservation(item.id)}>刪除</button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
