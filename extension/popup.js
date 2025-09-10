/* Popup logic: small demo actions and background messaging */
(function () {
  const $ = (sel) => document.querySelector(sel);
  const log = (msg) => { const el = $('#log'); if (el) el.textContent = String(msg || ''); };

  // removed btnOi (Mostrar oi)

  const btnPing = $('#btnPing');
  if (btnPing) btnPing.addEventListener('click', () => {
    try {
      chrome.runtime.sendMessage({ type: 'FETCH_FM_LAST_UPDATED' }, (resp) => {
        if (resp && resp.ok) {
          const ts = resp.json?.last_updated || resp.json?.generated_at || 'ok';
          log(`API ok: ${ts}`);
        } else {
          log(`Erro: ${resp?.error || 'falha desconhecida'}`);
        }
      });
    } catch (e) { log(String(e)); }
  });

  const openOptions = $('#openOptions');
  if (openOptions) openOptions.addEventListener('click', () => {
    try { chrome.runtime.openOptionsPage && chrome.runtime.openOptionsPage(); } catch {}
  });

  // CSV upload UI (reorganizado)
  const fileInput = $('#fileInput');
  const btnUploadFile = $('#btnUploadFile');
  const btnExecutar = $('#btnExecutar');
  const btnCancelar = $('#btnCancelar');
  const btnDownloadAuto = $('#btnDownloadAuto');
  const execTipo = $('#execucaoTipo');
  const fileName = $('#fileName');
  const statusArea = $('#statusArea');
  
  // Progress UI
  const progress = $('#progress');
  const progressBar = $('#progressBar');
  const progressText = $('#progressText');
  const progressInfo = $('#progressInfo');
  let jobPollIv = null;
  function setProgress(total, done) {
    if (!progress || !progressBar || !progressText) return;
    total = Number(total || 0); done = Number(done || 0);
    const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0;
    progress.style.display = total > 0 ? 'block' : 'none';
    progress.setAttribute('aria-hidden', total > 0 ? 'false' : 'true');
    progressBar.style.width = pct + '%';
    progressText.textContent = total > 0 ? (`Progresso: ${pct}% (${done}/${total})`) : '';
  }
  function setProgressInfo(job) {
    if (!progressInfo) return;
    if (!job || !job.running) { progressInfo.textContent = ''; return; }
    const stage = job.stage || 'processing';
    const current = job.current || '';
    const start = job.startedAt ? new Date(job.startedAt) : null;
    const total = Array.isArray(job.tickers) ? job.tickers.length : 0;
    const done = (Number(job.ok || 0) + Number(job.fail || 0));
    let etaTxt = '';
    try {
      if (start && total > 0 && done > 0) {
        const elapsed = (Date.now() - start.getTime()) / 1000; // s
        const rate = elapsed / done;
        const remain = Math.max(0, Math.round(rate * (total - done)));
        const mm = String(Math.floor(remain / 60)).padStart(2, '0');
        const ss = String(remain % 60).padStart(2, '0');
        etaTxt = ` • ETA: ~${mm}:${ss}`;
      }
    } catch {}
    progressInfo.textContent = `Etapa: ${stage}${current ? ' • Ticker: ' + current : ''}${etaTxt}`;
  }

  function stopJobPolling() {
    if (jobPollIv) { try { clearInterval(jobPollIv); } catch {} jobPollIv = null; }
  }
  function startJobPolling() {
    stopJobPolling();
    jobPollIv = setInterval(() => {
      try {
        chrome.runtime.sendMessage({ type: 'INV10_GET_JOB' }, (resp) => {
          const j = resp && resp.ok ? (resp.job || null) : null;
          if (!j || !j.running) { stopJobPolling(); return; }
          const total = (j.tickers || []).length || Number(j.total || 0);
          const done = (Number(j.ok || 0) + Number(j.fail || 0));
          setProgress(total, done);
          setProgressInfo(j);
        });
      } catch {}
    }, 1000);
  }

  function setStatus(text) { if (statusArea) statusArea.textContent = text; }
  function setFileName(text) { if (fileName) fileName.textContent = text; }
  function setUploadEnabled(enabled) { if (btnUploadFile) btnUploadFile.disabled = !enabled; }

  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (file) {
        setFileName(`Arquivo selecionado: ${file.name}`);
        setStatus('Arquivo pronto para upload');
        setUploadEnabled(true);
      } else {
        setFileName('');
        setStatus('Nenhum arquivo selecionado');
        setUploadEnabled(false);
      }
    });
  }

  // (handlers antigos removidos; handlers reais mais abaixo)

  // Persistência e lista de itens salvos
  const STORAGE_KEY = 'csv_items';
  const SELECTED_KEY = 'csv_selected_id';
  const savedList = $('#savedList');
  const jobHistory = $('#jobHistory');

  function stGet(keys) { return new Promise((resolve) => chrome.storage.local.get(keys, resolve)); }
  function stSet(obj) { return new Promise((resolve) => chrome.storage.local.set(obj, resolve)); }

  async function loadItems() {
    const res = await stGet([STORAGE_KEY, SELECTED_KEY]);
    const items = Array.isArray(res[STORAGE_KEY]) ? res[STORAGE_KEY] : [];
    const selectedId = res[SELECTED_KEY] != null ? String(res[SELECTED_KEY]) : null;
    return { items, selectedId };
  }

  async function saveItems(items) {
    await stSet({ [STORAGE_KEY]: items });
  }

  async function setSelected(id) {
    await stSet({ [SELECTED_KEY]: id != null ? String(id) : null });
  }

  function fmtSize(bytes) {
    try {
      if (!bytes && bytes !== 0) return '';
      const kb = bytes / 1024;
      if (kb < 1024) return `${kb.toFixed(1)} KB`;
      return `${(kb / 1024).toFixed(2)} MB`;
    } catch { return ''; }
  }

  function fmtDate(d) {
    try { return new Date(d).toLocaleString('pt-BR'); } catch { return ''; }
  }

  async function renderList() {
    const { items, selectedId } = await loadItems();
    if (!savedList) return;
    savedList.innerHTML = '';
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'sub';
      empty.textContent = 'Nenhum arquivo salvo.';
      savedList.appendChild(empty);
      return;
    }
    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'list-item';
      row.dataset.id = String(it.id);
      row.innerHTML = `
        <div class="list-main">
          <input type="radio" name="csvSel" ${String(it.id) === selectedId ? 'checked' : ''} />
          <div>
            <div class="list-name">${it.name || 'arquivo.csv'}</div>
            <div class="list-meta">${fmtSize(it.size)} • ${fmtDate(it.createdAt)}</div>
          </div>
        </div>
        <div class="list-actions">
          <button class="icon-btn" title="Excluir" data-action="del">🗑️</button>
        </div>
      `;
      savedList.appendChild(row);
    }
  }

  async function renderJobHistory() {
    if (!jobHistory) return;
    try {
      const resp = await new Promise((resolve)=>{ try { chrome.runtime.sendMessage({ type: 'INV10_GET_HISTORY' }, (r)=> resolve(r)); } catch { resolve(null); } });
      const hist = (resp && resp.ok && Array.isArray(resp.history)) ? resp.history : [];
      jobHistory.innerHTML = '';
      if (!hist.length) { const empty = document.createElement('div'); empty.className = 'sub'; empty.textContent = 'Sem histórico ainda.'; jobHistory.appendChild(empty); return; }
      hist.forEach((h)=>{
        const total = Number(h.total || 0);
        const ok = Number(h.ok || 0);
        const fail = Number(h.fail || 0);
        const done = ok + fail;
        const pct = total > 0 ? Math.round((done/total)*100) : 0;
        const st = (h.stage || (h.canceled ? 'canceled' : 'done'));
        const li = document.createElement('div');
        li.className = 'list-item';
        li.innerHTML = `<div class="list-main">
            <div>
              <div class="list-name">${st === 'done' ? 'Concluído' : (st === 'canceled' ? 'Cancelado' : st)}</div>
              <div class="list-meta">${ok} OK • ${fail} Erros • ${total} Total • ${pct}%</div>
            </div>
          </div>
          <div class="list-actions"></div>`;
        jobHistory.appendChild(li);
      });
    } catch {}
  }

  if (savedList) {
    savedList.addEventListener('click', async (ev) => {
      const target = ev.target;
      const row = target && target.closest ? target.closest('.list-item') : null;
      if (!row) return;
      const id = row.dataset.id;
      if ((target.tagName === 'INPUT' && target.type === 'radio') || (target.closest && target.closest('input[type="radio"]'))) {
        await setSelected(id);
        setStatus(`Selecionado: ${id}`);
        return;
      }
      const btn = target.closest && target.closest('[data-action]');
      if (btn && btn.dataset.action === 'del') {
        const { items } = await loadItems();
        const next = items.filter((x) => String(x.id) !== String(id));
        await saveItems(next);
        const cur = await stGet([SELECTED_KEY]);
        if (String(cur[SELECTED_KEY]) === String(id)) await setSelected(null);
        setStatus('Item excluído');
        await renderList();
      }
    });
  }

  // Integração do Upload com a lista (salva metadados no storage)
  if (btnUploadFile) {
    btnUploadFile.addEventListener('click', async () => {
      const file = fileInput && fileInput.files && fileInput.files[0];
      if (!file) { setStatus('Nenhum arquivo selecionado'); return; }
      setStatus('Lendo arquivo...');
      try {
        const text = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result || ''));
          fr.onerror = () => reject(fr.error || new Error('read error'));
          fr.readAsText(file);
        });
        const { items } = await loadItems();
        const item = { id: Date.now(), name: file.name, size: file.size, type: file.type, createdAt: new Date().toISOString(), content: text };
        items.unshift(item);
        await saveItems(items);
        await setSelected(item.id);
        setStatus(`Arquivo salvo: ${file.name}`);
        if (fileInput) fileInput.value = '';
        setUploadEnabled(false);
        setFileName('');
        await renderList();
      } catch (e) {
        console.error('[popup] erro lendo CSV:', e);
        setStatus('Falha ao ler o arquivo');
      }
    });
  }

  // Executar usa item selecionado (no-op)
  function norm(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');}
  function pickDelimiter(first){const c=(first||'').split(',').length; const s=(first||'').split(';').length; return s>c?';':',';}
  function splitCSVLine(line, d){const out=[];let cur='';let q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(q&&line[i+1]==='"'){cur+='"';i++;} else q=!q;} else if(ch===d && !q){out.push(cur);cur='';} else{cur+=ch;}} out.push(cur);return out;}
  function extractTickersFromCsv(text){
    try{
      const lines=(text||'').split(/\r?\n/).filter(l=>l.trim().length); if(!lines.length) return [];
      const d=pickDelimiter(lines[0]);
      const headers=splitCSVLine(lines[0],d).map(h=>h.trim());
      const map=new Map(headers.map(h=>[norm(h),h]));
      const pick=(...c)=>{for(const cand of c){const k=norm(cand); if(map.has(k)) return map.get(k);} for(const cand of c){const k=norm(cand); const f=headers.find(h=>norm(h).includes(k)); if(f) return f;} return null;};
      const col=pick('ticker','code','papel','symbol','ativo','tkr'); if(!col) return [];
      const idx=headers.indexOf(col); if(idx<0) return [];
      const out=new Set();
      for(let i=1;i<lines.length;i++){const vals=splitCSVLine(lines[i],d); const v=(vals[idx]||'').trim(); if(v) out.add(v.toUpperCase());}
      return Array.from(out);
    }catch{return []}
  }

  if (btnExecutar) {
    btnExecutar.addEventListener('click', async () => {
      const { items, selectedId } = await loadItems();
      const sel = items.find((x) => String(x.id) === String(selectedId));
      if (!sel) { setStatus('Selecione um item salvo para executar.'); return; }

      const tipo = execTipo ? execTipo.value : 'formulamagica';
      if (tipo === 'inv10') {
        if (!sel.content) { setStatus('Item sem conteúdo. Faça o upload novamente.'); return; }
        const tickers = extractTickersFromCsv(sel.content);
        if (!tickers.length) { setStatus('Não foi possível extrair tickers do CSV.'); return; }
        setStatus(`Iniciando raspagem de ${tickers.length} tickers...`);
        setProgress(tickers.length, 0);
        setProgressInfo({ running: true, stage: 'init', total: tickers.length, ok: 0, fail: 0, startedAt: new Date().toISOString() });
        try {
          chrome.runtime.sendMessage({ type: 'INV10_START', tickers }, (resp) => {
            if (resp && resp.ok) { setStatus('Raspagem iniciada...'); startJobPolling(); }
            else { setStatus(`Erro ao iniciar: ${resp && resp.error ? resp.error : 'falha desconhecida'}`); }
          });
        } catch (e) { setStatus(String(e)); }
        return;
      }

      if (tipo === 'inv10fm') {
        setStatus('Gerando ranking com base no Investidor10 (≥6)...');
        try {
          chrome.runtime.sendMessage({ type: 'FM_FROM_INV10', min_true: 6 }, (resp) => {
            if (resp && resp.ok) {
              const p = resp.json && (resp.json.processed || 0);
              setStatus('Ranking Inv10+FM concluído. Registros: ' + p);
            } else {
              setStatus('Erro Inv10+FM');
            }
          });
        } catch (e) { setStatus(String(e)); }
        return;
      }

      if (tipo === 'todos') {
        if (!sel.content) { setStatus('Item sem conteúdo. Faça o upload novamente.'); return; }
        setStatus('Executando Fórmula Mágica...');
        try {
          chrome.runtime.sendMessage({ type: 'FM_CALCULAR', csv: sel.content }, (resp) => {
            if (resp && resp.ok) {
              const p = resp.json && (resp.json.processed || 0);
              const diag = resp.json && resp.json.diag;
              const extra = diag ? ` | lidas: ${diag.parsed_rows}, após filtros: ${diag.after_compute}` : '';
              setStatus(`FM ok. Inseridos: ${p}${extra}. Iniciando Investidor10...`);
              const tickers = extractTickersFromCsv(sel.content);
              if (!tickers.length) { setStatus('FM ok. Não foi possível extrair tickers para o Investidor10.'); return; }
              try {
                chrome.runtime.sendMessage({ type: 'INV10_START', tickers }, (r2) => {
                  if (r2 && r2.ok) setStatus('INV10 iniciado...');
                  else setStatus(`INV10 erro ao iniciar: ${r2 && r2.error ? r2.error : 'falha desconhecida'}`);
                });
              } catch (e2) { setStatus(String(e2)); }
            } else {
              setStatus(`Erro na Fórmula Mágica: ${resp && resp.error ? resp.error : 'falha desconhecida'}`);
            }
          });
        } catch (e) { setStatus(String(e)); }
        return;
      }

      // Default: Fórmula Mágica
      if (!sel.content) { setStatus('Item sem conteúdo. Faça o upload novamente.'); return; }
      setStatus('Enviando para cálculo...');
      try {
        chrome.runtime.sendMessage({ type: 'FM_CALCULAR', csv: sel.content }, (resp) => {
          if (resp && resp.ok) {
            const p = resp.json && (resp.json.processed || 0);
            const diag = resp.json && resp.json.diag;
            const extra = diag ? ` | lidas: ${diag.parsed_rows}, após filtros: ${diag.after_compute}` : '';
            setStatus(`Cálculo concluído. Registros inseridos: ${p}${extra}`);
          } else {
            setStatus(`Erro: ${resp && resp.error ? resp.error : 'falha desconhecida'}`);
          }
        });
      } catch (e) {
        setStatus(String(e));
      }
    });
  }

  if (btnCancelar) {
    btnCancelar.addEventListener('click', () => {
      try { chrome.runtime.sendMessage({ type: 'INV10_CANCEL' }, () => {}); } catch {}
      try { chrome.runtime.sendMessage({ type: 'FM_CANCEL' }, () => {}); } catch {}
      setStatus('Cancelando...');
    });
  }

  if (btnDownloadCsv) {
    btnDownloadCsv.addEventListener('click', async () => {
      setStatus('Baixando CSV do StatusInvest...');
      try {
        chrome.runtime.sendMessage({ type: 'DOWNLOAD_STATUSINVEST_CSV' }, async (resp) => {
          if (resp && resp.ok && resp.json && resp.json.ok) {
            const name = resp.json.file || 'statusinvest.csv';
            const csvText = resp.json.csv || '';
            const item = { id: Date.now(), name, size: (csvText || '').length, type: 'text/csv', createdAt: new Date().toISOString(), content: csvText };
            const { items } = await loadItems();
            items.unshift(item);
            await saveItems(items);
            await setSelected(item.id);
            await renderList();
            setStatus(`Baixado e salvo: ${name}`);
          } else {
            setStatus(`Erro download: ${resp && resp.error ? resp.error : 'falha desconhecida'}`);
          }
        });
      } catch (e) { setStatus(String(e)); }
    });
  }

  // Primeira renderização
  renderList();
  renderJobHistory();

  // Escuta progressos do background e restaura estado ao abrir
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || !msg.type) return;
      if (msg.type === 'INV10_PROGRESS') {
        const j = msg.job || {};
        const total = (j.tickers || []).length;
        const done = (j.ok || 0) + (j.fail || 0);
        setStatus(`Processados: ${done}/${total} • OK: ${j.ok || 0} • Erros: ${j.fail || 0}${j.error ? ' • Erro: ' + j.error : ''}`);
        setProgress(total, done);
        setProgressInfo(j);
      }
      if (msg.type === 'INV10_DONE') {
        const j = msg.job || {};
        setStatus(`INV10 concluído. Inseridos: ${j.inserted || 0} • OK: ${j.ok || 0} • Erros: ${j.fail || 0}`);
        const total = (j.tickers || []).length;
        setProgress(total, total);
        setProgressInfo(null);
        stopJobPolling();
        // Atualiza histórico
        renderJobHistory();
      }
    });
  } catch {}

  (async () => {
    try {
      chrome.runtime.sendMessage({ type: 'INV10_GET_JOB' }, (resp) => {
        const j = resp && resp.ok ? (resp.job || null) : null;
        if (j && j.running) {
          const total = (j.tickers || []).length;
          const done = (j.ok || 0) + (j.fail || 0);
          setStatus(`(Em andamento) Processados: ${done}/${total} • OK: ${j.ok || 0} • Erros: ${j.fail || 0}`);
          setProgress(total, done);
          setProgressInfo(j);
        }
      });
    } catch {}
  })();
})();
