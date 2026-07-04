'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { parseImportFile } from '@/lib/importParser';

function todayValue() {
  return new Date().toISOString().slice(0, 10);
}

function isExcel(file) {
  return /\.(xlsx|xls)$/i.test(file?.name || '');
}

function displayDate(value) {
  return new Date(value).toLocaleDateString();
}

function batchProgress(batch) {
  const done = (batch.uploaded || 0) + (batch.failed || 0);
  const total = batch.total || 0;
  return total > 0 ? Math.min(Math.round((done / total) * 100), 100) : 0;
}

export function ImportObservations() {
  const { getIdToken } = useAuth();
  const fileInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [day0Date, setDay0Date] = useState(todayValue());
  const [parsed, setParsed] = useState(null);
  const [message, setMessage] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [runningBatches, setRunningBatches] = useState([]);
  const [polling, setPolling] = useState(false);
  const emptyPollCountRef = useRef(0);

  async function loadRunningBatches() {
    try {
      const token = await getIdToken();
      const response = await fetch('/api/imports/observations/batches?limit=20', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '讀取匯入進度失敗');
      const syncingBatches = (data.batches || []).filter(batch => batch.status === 'syncing');
      setRunningBatches(syncingBatches);
      return syncingBatches;
    } catch {
      setRunningBatches([]);
      return [];
    }
  }

  useEffect(() => {
    async function initialLoad() {
      const batches = await loadRunningBatches();
      if (batches.length > 0) setPolling(true);
    }

    initialLoad();
  }, [getIdToken]);

  useEffect(() => {
    if (!polling) return undefined;

    let cancelled = false;
    let timer;

    async function tick() {
      if (cancelled) return;
      const batches = await loadRunningBatches();
      if (cancelled) return;

      if (batches.length === 0) {
        emptyPollCountRef.current += 1;
        if (emptyPollCountRef.current >= 3) {
          setPolling(false);
          return;
        }
      } else {
        emptyPollCountRef.current = 0;
      }

      timer = window.setTimeout(tick, 2000);
    }

    tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [polling, getIdToken]);

  async function parseSelectedFile(nextFile = file, nextDay0Date = day0Date) {
    if (!nextFile) return;
    setParsing(true);
    setMessage(null);
    setSyncResult(null);
    try {
      const result = await parseImportFile(nextFile, { day0Date: nextDay0Date });
      setParsed(result);
      if (result.errors.length > 0) {
        setMessage({ type: 'error', text: `解析完成，但有 ${result.errors.length} 筆問題需要確認` });
      } else {
        setMessage({ type: 'ok', text: `解析完成，共 ${result.observations.length} 筆可同步資料` });
      }
    } catch (error) {
      setParsed(null);
      setMessage({ type: 'error', text: error.message || '解析檔案失敗' });
    } finally {
      setParsing(false);
    }
  }

  function handleFileChange(event) {
    const nextFile = event.target.files?.[0] || null;
    setFile(nextFile);
    setParsed(null);
    setSyncResult(null);
    if (nextFile) parseSelectedFile(nextFile, day0Date);
  }

  function handleDay0Change(event) {
    const nextDay0Date = event.target.value;
    setDay0Date(nextDay0Date);
    if (file && isExcel(file)) parseSelectedFile(file, nextDay0Date);
  }

  async function syncImport() {
    if (!parsed?.observations.length || parsed.errors.length > 0) return;
    setSyncing(true);
    setMessage(null);
    setSyncResult(null);
    try {
      const token = await getIdToken();
      const response = await fetch('/api/imports/observations/sync', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fileName: file?.name || '',
          format: parsed.format,
          observations: parsed.observations
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '匯入同步失敗');
      setSyncResult(data);
      setMessage({ type: 'ok', text: `已建立匯入批次 ${data.batchId}，背景同步中，可關閉頁面` });
      setFile(null);
      setParsed(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await loadRunningBatches();
      emptyPollCountRef.current = 0;
      setPolling(true);
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setSyncing(false);
    }
  }

  const preview = parsed?.observations.slice(0, 10) || [];
  const canSync = Boolean(parsed?.observations.length) && parsed.errors.length === 0 && !syncing;

  return (
    <section className="card importCard">
      <div className="recordHead">
        <div>
          <p className="eyebrow">Batch Import</p>
          <h2>Excel / CSV 批量同步</h2>
        </div>
      </div>
      <p className="muted compactText">支援傳統csv與新版excel</p>
      <div className="importControls">
        <label className="field">
          <span>選擇檔案</span>
          <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFileChange} />
        </label>
        {isExcel(file) && (
          <label className="field">
            <span>Day 0 對應日期</span>
            <input type="date" value={day0Date} onChange={handleDay0Change} />
          </label>
        )}
      </div>
      {parsing && <p className="muted">解析中...</p>}
      {message && <div className={`notice ${message.type === 'error' ? 'error' : ''}`}>{message.text}</div>}
      {parsed && (
        <div className="importSummary">
          <div className="recordMeta">格式：{parsed.format}</div>
          <div className="recordMeta">可同步：{parsed.observations.length} 筆，問題：{parsed.errors.length} 筆</div>
          {parsed.errors.length > 0 && (
            <div className="errorList">
              {parsed.errors.slice(0, 6).map((error, index) => (
                <div key={`${error.row}-${index}`} className="recordMeta">第 {error.row} 列：{error.message}</div>
              ))}
            </div>
          )}
          {preview.length > 0 && (
            <div className="previewTableWrap">
              <table className="previewTable">
                <thead>
                  <tr>
                    <th>植株</th>
                    <th>日期</th>
                    <th>高度</th>
                    <th>節點</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((item, index) => (
                    <tr key={`${item.plantId}-${item.observedAt}-${index}`}>
                      <td>{item.plantId}</td>
                      <td>{displayDate(item.observedAt)}</td>
                      <td>{item.height}</td>
                      <td>{item.nodes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button className="primaryButton" onClick={syncImport} disabled={!canSync}>{syncing ? '建立批次中...' : `確認同步這批資料 (${parsed.observations.length})`}</button>
        </div>
      )}
      {syncResult?.failed > 0 && (
        <div className="errorList">
          {syncResult.results.filter(item => item.status === 'failed').slice(0, 8).map(item => (
            <div key={`${item.index}-${item.plantId}`} className="recordMeta">{item.plantId} {displayDate(item.observedAt)}：{item.error}</div>
          ))}
        </div>
      )}
      {syncResult?.batchId && <div className="recordMeta">已存入 DB 匯入批次：{syncResult.batchId}</div>}
      {runningBatches.length > 0 && (
        <div className="runningBatches">
          <div className="recordTitle">背景同步進度</div>
          {runningBatches.map(batch => {
            const done = (batch.uploaded || 0) + (batch.failed || 0);
            const progress = batchProgress(batch);
            return (
              <div className="progressItem" key={batch.id}>
                <div className="recordHead">
                  <div>
                    <div className="recordTitle">{batch.fileName || '未命名檔案'}</div>
                    <div className="recordMeta">{done} / {batch.total || 0} 筆，成功 {batch.uploaded || 0}，失敗 {batch.failed || 0}</div>
                  </div>
                  <span className="recordMeta">{progress}%</span>
                </div>
                <div className="progressTrack" aria-label={`${batch.fileName || '匯入批次'} 同步進度`}>
                  <div className="progressFill" style={{ width: `${progress}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
