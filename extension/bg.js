// Background service worker (MV3)
// - Recebe mensagens do content.js
// - Faz fetch na API e retorna dados

const DEFAULT_API_BASE = 'https://extencao-65j69kpao-daniels-projects-b07af66f.vercel.app';

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
});

// When the user clicks the extension icon, ask the content script
// in the active tab to show the welcome overlay.
try {
  chrome.action.onClicked.addListener((tab) => {
    try {
      if (tab && tab.id != null) {
        chrome.tabs.sendMessage(tab.id, { type: 'SHOW_WELCOME_OVERLAY' });
      }
    } catch (err) {
      console.warn('[bg] onClicked sendMessage error:', err);
    }
  });
} catch {}
