// Content script para página de Busca Avançada do StatusInvest
// Responde a mensagens para coletar o CSV de exportação usando as credenciais do usuário
(function(){
  function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
  async function clickIfVisible(sel){ try{ const el=document.querySelector(sel); if(el && el.offsetParent!==null){ el.click(); await sleep(300); return true; } }catch{} return false; }
  async function acceptCookies(){ const sels=['#onetrust-accept-btn-handler','button.cookie-accept','button[aria-label="aceitar"]']; for(const s of sels){ if(await clickIfVisible(s)) return; } }
  async function clickBuscar(){ const sels=['button[type="submit"]','button:has(span)','button']; for(const s of sels){ const btns=[...document.querySelectorAll(s)].filter(b=>/buscar/i.test(b.textContent||'')); if(btns.length){ btns[0].click(); await sleep(600); return true; } } return false; }
  function findDownloadLink(){
    // 1) por classe
    let a = document.querySelector('a.btn-download');
    if (a && a.href) return a.href;
    // 2) por texto
    const anchors = Array.from(document.querySelectorAll('a'));
    for (const el of anchors){
      const t=(el.textContent||'').trim();
      const h=(el.getAttribute('href')||'').trim();
      if ((/download|exportar/i.test(t) || /download|export|csv/i.test(h)) && (el.href||h)){
        return el.href || h;
      }
    }
    return null;
  }
  async function fetchCSV(absUrl){
    const resp = await fetch(absUrl, { credentials: 'include' });
    if (!resp.ok) throw new Error('HTTP '+resp.status);
    const text = await resp.text();
    return text;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'SI_NAVIGATE_TO_DOWNLOAD') {
      (async () => {
        try {
          await acceptCookies();
          await clickBuscar().catch(()=>{});
          let href=null, tries=0; let targetEl=null;
          while(!href && tries<20){
            // find element and href
            targetEl = document.querySelector('a.btn-download');
            if (!targetEl){
              const anchors = Array.from(document.querySelectorAll('a'));
              targetEl = anchors.find(el => /download|exportar/i.test((el.textContent||'')) || /download|export|csv/i.test((el.getAttribute('href')||'')) ) || null;
            }
            if (targetEl && (targetEl.href || targetEl.getAttribute('href'))) href = targetEl.href || targetEl.getAttribute('href');
            if (!href){ await sleep(500); tries++; }
          }
          if (targetEl){
            try { targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
            try { targetEl.tabIndex = -1; targetEl.focus({ preventScroll: true }); } catch {}
            try { targetEl.style.outline = '3px solid #60a5fa'; targetEl.style.outlineOffset = '2px'; } catch {}
          }
          if (!href){ sendResponse({ ok:false, error:'Link de download não encontrado' }); return; }
          const abs = href.startsWith('http') ? href : new URL(href, location.href).toString();
          sendResponse({ ok:true, href: abs });
        } catch(e){ sendResponse({ ok:false, error: String(e && (e.message||e)) }); }
      })();
      return true;
    }
    if (msg.type === 'SI_GET_CSV_URL') {
      (async () => {
        try {
          await acceptCookies();
          await clickBuscar().catch(()=>{});
          let href=null, tries=0; while(!href && tries<20){ href = findDownloadLink(); if(!href){ await sleep(500); tries++; } }
          if (!href){ sendResponse({ ok:false, error:'Link de download não encontrado' }); return; }
          const abs = href.startsWith('http') ? href : new URL(href, location.href).toString();
          sendResponse({ ok:true, href: abs, file: 'last_downloaddia'+String(new Date().getDate()).padStart(2,'0')+'.csv' });
        } catch(e){ sendResponse({ ok:false, error: String(e && (e.message||e)) }); }
      })();
      return true;
    }
    if (msg.type === 'SI_FETCH_CSV'){
      (async () => {
        try{
          await acceptCookies();
          await clickBuscar().catch(()=>{});
          // aguarda link ficar disponível
          let href = null; let tries=0;
          while(!href && tries<20){ href = findDownloadLink(); if (!href) { await sleep(500); tries++; } }
          if (!href){ sendResponse({ ok:false, error:'Link de download não encontrado' }); return; }
          const abs = href.startsWith('http') ? href : new URL(href, location.href).toString();
          const csv = await fetchCSV(abs);
          sendResponse({ ok:true, file: 'last_downloaddia'+String(new Date().getDate()).padStart(2,'0')+'.csv', csv });
        }catch(e){ sendResponse({ ok:false, error: String(e && (e.message||e)) }); }
      })();
      return true;
    }
  });
})();
