// Background service worker (MV3)
// - Recebe mensagens do content.js
// - Faz fetch na API e retorna dados

const DEFAULT_API_BASE = 'https://extencao-k1unlzdlq-daniels-projects-b07af66f.vercel.app';

function getApiBase() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['API_BASE_URL'], (res) => {
      resolve(res.API_BASE_URL || DEFAULT_API_BASE);
    });
  });
}

async function fetchStatusInvestLatest() {
  const base = await getApiBase();
  const url = `${base.replace(/\/$/, '')}/api/statusinvest-latest`;
  const resp = await fetch(url, { method: 'GET' });
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  return resp.json();
}

async function fetchFmRanks() {
  const base = await getApiBase();
  const url = `${base.replace(/\/$/, '')}/api/fm-ranks`;
  console.log('[bg] FETCH_FM_RANKS →', url);
  const resp = await fetch(url, { method: 'GET' });
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  const json = await resp.json();
  console.log('[bg] FETCH_FM_RANKS ok. count:', Array.isArray(json?.data) ? json.data.length : 'n/a');
  return json;
}

async function fetchFmLastUpdated() {
  const base = await getApiBase();
  const url = `${base.replace(/\/$/, '')}/api/fm-last-updated`;
  console.log('[bg] FETCH_FM_LAST_UPDATED →', url);
  const resp = await fetch(url, { method: 'GET' });
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  const json = await resp.json();
  console.log('[bg] FETCH_FM_LAST_UPDATED ok. col:', json?.column, 'last:', json?.last_updated);
  return json;
}

async function fetchI10Scores() {
  const base = await getApiBase();
  const url = `${base.replace(/\/$/, '')}/api/i10-scores`;
  console.log('[bg] FETCH_I10_SCORES →', url);
  const resp = await fetch(url, { method: 'GET' });
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  const json = await resp.json();
  console.log('[bg] FETCH_I10_SCORES ok. count:', Array.isArray(json?.data) ? json.data.length : 'n/a');
  return json;
}

async function fetchTopNChecklist() {
  const base = await getApiBase();
  const url = `${base.replace(/\/$/, '')}/api/checklist`;
  console.log('[bg] GET_TOPN_CHECKLIST →', url);
  const resp = await fetch(url, { method: 'GET' });
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  const json = await resp.json();
  console.log('[bg] GET_TOPN_CHECKLIST ok. count:', Array.isArray(json?.data) ? json.data.length : 'n/a');
  return json;
}

async function getApiToken() {
  return new Promise((resolve) => {
    try { chrome.storage.sync.get(['API_TOKEN'], (res) => resolve(res?.API_TOKEN || '')); } catch { resolve(''); }
  });
}

// Abort Controllers (FM and INV10)
let fmAbortController = null;
let inv10AbortController = null;

async function postFmCalcular(csvText) {
  const base = await getApiBase();
  const token = await getApiToken();
  const url = `${base.replace(/\/$/, '')}/api/formulamagica/calcular`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ csv: csvText }), signal: fmAbortController ? fmAbortController.signal : undefined });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json?.error || `HTTP ${resp.status}`);
  return json;
}
async function postInv10Scrape(tickers, opts = {}) {
  const base = await getApiBase();
  const token = await getApiToken();
  const url = `${base.replace(/\/$/, '')}/api/inv10/scrape`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const payload = {
    tickers: Array.isArray(tickers) ? tickers : [],
    append: Boolean(opts.append),
    truncate: Boolean(opts.truncate),
  };
  const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: opts.signal });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json?.error || `HTTP ${resp.status}`);
  return json;
}

// ----------------------
// Investidor10 job runner (persist progress across popup restarts)
// ----------------------
const INV10_JOB_KEY = 'INV10_JOB';
let inv10RunnerActive = false;

function getJob() {
  return new Promise((resolve) => {
    try { chrome.storage.local.get([INV10_JOB_KEY], (res) => resolve(res?.[INV10_JOB_KEY] || null)); }
    catch { resolve(null); }
  });
}
function setJob(job) {
  return new Promise((resolve) => {
    try { chrome.storage.local.set({ [INV10_JOB_KEY]: job }, () => resolve()); }
    catch { resolve(); }
  });
}
function broadcastProgress(job) { try { chrome.runtime.sendMessage({ type: 'INV10_PROGRESS', job }); } catch {} }
function broadcastDone(job) { try { chrome.runtime.sendMessage({ type: 'INV10_DONE', job }); } catch {} }

async function runInv10Job() {
  if (inv10RunnerActive) return;
  inv10RunnerActive = true;
  try {
    let job = await getJob();
    if (!job || !job.running || !Array.isArray(job.tickers)) { inv10RunnerActive = false; return; }
    if (!job.startedAt) { job.startedAt = new Date().toISOString(); await setJob(job); }

    // 1) Truncate once
    if (!job.truncated) {
      try { await postInv10Scrape([], { truncate: true }); job.truncated = true; }
      catch (e) { job.error = String(e?.message || e); await setJob(job); broadcastProgress(job); inv10RunnerActive = false; return; }
      await setJob(job); broadcastProgress(job);
    }

    // 2) Iterate remaining tickers
    const total = job.tickers.length;
    for (let i = job.index || 0; i < total; i++) {
      job.current = job.tickers[i];
      job.index = i;
      job.lastUpdate = new Date().toISOString();
      await setJob(job); broadcastProgress(job);
      if (job.cancel) { job.running = false; job.finishedAt = new Date().toISOString(); await setJob(job); broadcastDone(job); inv10RunnerActive = false; return; }
      try {
        // Abort support per-request
        try { if (inv10AbortController) inv10AbortController.abort(); } catch {}
        inv10AbortController = new AbortController();
        const resp = await postInv10Scrape([job.current], { append: true, signal: inv10AbortController.signal });
        const ins = Number(resp?.inserted || 0);
        job.inserted = Number(job.inserted || 0) + ins;
        job.ok = Number(job.ok || 0) + 1;
      } catch (e) {
        if (e && (e.name === 'AbortError' || /aborted/i.test(String(e)))) { job.cancel = true; break; }
        job.fail = Number(job.fail || 0) + 1;
        job.lastError = String(e?.message || e);
      }
      await new Promise((r) => setTimeout(r, 250));
      await setJob(job); broadcastProgress(job);
    }
    job.running = false; job.finishedAt = new Date().toISOString();
    await setJob(job); broadcastDone(job);
  } finally { inv10RunnerActive = false; }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === 'FETCH_STATUSINVEST') {
    (async () => {
      try {
        const json = await fetchStatusInvestLatest();
        sendResponse({ ok: true, json });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true; // keeps the message channel open for async response
  }

  if (message.type === 'FETCH_FM_RANKS') {
    (async () => {
      try {
        const json = await fetchFmRanks();
        sendResponse({ ok: true, json });
      } catch (err) {
        console.error('[bg] FETCH_FM_RANKS error:', err);
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (message.type === 'FETCH_FM_LAST_UPDATED') {
    (async () => {
      try {
        const json = await fetchFmLastUpdated();
        sendResponse({ ok: true, json });
      } catch (err) {
        console.error('[bg] FETCH_FM_LAST_UPDATED error:', err);
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (message.type === 'FETCH_I10_SCORES') {
    (async () => {
      try {
        const json = await fetchI10Scores();
        sendResponse({ ok: true, json });
      } catch (err) {
        console.error('[bg] FETCH_I10_SCORES error:', err);
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (message.type === 'GET_TOPN_CHECKLIST') {
    (async () => {
      try {
        const json = await fetchTopNChecklist();
        sendResponse({ ok: true, json });
      } catch (err) {
        console.error('[bg] GET_TOPN_CHECKLIST error:', err);
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (message.type === 'FM_CALCULAR') {
    (async () => {
      try {
        if (fmAbortController) try { fmAbortController.abort(); } catch {}
        fmAbortController = new AbortController();
        const json = await postFmCalcular(String(message.csv || ''));
        sendResponse({ ok: true, json });
      } catch (err) {
        console.error('[bg] FM_CALCULAR error:', err);
        sendResponse({ ok: false, error: String(err?.message || err) });
      } finally { fmAbortController = null; }
    })();
    return true;
  }
  if (message.type === 'INV10_SCRAPE') {
    (async () => {
      try {
        const tickers = Array.isArray(message.tickers) ? message.tickers : [];
        inv10AbortController = inv10AbortController || new AbortController();
        const json = await postInv10Scrape(tickers, { append: message.append, truncate: message.truncate, signal: inv10AbortController.signal });
        sendResponse({ ok: true, json });
      } catch (err) {
        console.error('[bg] INV10_SCRAPE error:', err);
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (message.type === 'INV10_START') {
    (async () => {
      try {
        const tickers = (Array.isArray(message.tickers) ? message.tickers : []).map((t) => String(t || '').toUpperCase());
        if (!tickers.length) { sendResponse({ ok: false, error: 'tickers vazios' }); return; }
        const existing = await getJob();
        if (existing && existing.running) { sendResponse({ ok: true, job: existing }); return; }
        const job = { running: true, tickers, index: 0, ok: 0, fail: 0, inserted: 0, truncated: false, startedAt: new Date().toISOString(), lastUpdate: new Date().toISOString() };
        await setJob(job);
        broadcastProgress(job);
        runInv10Job();
        sendResponse({ ok: true, job });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (message.type === 'INV10_GET_JOB') {
    (async () => {
      const job = await getJob();
      if (job && job.running && !inv10RunnerActive) runInv10Job();
      sendResponse({ ok: true, job });
    })();
    return true;
  }

  if (message.type === 'INV10_CANCEL') {
    (async () => {
      const job = await getJob();
      if (job && job.running) { job.cancel = true; await setJob(job); broadcastProgress(job); }
      try { if (inv10AbortController) inv10AbortController.abort(); } catch {}
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === 'FM_CANCEL') {
    try { if (fmAbortController) fmAbortController.abort(); } catch {}
    sendResponse({ ok: true });
    return true;
  }
});
// Popup (popup.html) handles the UI on click; no onClicked handler here.
