// Background service worker (MV3)
// - Centraliza chamadas à API e automações

const DEFAULT_API_BASE = 'https://extencao-e9v52ezjr-daniels-projects-b07af66f.vercel.app';

function getApiBase() {
  return new Promise((resolve) => {
    try { chrome.storage.sync.get(['API_BASE_URL'], (res) => resolve(res?.API_BASE_URL || DEFAULT_API_BASE)); }
    catch { resolve(DEFAULT_API_BASE); }
  });
}

async function getApiToken() {
  return new Promise((resolve) => {
    try { chrome.storage.sync.get(['API_TOKEN'], (res) => resolve(res?.API_TOKEN || '')); }
    catch { resolve(''); }
  });
}

// ---- API helpers ----
async function fetchFmLastUpdated() {
  const base = await getApiBase();
  const resp = await fetch(base.replace(/\/$/, '') + '/api/fm-last-updated');
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return resp.json();
}

async function fetchFmRanks() {
  const base = await getApiBase();
  const resp = await fetch(base.replace(/\/$/, '') + '/api/fm-ranks');
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return resp.json();
}

async function fetchI10Scores() {
  const base = await getApiBase();
  const resp = await fetch(base.replace(/\/$/, '') + '/api/i10-scores');
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return resp.json();
}

async function fetchTopNChecklist(source = 'fm') {
  const base = await getApiBase();
  const endpoint = source === 'fm_inv10' ? '/api/checklist-inv10' : '/api/checklist';
  const url = base.replace(/\/$/, '') + endpoint;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return resp.json();
}

let fmAbortController = null;
let inv10AbortController = null;

async function postFmCalcular(csvText) {
  const base = await getApiBase();
  const token = await getApiToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const ctrl = fmAbortController; // pode ser null
  const resp = await fetch(base.replace(/\/$/, '') + '/api/formulamagica/calcular', {
    method: 'POST', headers, body: JSON.stringify({ csv: csvText }), signal: ctrl ? ctrl.signal : undefined
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json?.error || ('HTTP ' + resp.status));
  return json;
}

async function postInv10Scrape(tickers, opts = {}) {
  const base = await getApiBase();
  const token = await getApiToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const payload = { tickers: Array.isArray(tickers) ? tickers : [], append: !!opts.append, truncate: !!opts.truncate };
  const resp = await fetch(base.replace(/\/$/, '') + '/api/inv10/scrape', {
    method: 'POST', headers, body: JSON.stringify(payload), signal: opts.signal
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json?.error || ('HTTP ' + resp.status));
  return json;
}

async function postFmFromInv10(minTrue) {
  const base = await getApiBase();
  const token = await getApiToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const resp = await fetch(base.replace(/\/$/, '') + '/api/formulamagica/from-inv10', {
    method: 'POST', headers, body: JSON.stringify({ min_true: minTrue })
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json?.error || ('HTTP ' + resp.status));
  return json;
}

// ---- Investidor10 job runner ----
const INV10_JOB_KEY = 'INV10_JOB';
const INV10_JOB_HISTORY_KEY = 'INV10_JOB_HISTORY';
let inv10RunnerActive = false;
function getJob() { return new Promise((resolve) => { try { chrome.storage.local.get([INV10_JOB_KEY], (r) => resolve(r?.[INV10_JOB_KEY] || null)); } catch { resolve(null); } }); }
function setJob(job) { return new Promise((resolve) => { try { chrome.storage.local.set({ [INV10_JOB_KEY]: job }, () => resolve()); } catch { resolve(); } }); }
function broadcastProgress(job) { try { chrome.runtime.sendMessage({ type: 'INV10_PROGRESS', job }); } catch {} }
function broadcastDone(job) { try { chrome.runtime.sendMessage({ type: 'INV10_DONE', job }); } catch {} }

async function pushJobHistory(job) {
  try {
    const rec = {
      startedAt: job.startedAt || null,
      finishedAt: job.finishedAt || null,
      ok: Number(job.ok || 0),
      fail: Number(job.fail || 0),
      inserted: Number(job.inserted || 0),
      total: Array.isArray(job.tickers) ? job.tickers.length : 0,
      stage: job.stage || (job.running ? 'running' : 'done'),
      canceled: !!job.cancel,
      error: job.lastError || job.error || null,
    };
    const hist = await new Promise((resolve)=>{ try { chrome.storage.local.get([INV10_JOB_HISTORY_KEY], (r)=> resolve(Array.isArray(r?.[INV10_JOB_HISTORY_KEY]) ? r[INV10_JOB_HISTORY_KEY] : [])); } catch { resolve([]); } });
    const next = [rec, ...hist].slice(0, 15);
    await new Promise((resolve)=>{ try { chrome.storage.local.set({ [INV10_JOB_HISTORY_KEY]: next }, ()=> resolve()); } catch { resolve(); } });
  } catch {}
}

async function runInv10Job() {
  if (inv10RunnerActive) return;
  inv10RunnerActive = true;
  try {
    let job = await getJob();
    if (!job || !job.running || !Array.isArray(job.tickers)) { inv10RunnerActive = false; return; }
    if (!job.startedAt) { job.startedAt = new Date().toISOString(); job.stage = 'init'; await setJob(job); }

    if (!job.truncated) {
      try { job.stage = 'truncate'; await setJob(job); broadcastProgress(job); await postInv10Scrape([], { truncate: true }); job.truncated = true; job.stage = 'processing'; }
      catch (e) { job.error = String(e?.message || e); await setJob(job); broadcastProgress(job); inv10RunnerActive = false; return; }
      await setJob(job); broadcastProgress(job);
    }

    const total = job.tickers.length;
    for (let i = job.index || 0; i < total; i++) {
      job.current = job.tickers[i]; job.index = i; job.lastUpdate = new Date().toISOString(); job.currentStartedAt = new Date().toISOString(); job.stage = 'processing';
      await setJob(job); broadcastProgress(job);
      if (job.cancel) { job.running = false; job.stage = 'canceled'; job.finishedAt = new Date().toISOString(); await setJob(job); broadcastDone(job); inv10RunnerActive = false; return; }
      try {
        try { if (inv10AbortController) inv10AbortController.abort(); } catch {}
        inv10AbortController = new AbortController();
        const resp = await postInv10Scrape([job.current], { append: true, signal: inv10AbortController.signal });
        job.inserted = Number(job.inserted || 0) + Number(resp?.inserted || 0);
        job.ok = Number(job.ok || 0) + 1;
      } catch (e) {
        if (e && (e.name === 'AbortError' || /aborted/i.test(String(e)))) { job.cancel = true; break; }
        job.fail = Number(job.fail || 0) + 1; job.lastError = String(e?.message || e);
      }
      await new Promise((r) => setTimeout(r, 250));
      await setJob(job); broadcastProgress(job);
    }
    job.running = false; job.stage = job.cancel ? 'canceled' : 'done'; job.finishedAt = new Date().toISOString(); await setJob(job); await pushJobHistory(job); broadcastDone(job);
  } finally { inv10RunnerActive = false; }
}

// ---- OPEN_SI_DOWNLOAD: abre aba e destaca botão de download ----
async function openSiDownloadAndHighlight() {
  const pageUrl = 'https://statusinvest.com.br/acoes/busca-avancada';
  const tab = await new Promise((resolve)=>{ try { chrome.tabs.create({ url: pageUrl, active: true }, (t)=>resolve(t)); } catch { resolve(null); } });
  if (!tab || tab.id == null) throw new Error('Falha ao abrir aba');
  await new Promise((resolve)=>{
    let done=false; const onUpdated=(tabId,info)=>{ if(tabId===tab.id && info && info.status==='complete' && !done){ done=true; try{ chrome.tabs.onUpdated.removeListener(onUpdated);}catch{} resolve(); } };
    chrome.tabs.onUpdated.addListener(onUpdated);
    setTimeout(()=>{ if(!done){ try{ chrome.tabs.onUpdated.removeListener(onUpdated);}catch{} resolve(); } },15000);
  });
  // pede ao content script para rolar e destacar
  let resp=null; for (let i=0;i<10;i++){ resp = await new Promise((resolve)=>{ try{ chrome.tabs.sendMessage(tab.id, { type:'SI_NAVIGATE_TO_DOWNLOAD' }, (r)=>resolve(r)); } catch { resolve(null);} }); if(resp && (resp.ok||resp.error)) break; await new Promise(r=>setTimeout(r,800)); }
  return resp && resp.ok ? resp : { ok:false, error: resp && resp.error ? resp.error : 'content-script sem resposta' };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === 'FETCH_FM_LAST_UPDATED') {
    (async ()=>{ try { const json = await fetchFmLastUpdated(); sendResponse({ ok:true, json }); } catch(e){ sendResponse({ ok:false, error:String(e?.message||e) }); } })(); return true;
  }
  if (message.type === 'FETCH_FM_RANKS') {
    (async ()=>{ try { const json = await fetchFmRanks(); sendResponse({ ok:true, json }); } catch(e){ sendResponse({ ok:false, error:String(e?.message||e) }); } })(); return true;
  }
  if (message.type === 'FETCH_I10_SCORES') {
    (async ()=>{ try { const json = await fetchI10Scores(); sendResponse({ ok:true, json }); } catch(e){ sendResponse({ ok:false, error:String(e?.message||e) }); } })(); return true;
  }
  if (message.type === 'GET_TOPN_CHECKLIST') {
    (async ()=>{
      try {
        const source = message.source || 'fm';
        const json = await fetchTopNChecklist(source);
        sendResponse({ ok:true, json });
      } catch(e){ sendResponse({ ok:false, error:String(e?.message||e) }); }
    })();
    return true;
  }

  if (message.type === 'FM_CALCULAR') {
    (async ()=>{ try { if (fmAbortController) { try{ fmAbortController.abort(); }catch{} } fmAbortController = new AbortController(); const json = await postFmCalcular(String(message.csv||'')); sendResponse({ ok:true, json }); } catch(e){ sendResponse({ ok:false, error:String(e?.message||e) }); } finally { fmAbortController = null; } })(); return true;
  }

  if (message.type === 'INV10_SCRAPE') {
    (async ()=>{ try { const tickers = Array.isArray(message.tickers) ? message.tickers : []; inv10AbortController = inv10AbortController || new AbortController(); const json = await postInv10Scrape(tickers, { append: message.append, truncate: message.truncate, signal: inv10AbortController.signal }); sendResponse({ ok:true, json }); } catch(e){ sendResponse({ ok:false, error:String(e?.message||e) }); } })(); return true;
  }

  if (message.type === 'INV10_START') {
    (async ()=>{
      try {
        const tickers = (Array.isArray(message.tickers)?message.tickers:[]).map(t=>String(t||'').toUpperCase());
        if (!tickers.length) { sendResponse({ ok:false, error:'tickers vazios' }); return; }
        // Cancela job anterior se houver
        const existing = await getJob();
        if (existing && existing.running) {
          try { existing.cancel = true; await setJob(existing); broadcastProgress(existing); if (inv10AbortController) inv10AbortController.abort(); } catch {}
          await new Promise(r=>setTimeout(r,300));
        }
        const job = { running:true, tickers, index:0, ok:0, fail:0, inserted:0, truncated:false, startedAt:new Date().toISOString(), lastUpdate:new Date().toISOString() };
        await setJob(job); broadcastProgress(job);
        // Garante novo runner mesmo se a flag estiver presa
        try { inv10RunnerActive = false; } catch {}
        runInv10Job();
        sendResponse({ ok:true });
      } catch(e){ sendResponse({ ok:false, error:String(e?.message||e) }); }
    })();
    return true;
  }
  if (message.type === 'INV10_GET_JOB') {
    (async ()=>{ const job = await getJob(); if (job && job.running && !inv10RunnerActive) runInv10Job(); sendResponse({ ok:true, job }); })(); return true;
  }
  if (message.type === 'INV10_GET_HISTORY') {
    (async ()=>{ try { const hist = await new Promise((resolve)=>{ try { chrome.storage.local.get([INV10_JOB_HISTORY_KEY], (r)=> resolve(Array.isArray(r?.[INV10_JOB_HISTORY_KEY]) ? r[INV10_JOB_HISTORY_KEY] : [])); } catch { resolve([]); } }); sendResponse({ ok:true, history: hist }); } catch(e){ sendResponse({ ok:false, error:String(e?.message||e) }); } })(); return true;
  }
  if (message.type === 'INV10_CLEAR_HISTORY') {
    (async ()=>{ try { await new Promise((resolve)=>{ try { chrome.storage.local.set({ [INV10_JOB_HISTORY_KEY]: [] }, ()=> resolve()); } catch { resolve(); } }); sendResponse({ ok:true }); } catch(e){ sendResponse({ ok:false, error:String(e?.message||e) }); } })(); return true;
  }
  if (message.type === 'INV10_CANCEL') {
    (async ()=>{ const job = await getJob(); if (job && job.running) { job.cancel = true; await setJob(job); broadcastProgress(job); } try { if (inv10AbortController) inv10AbortController.abort(); } catch {} sendResponse({ ok:true }); })(); return true;
  }

  if (message.type === 'FM_CANCEL') { try { if (fmAbortController) fmAbortController.abort(); } catch {} sendResponse({ ok:true }); return true; }

  if (message.type === 'OPEN_SI_DOWNLOAD') {
    (async ()=>{ try { const r = await openSiDownloadAndHighlight(); sendResponse({ ok: !!(r && r.ok), resp: r }); } catch(e){ sendResponse({ ok:false, error:String(e?.message||e) }); } })(); return true;
  }

  if (message.type === 'FM_FROM_INV10') {
    (async ()=>{ try { const min = Number(message.min_true || 6); const json = await postFmFromInv10(min); sendResponse({ ok:true, json }); } catch(e){ sendResponse({ ok:false, error:String(e?.message||e) }); } })(); return true;
  }
});
