/* Popup logic: small demo actions and background messaging */
(function () {
  const $ = (sel) => document.querySelector(sel);
  const log = (msg) => { const el = $('#log'); if (el) el.textContent = String(msg || ''); };

  const FINANCIAL_EXCLUSION_LIST = new Set([
    'ITUB4', 'BPAC11', 'BBDC3', 'BBAS3', 'ITSA4', 'SANB11', 'B3SA3', 'BBSE3',
    'CXSE3', 'PSSA3', 'MULT3', 'ALOS3', 'BPAN4', 'BNBR3', 'BRAP4', 'ABCB4',
    'IGTA3', 'BRSR6', 'BMEB4', 'BAZA3', 'BSLI3', 'PLPL3', 'BEES3', 'BMGB4',
    'LOGG3', 'PINE4', 'WIZC3', 'BPAR3', 'SYNE3'
  ]);

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
  const btnClearHistory = $('#btnClearHistory');

  function stGet(keys) { return new Promise((resolve) => chrome.storage.local.get(keys, resolve)); }
  function stGetSync(keys) { return new Promise((resolve) => { try { chrome.storage.sync.get(keys, resolve); } catch { resolve({}); } }); }
  function stSet(obj) { return new Promise((resolve) => chrome.storage.local.set(obj, resolve)); }

  async function loadItems() {
    const res = await stGet([STORAGE_KEY, SELECTED_KEY]);
    let items = Array.isArray(res[STORAGE_KEY]) ? res[STORAGE_KEY] : [];
    // Fallback/migração: se local estiver vazio, tenta sync e migra
    if (!items.length) {
      try {
        const syncRes = await stGetSync([STORAGE_KEY]);
        const syncItems = Array.isArray(syncRes[STORAGE_KEY]) ? syncRes[STORAGE_KEY] : [];
        if (syncItems.length) {
          items = syncItems;
          // migra para local para futuras aberturas
          await stSet({ [STORAGE_KEY]: items });
        }
      } catch {}
    }
    // ordena por data (mais recente primeiro), se existir
    try { items = items.slice().sort((a,b)=> new Date(b.createdAt||0) - new Date(a.createdAt||0)); } catch {}
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

  if (btnClearHistory) {
    btnClearHistory.addEventListener('click', async () => {
      try {
        chrome.runtime.sendMessage({ type: 'INV10_CLEAR_HISTORY' }, async (resp) => {
          if (resp && resp.ok) {
            setStatus('Histórico limpo');
            await renderJobHistory();
          } else {
            setStatus('Falha ao limpar histórico');
          }
        });
      } catch { setStatus('Falha ao limpar histórico'); }
    });
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

  function parseNumberBR(val) {
    if (val == null) return null;
    let s = String(val).trim();
    if (!s) return null;
    s = s.replace(/\s|R\$|\u00A0/g, '');
    if (/\d,\d{1,3}$/.test(s) || (s.includes('.') && s.includes(','))) {
      s = s.replace(/\./g, '').replace(/,/g, '.');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  // Executar usa item selecionado (no-op)
  function norm(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');}
  function pickDelimiter(first){const c=(first||'').split(',').length; const s=(first||'').split(';').length; return s>c?';':',';}
  function splitCSVLine(line, d){const out=[];let cur='';let q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(q&&line[i+1]==='"'){cur+='"';i++;} else q=!q;} else if(ch===d && !q){out.push(cur);cur='';} else{cur+=ch;}} out.push(cur);return out;}
  function extractStocksFromCsv(text) {
    try {
      const lines = (text || '').split(/\r?\n/).filter(l => l.trim().length);
      if (!lines.length) return [];
      const d = pickDelimiter(lines[0]);
      const headers = splitCSVLine(lines[0], d).map(h => h.trim());
      const map = new Map(headers.map(h => [norm(h), h]));
      const pick = (...c) => { for (const cand of c) { const k = norm(cand); if (map.has(k)) return map.get(k); } for (const cand of c) { const k = norm(cand); const f = headers.find(h => norm(h).includes(k)); if (f) return f; } return null; };
      
      const tickerCol = pick('ticker', 'code', 'papel', 'symbol', 'ativo', 'tkr');
      const liqCol = pick('liquidez', 'liquidity', 'avg_liquidity', 'liquid', 'volmedio', 'volume medio');
      const mcCol = pick('market_cap', 'marketcap', 'valor_mercado', 'valor de mercado', 'market cap', 'vlmercado', 'valormercado');

      if (!tickerCol || !liqCol || !mcCol) {
        console.warn('CSV missing required columns for filtering: ticker, liquidez, or market_cap. Scraping will be skipped.');
        return [];
      }

      const tickerIdx = headers.indexOf(tickerCol);
      const liqIdx = headers.indexOf(liqCol);
      const mcIdx = headers.indexOf(mcCol);

      if (tickerIdx < 0 || liqIdx < 0 || mcIdx < 0) return [];

      const out = [];
      for (let i = 1; i < lines.length; i++) {
        const vals = splitCSVLine(lines[i], d);
        const ticker = (vals[tickerIdx] || '').trim().toUpperCase();
        if (ticker) {
          out.push({
            ticker: ticker,
            liquidez: parseNumberBR(vals[liqIdx]),
            market_cap: parseNumberBR(vals[mcIdx]),
          });
        }
      }
      return out;
    } catch (e) {
      console.error('Error parsing CSV for stocks:', e);
      return [];
    }
  }

  if (btnExecutar) {
    btnExecutar.addEventListener('click', async () => {
      const { items, selectedId } = await loadItems();
      const sel = items.find((x) => String(x.id) === String(selectedId));
      if (!sel) { setStatus('Selecione um item salvo para executar.'); return; }

      const tipo = execTipo ? execTipo.value : 'formulamagica';
      if (tipo === 'inv10') {
        if (!sel.content) { setStatus('Item sem conteúdo. Faça o upload novamente.'); return; }
        
        const allStocks = extractStocksFromCsv(sel.content);
        if (!allStocks.length) { setStatus('Não foi possível extrair ações do CSV ou colunas (liquidez, market_cap) estão ausentes.'); return; }

        const stocksToScrape = allStocks.filter(stock => 
            !FINANCIAL_EXCLUSION_LIST.has(stock.ticker) &&
            stock.liquidez != null && stock.market_cap != null &&
            stock.liquidez >= 1000000 && stock.market_cap >= 90000000
        );
        const tickers = stocksToScrape.map(s => s.ticker);

        if (!tickers.length) { setStatus('Nenhuma ação no CSV atende aos critérios de liquidez/capitalização.'); return; }
        
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
            setStatus(`FM ok. Inseridos: ${p}${extra}. Filtrando para Investidor10...`);
            
            const allStocks = extractStocksFromCsv(sel.content);
            if (!allStocks.length) { setStatus('FM ok. Não foi possível extrair tickers para o Investidor10 (verificar colunas).'); return; }

            const stocksToScrape = allStocks.filter(stock => 
                !FINANCIAL_EXCLUSION_LIST.has(stock.ticker) &&
                stock.liquidez != null && stock.market_cap != null &&
                stock.liquidez >= 1000000 && stock.market_cap >= 90000000
            );
            const tickers = stocksToScrape.map(s => s.ticker);

            if (!tickers.length) { setStatus('FM ok. Nenhuma ação no CSV atende aos critérios para o Investidor10.'); return; }
            
              try {
                chrome.runtime.sendMessage({ type: 'INV10_START', tickers }, (r2) => {
                if (r2 && r2.ok) { setStatus(`INV10 iniciado para ${tickers.length} tickers...`); startJobPolling(); }
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

  // Nota: btnDownloadCsv foi substituído por btnDownloadAuto.

  // Primeira renderização
  renderList();
  renderJobHistory();

  // Reage a mudanças no storage (ex.: outro popup salvou/limpou CSVs)
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if ((area === 'local' || area === 'sync') && changes && Object.prototype.hasOwnProperty.call(changes, STORAGE_KEY)) {
        renderList();
      }
    });
  } catch {}

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
          startJobPolling();
        }
      });
    } catch {}
  })();
})();
