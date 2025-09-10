// Content script
// - Injeta painel na página de patrimônio
// - Pede ao bg.js os dados da API e renderiza uma tabela

// Enhance StatusInvest table by adding column "fm" (final_rank from API)
(function () {
  const FM_TH_KEY = 'fm';
  const I10_TH_KEY = 'i10';
  let ranksMap = null; // { TICKER: final_rank }
  let i10Map = null;   // { TICKER: i10_score }

  function text(el) {
    return (el?.textContent || '').trim();
  }

  function toCode(s) {
    return (s || '').trim().toUpperCase();
  }

  function buildRanksMap(rows) {
    const map = Object.create(null);
    (rows || []).forEach((r) => {
      const code = toCode(r.code || r.ticker || r.symbol || r.papel || r.asset || r.tkr);
      const rank = typeof r.final_rank === 'number' ? r.final_rank : parseInt(r.final_rank, 10);
      if (code && Number.isFinite(rank)) map[code] = rank;
    });
    return map;
  }

  function buildI10Map(rows) {
    const map = Object.create(null);
    (rows || []).forEach((r) => {
      const code = toCode(r.code || r.ticker || r.symbol || r.papel || r.asset || r.tkr);
      const score = r.i10_score != null ? Number(r.i10_score) : null;
      if (code && score != null && Number.isFinite(score)) map[code] = score;
    });
    return map;
  }

  function getNormalTable() {
    // StatusInvest usa duas tabelas: uma fixa à esquerda ("fixed") e outra normal à direita ("normal").
    // Queremos injetar nas colunas da tabela NORMAL.
    const normalContainer = document.querySelector('.overflow-hidden.normal');
    return normalContainer ? normalContainer.querySelector('table') : null;
  }

  function findHeaderRow() {
    const table = getNormalTable();
    if (!table) return null;
    return table.querySelector('thead tr.header') || table.querySelector('thead tr');
  }

  function findBodyRows() {
    const table = getNormalTable();
    if (!table) return [];
    return Array.from(table.querySelectorAll('tbody.list tr.item'));
  }

  function ensureHeaderColumns() {
    const tr = findHeaderRow();
    if (!tr) return false;
    // Remove any legacy tiket_m header cells if present
    try { tr.querySelectorAll('th[data-key="tiket_m"]').forEach((n) => n.remove()); } catch {}
    const hasFm = !!tr.querySelector(`th[data-key="${FM_TH_KEY}"]`);
    const hasI10 = !!tr.querySelector(`th[data-key="${I10_TH_KEY}"]`);
    // Remove previously injected Qty 10% header if present
    try { tr.querySelectorAll('th[data-key="qty10"]').forEach((n) => n.remove()); } catch {}
    if (hasFm && hasI10) return true;

    const actionsTh = tr.querySelector('th[data-key="assetId"]');
    const thFm = document.createElement('th');
    thFm.className = 'item text-right';
    thFm.dataset.key = FM_TH_KEY;
    thFm.title = 'Posição na Fórmula Mágica';
    thFm.innerHTML = '<div><div>FM</div></div>';

    const thI10 = document.createElement('th');
    thI10.className = 'item text-right';
    thI10.dataset.key = I10_TH_KEY;
    thI10.title = 'I10 Score';
    thI10.innerHTML = '<div><div>I10</div></div>';

    if (actionsTh && actionsTh.parentElement === tr) {
      // Insert FM first, then I10, so headers align with row cells order
      tr.insertBefore(thFm, actionsTh);
      tr.insertBefore(thI10, actionsTh);
    } else {
      tr.appendChild(thFm);
      tr.appendChild(thI10);
    }
    return true;
  }

  function ensureRowCells(row) {
    // Remove any legacy tiket_m cells in this row
    try { row.querySelectorAll('td[data-key="tiket_m"]').forEach((n) => n.remove()); } catch {}
    const hasFm = !!row.querySelector(`td[data-key="${FM_TH_KEY}"]`);
    const hasI10 = !!row.querySelector(`td[data-key="${I10_TH_KEY}"]`);
    // Ensure any previously injected Qty 10% cell is removed
    try { row.querySelectorAll('td[data-key="qty10"]').forEach((n) => n.remove()); } catch {}
    if (hasFm && hasI10) return;
    const actionsTd = row.querySelector('td[data-key="assetId"]');

    if (!hasFm) {
      const tdFm = document.createElement('td');
      tdFm.className = 'text-right';
      tdFm.dataset.key = FM_TH_KEY;
      tdFm.style.padding = '6px 8px';
      if (actionsTd && actionsTd.parentElement === row) row.insertBefore(tdFm, actionsTd);
      else row.appendChild(tdFm);
    }

    if (!hasI10) {
      const tdI10 = document.createElement('td');
      tdI10.className = 'text-right';
      tdI10.dataset.key = I10_TH_KEY;
      tdI10.style.padding = '6px 8px';
      if (actionsTd && actionsTd.parentElement === row) row.insertBefore(tdI10, actionsTd);
      else row.appendChild(tdI10);
    }
  }

  function extractCodeFromRow(row) {
    // Typical structure: td[data-key="code"] span.ticker
    const codeCell = row.querySelector('td[data-key="code"]');
    if (!codeCell) return null;
    const ticker = codeCell.querySelector('.ticker');
    const value = ticker ? text(ticker) : text(codeCell);
    return toCode(value);
  }

  // Parse helpers for pt-BR formatting
  function parseMoneyBR(text) {
    if (text == null) return NaN;
    let s = String(text).replace(/R\$|\s/g, '');
    s = s.replace(/\./g, '').replace(/,/g, '.');
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }
  function parseIntBR(text) {
    if (text == null) return NaN;
    const s = String(text).replace(/\./g, '').replace(/\s/g, '');
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : NaN;
  }

  function getPortfolioTotal() {
    // Try header total first
    const spans = Array.from(document.querySelectorAll('span.sensitive-field.fw-600'));
    let maxVal = 0;
    for (const sp of spans) {
      const val = parseMoneyBR(sp.textContent);
      if (Number.isFinite(val)) maxVal = Math.max(maxVal, val);
    }
    if (maxVal > 0) return maxVal;
    // Fallback: sum of price * quantity over rows
    let sum = 0;
    for (const r of findBodyRows()) {
      const priceTd = r.querySelector('td[data-key="price"]');
      const qtyTd = r.querySelector('td[data-key="quantity"]');
      let price = NaN;
      if (priceTd) {
        const t = priceTd.getAttribute('title');
        price = Number(t);
        if (!Number.isFinite(price)) price = parseMoneyBR(priceTd.textContent);
      }
      const qty = qtyTd ? (Number(qtyTd.getAttribute('title')) || parseIntBR(qtyTd.textContent)) : NaN;
      if (Number.isFinite(price) && Number.isFinite(qty)) sum += price * qty;
    }
    return sum;
  }

  function paintRow(row, portfolioTotal) {
    const code = extractCodeFromRow(row);
    const fmCell = row.querySelector(`td[data-key="${FM_TH_KEY}"]`);
    const i10Cell = row.querySelector(`td[data-key="${I10_TH_KEY}"]`);
    if (fmCell) {
      const rank = code && ranksMap ? ranksMap[code] : undefined;
      // reset styles first
      fmCell.style.backgroundColor = '';
      fmCell.style.color = '';
      fmCell.style.fontWeight = '';

      if (rank == null || Number.isNaN(rank)) {
        fmCell.textContent = '-';
        // whole square red when no data
        fmCell.style.backgroundColor = '#ffebee';
        fmCell.style.color = '#c62828';
        fmCell.style.fontWeight = '700';
      } else if (Number(rank) <= 20) {
        fmCell.textContent = String(rank);
        fmCell.style.color = '#2e7d32'; // green text
        fmCell.style.backgroundColor = '#e8f5e9'; // subtle green background
        fmCell.style.fontWeight = '700';
      } else {
        fmCell.textContent = String(rank);
        fmCell.style.color = '#c62828'; // red text
        fmCell.style.backgroundColor = '#ffebee'; // red background
        fmCell.style.fontWeight = '700';
      }
    }
    if (i10Cell) {
      const score = code && i10Map ? i10Map[code] : undefined;
      i10Cell.textContent = score != null ? String(score) : '-';
      i10Cell.style.color = score != null ? '#1565c0' : '#9e9e9e';
    }
  }

  function paintAllRows() {
    const rows = findBodyRows();
    const total = getPortfolioTotal();
    rows.forEach((row) => {
      ensureRowCells(row);
      paintRow(row, total);
    });
  }

  function enhanceOnce() {
    if (!ensureHeaderColumns()) return false;
    paintAllRows();
    return true;
  }

  function setupObserver() {
    const table = getNormalTable();
    const tbody = table ? table.querySelector('tbody.list') : null;
    if (!tbody) return;
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList' && (m.addedNodes?.length || m.removedNodes?.length)) {
          paintAllRows();
        }
      }
    });
    obs.observe(tbody, { childList: true, subtree: false });
  }

  function fetchRanksAndThen(enhanceCb) {
    chrome.runtime.sendMessage({ type: 'FETCH_FM_RANKS' }, (resp) => {
      if (resp && resp.ok && resp.json && Array.isArray(resp.json.data)) {
        ranksMap = buildRanksMap(resp.json.data);
        try {
          const keys = Object.keys(ranksMap || {});
          console.log('[content] fm-ranks loaded:', keys.length, 'sample:', keys.slice(0, 5));
        } catch {}
      } else {
        console.warn('[content] fm-ranks request failed:', resp?.error || 'unknown');
        ranksMap = {};
      }
      enhanceCb();
      // Fetch last-updated in a dedicated call
      chrome.runtime.sendMessage({ type: 'FETCH_FM_LAST_UPDATED' }, (lu) => {
        if (lu && lu.ok && lu.json) {
          const ts = lu.json.last_updated || lu.json.generated_at;
          if (ts) placeLastUpdatedIndicator(ts);
        } else {
          console.warn('[content] fm-last-updated request failed:', lu?.error || 'unknown');
        }
      });

      // Fetch I10 scores and repaint
      chrome.runtime.sendMessage({ type: 'FETCH_I10_SCORES' }, (i10) => {
        if (i10 && i10.ok && i10.json && Array.isArray(i10.json.data)) {
          i10Map = buildI10Map(i10.json.data);
          try { console.log('[content] i10-scores loaded:', Object.keys(i10Map).length); } catch {}
          paintAllRows();
        } else {
          console.warn('[content] i10-scores request failed:', i10?.error || 'unknown');
          i10Map = {};
        }
      });
    });
  }

  let headerIndicatorTries = 0;
  function placeLastUpdatedIndicator(isoTs) {
    try {
      const id = 'fm-last-updated-indicator';
      const text = `Atualizado: ${formatBrazil(isoTs)}`;
      let placed = false;

      // 1) Preferir adicionar como uma "coluna" dentro do container do título AÇÕES
      const acoesContainer = findAcoesHeaderContainer();
      if (acoesContainer) {
        let wrapper = document.getElementById(id);
        if (!wrapper) {
          wrapper = document.createElement('div');
          wrapper.id = id;
          // Mantém alinhamento como uma coluna do flex container
          wrapper.style.display = 'flex';
          wrapper.style.alignItems = 'center';
          wrapper.style.marginLeft = '12px';

          const label = document.createElement('small');
          label.style.fontWeight = '400';
          label.style.color = '#777';
          label.textContent = `• ${text}`;
          wrapper.appendChild(label);

          acoesContainer.appendChild(wrapper);
        } else {
          // atualiza o texto do primeiro child
          const lbl = wrapper.firstChild || document.createElement('small');
          lbl.textContent = `• ${text}`;
          if (!wrapper.firstChild) wrapper.appendChild(lbl);
        }
        placed = true;
      } else {
        // 1b) Alternativa: no header raiz que contém "AÇÕES"
        const headerRoot = findAcoesHeaderRoot();
        if (headerRoot) {
          let wrapper = document.getElementById(id);
          if (!wrapper) {
            wrapper = document.createElement('div');
            wrapper.id = id;
            wrapper.style.display = 'flex';
            wrapper.style.alignItems = 'center';
            wrapper.style.marginLeft = '12px';
            const label = document.createElement('small');
            label.style.fontWeight = '400';
            label.style.color = '#777';
            label.textContent = `• ${text}`;
            wrapper.appendChild(label);
            headerRoot.appendChild(wrapper);
          } else {
            const lbl = wrapper.firstChild || document.createElement('small');
            lbl.textContent = `• ${text}`;
            if (!wrapper.firstChild) wrapper.appendChild(lbl);
          }
          placed = true;
        } else {
          // 1c) Dentro do DIV específico que contém h3 "AÇÕES"
          const acoesDiv = findActionsHeaderDiv();
          if (acoesDiv) {
            let node = document.getElementById(id);
            if (!node) {
              node = document.createElement('small');
              node.id = id;
              node.style.marginLeft = '8px';
              node.style.fontWeight = '400';
              node.style.color = '#777';
              node.style.display = 'block';
              node.style.marginTop = '2px';
              node.textContent = `• ${text}`;
              acoesDiv.appendChild(node);
            } else {
              node.textContent = `• ${text}`;
            }
            placed = true;
          }
        }
      }

      // 2) Fallback: próximo a "POSIÇÃO NA CARTEIRA"
      if (!placed) {
        const anchor = findCarteiraHeaderElement();
        if (anchor) {
          let node = document.getElementById(id);
          if (!node) {
            node = document.createElement('small');
            node.id = id;
            node.style.marginLeft = '8px';
            node.style.fontWeight = '400';
            node.style.color = '#777';
            node.style.display = 'inline-block';
            node.textContent = `• ${text}`;
            anchor.insertAdjacentElement('afterend', node);
          } else {
            node.textContent = `• ${text}`;
          }
          placed = true;
        }
      }

      if (!placed && headerIndicatorTries < 10) {
        headerIndicatorTries += 1;
        setTimeout(() => placeLastUpdatedIndicator(isoTs), 500);
      }
    } catch {}
  }

  function formatBrazil(iso) {
    try {
      const d = new Date(iso);
      // Se for inválida, cai no catch e retorna string original
      return d.toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
      });
    } catch { return iso; }
  }

  function findActionsHeaderDiv() {
    // Try to find the specific container shown by the user
    const candidates = Array.from(document.querySelectorAll('.w-sm-40.w-md-35.w-lg-30.d-flex.justify-start.align-items-center.mr-3 > div'));
    for (const el of candidates) {
      const h3 = el.querySelector('h3');
      if (h3 && (h3.textContent || '').trim().toUpperCase() === 'AÇÕES') return el;
    }
    // Fallback: find any h3 with text 'Ações' and return its parent div
    const h3Fallbacks = Array.from(document.querySelectorAll('h3'));
    for (const h3 of h3Fallbacks) {
      const txt = (h3.textContent || '').trim().toUpperCase();
      if (txt === 'AÇÕES') return h3.parentElement || null;
    }
    return null;
  }

  function findAcoesHeaderContainer() {
    // Procura o container flex mostrado no HTML enviado
    let el = document.querySelector('.collapsible-header .w-sm-40.w-md-35.w-lg-30.d-flex.justify-start.align-items-center.mr-3');
    if (el) return el;
    // Fallback: pega o container pai do DIV que contém h3 "AÇÕES"
    const inner = findActionsHeaderDiv();
    return inner ? inner.parentElement : null;
  }

  function findAcoesHeaderRoot() {
    const headers = Array.from(document.querySelectorAll('header.collapsible-header'));
    for (const h of headers) {
      const hasAcoes = !!Array.from(h.querySelectorAll('h3')).find((n) => (n.textContent || '').trim().toUpperCase() === 'AÇÕES');
      if (hasAcoes) return h;
    }
    return null;
  }

  function findCarteiraHeaderElement() {
    const tags = ['h1','h2','h3','h4','strong','span','div'];
    for (const tag of tags) {
      const els = Array.from(document.querySelectorAll(tag));
      const found = els.find((el) => (el.textContent || '').trim().toUpperCase() === 'POSIÇÃO NA CARTEIRA');
      if (found) return found;
    }
    return null;
  }

  // Boot: wait a bit for page scripts to render the table
  const MAX_TRIES = 20;
  let tries = 0;
  const iv = setInterval(() => {
    tries += 1;
    const header = findHeaderRow();
    const rows = findBodyRows();
    if (header && rows.length) {
      clearInterval(iv);
      fetchRanksAndThen(() => {
        enhanceOnce();
        setupObserver();
      });
      try { initRebalancePanel(); } catch {}
      try { initEqualWeightPlanPanel(); } catch {}
    } else if (tries >= MAX_TRIES) {
      clearInterval(iv);
      fetchRanksAndThen(() => {
        enhanceOnce();
        setupObserver();
      });
      try { initRebalancePanel(); } catch {}
      try { initEqualWeightPlanPanel(); } catch {}
    }
  }, 500);

  // Listen for toolbar icon clicks (via bg message) to show a quick menu
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'SHOW_WELCOME_OVERLAY') {
        showQuickMenuOverlay();
      }
    });
  } catch {}

  function showQuickMenuOverlay() {
    const HOST_ID = 'si-quick-menu';
    let host = document.getElementById(HOST_ID);
    if (host) {
      host.style.display = (host.style.display === 'none') ? 'block' : 'none';
      return;
    }

    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.position = 'fixed';
    host.style.top = '12px';
    host.style.right = '12px';
    host.style.zIndex = '2147483647';
    host.style.width = '360px';
    host.style.maxHeight = '80vh';
    host.style.borderRadius = '12px';
    host.style.boxShadow = '0 16px 40px rgba(0,0,0,0.35)';
    host.style.overflow = 'hidden';

    const root = host.attachShadow({ mode: 'open' });
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <style>
        :host { all: initial; }
        .panel { display:flex; flex-direction:column; background:#0f172a; color:#e5e7eb; border:1px solid #1f2937; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; }
        .header { display:flex; align-items:center; justify-content:space-between; padding:10px 12px; background:#111827; border-bottom:1px solid #1f2937; }
        .title { font-weight:700; font-size:14px; }
        .actions { display:flex; align-items:center; gap:8px; }
        .btn, .icon { border:1px solid #334155; background:#1f2937; color:#e5e7eb; border-radius:8px; padding:6px 10px; font-size:12px; cursor:pointer; }
        .icon { width:28px; height:28px; display:flex; align-items:center; justify-content:center; padding:0; }
        .body { padding:10px 12px; overflow:auto; max-height:60vh; }
        .search { position:relative; margin-bottom:10px; }
        .search input { width:100%; padding:10px 12px 10px 34px; border:1px solid #334155; background:#0b1220; color:#f3f4f6; border-radius:10px; font-size:13px; outline:none; }
        .search .lens { position:absolute; top:50%; left:10px; transform:translateY(-50%); color:#94a3b8; font-size:14px; }
        .filters { display:flex; gap:8px; margin-bottom:8px; }
        .chip { display:inline-flex; align-items:center; gap:6px; border:1px solid #334155; background:#111827; color:#e5e7eb; border-radius:10px; padding:6px 8px; font-size:12px; }
        .section-title { font-size:12px; color:#94a3b8; margin:10px 0 6px 2px; }
        .card { background:#111827; border:1px solid #1f2937; border-radius:10px; padding:10px; margin-bottom:8px; display:flex; align-items:center; justify-content:space-between; }
        .item { display:flex; align-items:center; gap:10px; }
        .avatar { width:26px; height:26px; border-radius:6px; background:#0b1220; border:1px solid #334155; display:flex; align-items:center; justify-content:center; font-size:12px; color:#94a3b8; }
        .name { font-weight:600; color:#f3f4f6; font-size:13px; }
        .sub { font-size:12px; color:#9ca3af; }
        .row-actions { display:flex; gap:6px; }
        .small { font-size:12px; }
        .footer { display:flex; align-items:center; justify-content:space-around; padding:8px; border-top:1px solid #1f2937; background:#0b1220; }
        .tab { background:transparent; border:1px solid transparent; color:#9ca3af; padding:6px 8px; border-radius:8px; cursor:pointer; font-size:12px; }
        .tab.active { color:#e5e7eb; background:#111827; border-color:#1f2937; }
        .caret { position:absolute; top:-8px; right:18px; width:0; height:0; border-left:8px solid transparent; border-right:8px solid transparent; border-bottom:8px solid #111827; }
      </style>
      <div class="panel" part="panel">
        <div class="caret"></div>
        <div class="header">
          <div class="title">Painel</div>
          <div class="actions">
            <button class="icon" id="closeBtn" title="Fechar">×</button>
          </div>
        </div>
        <div class="body">
          <div class="search">
            <span class="lens">🔎</span>
            <input id="searchInput" placeholder="Pesquisar" />
          </div>
          <div class="filters">
            <div class="chip">Pasta</div>
            <div class="chip">Tipo</div>
          </div>
          <div class="section">
            <div class="section-title">Ações rápidas</div>
            <div class="card">
              <div class="item">
                <div class="avatar">S</div>
                <div>
                  <div class="name">Mostrar oi</div>
                  <div class="sub">Exibe uma saudação simples</div>
                </div>
              </div>
              <div class="row-actions">
                <button class="btn small" id="btnOi">Executar</button>
              </div>
            </div>
            <div class="card">
              <div class="item">
                <div class="avatar">↻</div>
                <div>
                  <div class="name">Recarregar página</div>
                  <div class="sub">Atualiza o conteúdo atual</div>
                </div>
              </div>
              <div class="row-actions">
                <button class="btn small" id="btnReload">Recarregar</button>
              </div>
            </div>
          </div>
        </div>
        <div class="footer">
          <button class="tab active">Menu</button>
          <button class="tab">Gerador</button>
          <button class="tab">Enviar</button>
          <button class="tab">Config</button>
        </div>
      </div>
    `;

    root.appendChild(wrap);

    const $ = (sel) => root.querySelector(sel);
    const closeBtn = $('#closeBtn');
    const btnOi = $('#btnOi');
    const btnReload = $('#btnReload');

    if (closeBtn) closeBtn.addEventListener('click', () => { host.style.display = 'none'; });
    if (btnOi) btnOi.addEventListener('click', () => { try { alert('Oi'); } catch {} });
    if (btnReload) btnReload.addEventListener('click', () => { try { location.reload(); } catch {} });

    // Close on outside click
    const outside = (ev) => {
      const path = ev.composedPath ? ev.composedPath() : [];
      if (!path.includes(host)) host.style.display = 'none';
    };
    document.addEventListener('mousedown', outside);
    // Close on ESC
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') host.style.display = 'none'; });

    document.body.appendChild(host);
  }
})();

// Floating Shadow DOM panel: Rebalance dates manager
// Idempotent and robust to SPA rerenders
(function () {
  if (document.readyState !== 'loading') initRebalancePanel();
  else document.addEventListener('DOMContentLoaded', initRebalancePanel, { once: true });
})();

function initRebalancePanel() {
  const HOST_ID = 'rebalance-panel-host';
  if (document.getElementById(HOST_ID)) return; // prevent duplicates

  const host = document.createElement('div');
  host.id = HOST_ID;
  const anchor = document.getElementById('cashposition-result');
  if (anchor && anchor.parentElement) anchor.insertAdjacentElement('afterend', host);
  else document.body.appendChild(host);

  const root = host.attachShadow({ mode: 'open' });
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <style>
      :host { all: initial; display: block; width: 100%; }
      .card { width: 100%; background: #fff; color: #1f2937; border: 1px solid #e5e7eb; border-radius: 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; margin: 12px 0; }
      .header { display:flex; align-items:center; justify-content:space-between; padding: 10px 12px; border-bottom: 1px solid #f3f4f6; background:#f9fafb; border-top-left-radius:10px; border-top-right-radius:10px; }
      .title { font-weight: 700; font-size: 14px; margin: 0; }
      .body { padding: 10px 12px; }
      .row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:8px; }
      label { font-size: 12px; color:#374151; }
      input[type="date"] { padding:6px 8px; border:1px solid #e5e7eb; border-radius:6px; font-size:12px; }
      select { padding:6px 8px; border:1px solid #e5e7eb; border-radius:6px; font-size:12px; background:#fff; }
      button { padding:6px 10px; border:1px solid #d1d5db; background:#10b981; color:#fff; border-radius:6px; font-size:12px; cursor:pointer; }
      button.secondary { background:#eef2ff; color:#1f2937; border-color:#e5e7eb; }
      button.danger { background:#fee2e2; color:#991b1b; border-color:#fecaca; }
      .table-wrap { max-height: 260px; overflow:auto; border-top:1px solid #f3f4f6; margin-top:8px; }
      table { width:100%; border-collapse:collapse; font-size:12px; }
      thead th { position: sticky; top: 0; background:#f9fafb; z-index:1; text-align:left; padding:6px 8px; border-bottom:1px solid #e5e7eb; }
      tbody td { padding:6px 8px; border-bottom:1px solid #f3f4f6; vertical-align:middle; }
      .status-late { color:#c62828; font-weight:700; }
      .status-today { color:#1565c0; font-weight:700; }
      .status-soon { color:#92400e; }
      .banner { background:#fff7ed; color:#7c2d12; border:1px solid #fed7aa; border-radius:6px; padding:6px 8px; margin: 6px 0 8px 0; display:none; }
      .actions { display:flex; gap:6px; }
      .muted { color:#6b7280; }
      /* Late highlighting: whole row/cells in red background */
      .row-late td { background:#ffebee; }
      .row-late td.next, .row-late td.status { color:#c62828; font-weight:700; }
    </style>
    <div class="card" part="card">
      <div class="header"><h3 class="title">Quando foi o último rebalanceamento?</h3></div>
      <div class="body">
        <div class="row">
          <div style="display:flex; flex-direction:column">
            <label for="lastRebDate">Último rebalance</label>
            <input type="date" id="lastRebDate" />
          </div>
          <div style="display:flex; flex-direction:column">
            <label for="rebalanceInterval">Intervalo (meses)</label>
            <select id="rebalanceInterval">
              <option value="3">3</option>
              <option value="6">6</option>
              <option value="9">9</option>
              <option value="12">12</option>
            </select>
          </div>
          <div style="display:flex; align-items:flex-end">
            <button id="addBtn">Adicionar</button>
          </div>
        </div>
        <div id="banner" class="banner">⚠️ Está chegando a data do próximo rebalanceamento</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Próximo rebalance</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody id="listBody"></tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  root.appendChild(wrap);

  const $ = (sel) => root.querySelector(sel);
  const STORAGE_KEY = 'rebalance_dates';

  const inputLast = $('#lastRebDate');
  const intervalSel = $('#rebalanceInterval');
  const addBtn = $('#addBtn');
  const listBody = $('#listBody');
  const banner = $('#banner');

  function toLocalDateInputValue(d) {
    const dt = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return dt.toISOString().slice(0, 10);
  }
  function startOfDayLocal(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function fmtDateBR(d) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}:${mm}:${yyyy}`;
  }
  function diffDays(a, b) { const A = startOfDayLocal(a).getTime(); const B = startOfDayLocal(b).getTime(); return Math.round((B - A) / 86400000); }
  function addMonthsSafe(date, months) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const targetMonth = d.getMonth() + months;
    const lastDayTarget = new Date(d.getFullYear(), targetMonth + 1, 0).getDate();
    const day = Math.min(d.getDate(), lastDayTarget);
    return new Date(d.getFullYear(), targetMonth, day);
  }
  function loadDates() {
    return new Promise((resolve) => {
      try { chrome.storage.sync.get([STORAGE_KEY], (res) => resolve(Array.isArray(res?.[STORAGE_KEY]) ? res[STORAGE_KEY] : [])); }
      catch { resolve([]); }
    });
  }
  function saveDates(arr) {
    return new Promise((resolve) => {
      try { chrome.storage.sync.set({ [STORAGE_KEY]: arr }, () => resolve()); }
      catch { resolve(); }
    });
  }
  let intervalMonths = 3;
  function nextRebalance(dateISO) { return addMonthsSafe(new Date(dateISO), intervalMonths); }
  function computeStatus(next, current) {
    const dd = diffDays(startOfDayLocal(current), startOfDayLocal(next));
    if (dd === 0) return { text: 'Hoje!', cls: 'status-today', late: false, soon: true };
    if (dd < 0) return { text: `Atrasado ${Math.abs(dd)} dias`, cls: 'status-late', late: true, soon: false };
    return { text: `Faltam ${dd} dias`, cls: dd <= 10 ? 'status-soon' : '', late: false, soon: dd <= 10 };
  }
  function renderList(currentDate) {
    loadDates().then((arr) => {
      arr.sort((a, b) => new Date(b.dateISO) - new Date(a.dateISO));
      listBody.innerHTML = '';
      if (arr.length) {
        const next = nextRebalance(arr[0].dateISO);
        const dd = diffDays(startOfDayLocal(new Date()), next);
        banner.style.display = dd > 0 && dd <= 10 ? 'block' : (dd === 0 ? 'block' : 'none');
        banner.textContent = dd === 0 ? 'Hoje! Dia do próximo rebalanceamento' : '⚠️ Está chegando a data do próximo rebalanceamento';
      } else { banner.style.display = 'none'; }
      arr.forEach((item) => {
        const orig = new Date(item.dateISO);
        const next = nextRebalance(item.dateISO);
        const { text, cls, late } = computeStatus(next, currentDate);
        const tr = document.createElement('tr');
        tr.dataset.id = String(item.id);
        tr.innerHTML = `
          <td class="orig">${fmtDateBR(orig)}</td>
          <td class="next">${fmtDateBR(next)}</td>
          <td class="status ${cls}">${text}</td>
          <td class="actions">
            <button class="secondary btn-edit">Editar</button>
            <button class="danger btn-del">Excluir</button>
          </td>
        `;
        if (late) tr.classList.add('row-late');
        listBody.appendChild(tr);
      });
    });
  }
  function refresh() { const current = new Date(); renderList(current); }
  // Prefill Último rebalance com hoje por padrão
  inputLast.value = toLocalDateInputValue(new Date());

  // Interval persistence
  const INTERVAL_KEY = 'rebalance_interval_months';
  function loadInterval() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get([INTERVAL_KEY], (res) => {
          const v = Number(res?.[INTERVAL_KEY]);
          resolve([3,6,9,12].includes(v) ? v : 3);
        });
      } catch { resolve(3); }
    });
  }
  function saveInterval(v) {
    return new Promise((resolve) => {
      try { chrome.storage.sync.set({ [INTERVAL_KEY]: v }, () => resolve()); } catch { resolve(); }
    });
  }
  addBtn.addEventListener('click', async () => {
    const v = inputLast.value;
    if (!v) { alert('Selecione a data do último rebalanceamento.'); return; }
    const list = await loadDates();
    list.push({ id: Date.now(), dateISO: v, createdAtISO: new Date().toISOString() });
    await saveDates(list);
    inputLast.value = '';
    refresh();
  });

  // Load interval and wire select
  (async () => {
    const v = await loadInterval();
    intervalMonths = v;
    if (intervalSel) intervalSel.value = String(v);
    refresh();
  })();
  if (intervalSel) {
    intervalSel.addEventListener('change', async () => {
      const v = Number(intervalSel.value);
      intervalMonths = [3,6,9,12].includes(v) ? v : 3;
      await saveInterval(intervalMonths);
      refresh();
    });
  }
  // Sem campo de data atual; usa sempre hoje
  listBody.addEventListener('click', async (ev) => {
    const btn = ev.target;
    const tr = btn && btn.closest ? btn.closest('tr') : null;
    if (!tr) return;
    const id = Number(tr.dataset.id);
    if (btn.classList.contains('btn-del')) {
      if (!confirm('Excluir esta data?')) return;
      const list = await loadDates();
      await saveDates(list.filter((x) => Number(x.id) !== id));
      refresh();
    }
    if (btn.classList.contains('btn-edit')) {
      const list = await loadDates();
      const idx = list.findIndex((x) => Number(x.id) === id);
      if (idx === -1) return;
      const tdOrig = tr.querySelector('td.orig');
      const tdActions = tr.querySelector('td.actions');
      const prevActions = tdActions.innerHTML;
      const editInput = document.createElement('input');
      editInput.type = 'date';
      editInput.value = list[idx].dateISO;
      editInput.style.padding = '4px 6px';
      editInput.style.border = '1px solid #e5e7eb';
      editInput.style.borderRadius = '6px';
      tdOrig.innerHTML = '';
      tdOrig.appendChild(editInput);
      tdActions.innerHTML = '';
      const saveBtn = document.createElement('button'); saveBtn.textContent = 'Salvar'; saveBtn.className = 'secondary';
      const cancelBtn = document.createElement('button'); cancelBtn.textContent = 'Cancelar'; cancelBtn.className = 'danger';
      tdActions.appendChild(saveBtn); tdActions.appendChild(cancelBtn);
      saveBtn.addEventListener('click', async () => { const nv = editInput.value; if (!nv) { alert('Selecione uma data válida.'); return; } list[idx].dateISO = nv; await saveDates(list); refresh(); });
      cancelBtn.addEventListener('click', () => { tdActions.innerHTML = prevActions; refresh(); });
    }
  });

  refresh();
}

// Equal-Weight Rebalance Plan panel (Top N from checklist)
function initEqualWeightPlanPanel() {
  const HOST_ID = 'ew-plan-panel-host';
  if (document.getElementById(HOST_ID)) return;

  // Find anchor above the main table
  const tableBody = document.querySelector('.collapsible-body');
  const host = document.createElement('div');
  host.id = HOST_ID;
  if (tableBody && tableBody.parentElement) tableBody.parentElement.insertBefore(host, tableBody);
  else document.body.insertBefore(host, document.body.firstChild);

  const root = host.attachShadow({ mode: 'open' });
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <style>
      :host { all: initial; display:block; width:100%; }
      .card { width:100%; background:#fff; color:#1f2937; border:1px solid #e5e7eb; border-radius:10px; box-shadow:0 2px 8px rgba(0,0,0,.08); font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; margin: 12px 0; }
      .header { display:flex; align-items:center; justify-content:space-between; padding:10px 12px; border-bottom:1px solid #f3f4f6; background:#f9fafb; border-top-left-radius:10px; border-top-right-radius:10px; }
      .title { font-weight:700; font-size:14px; margin:0; }
      .controls { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
      .toggle-btn { padding:6px 10px; border:1px solid #e5e7eb; background:#eef2ff; color:#1f2937; border-radius:6px; font-size:12px; cursor:pointer; }
      select, input[type="text"] { padding:6px 8px; border:1px solid #e5e7eb; border-radius:6px; font-size:12px; background:#fff; }
      .body { padding:10px 12px; }
      .table-wrap { max-height:420px; overflow:auto; border-top:1px solid #f3f4f6; margin-top:8px; }
      table { width:100%; border-collapse:collapse; font-size:12px; }
      thead th { position:sticky; top:0; background:#f9fafb; z-index:1; text-align:left; padding:6px 8px; border-bottom:1px solid #e5e7eb; }
      tbody td { padding:6px 8px; border-bottom:1px solid #f3f4f6; vertical-align:middle; }
      .num { text-align:right; }
      .muted { color:#6b7280; }
      /* Highlight rows for tickers already in the portfolio */
      tr.row-holding td { background:#e8f5e9; }
      tr.row-holding td:nth-child(2) { color:#2e7d32; font-weight:700; }
      .mode { display:flex; align-items:center; gap:6px; }
      .mode label { display:flex; align-items:center; gap:4px; cursor:pointer; }
    </style>
    <div class="card">
      <div class="header">
        <h3 class="title">Plano de Rebalanceamento (Equal-Weight)</h3>
        <div class="controls">
          <label>Top
            <select id="ewN">
              <option value="10" selected>10</option>
              <option value="15">15</option>
              <option value="20">20</option>
            </select>
          </label>
          <label>Total (R$)
            <input type="text" id="ewTotal" size="12"/>
          </label>
          <span class="mode">
            <label title="Compra com base no orçamento, sem vender posições."><input type="radio" name="ewMode" value="investir" checked /> Investir</label>
            <label title="Ajusta quantidades para chegar ao alvo por ativo; só considera compras adicionais."><input type="radio" name="ewMode" value="rebalancear" /> Rebalancear</label>
          </span>
          
          <button id="ewToggle" class="toggle-btn" type="button">Ocultar</button>
        </div>
      </div>
      <div class="body" id="ewBodyWrap">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Ticker</th>
                <th class="num">Preço</th>
                <th class="num">Qtd atual</th>
                <th class="num">Valor atual</th>
                <th class="num">Alvo por ativo</th>
                <th class="num">Valor após</th>
                <th class="num">Falta (R$)</th>
                <th class="num">Qtd p/ comprar</th>
                <th class="num">Custo estimado</th>
              </tr>
            </thead>
            <tbody id="ewBody"></tbody>
          </table>
        </div>
      </div>
    </div>
  `;
  root.appendChild(wrap);

  const $ = (sel) => root.querySelector(sel);
  const ewN = $('#ewN');
  const ewTotal = $('#ewTotal');
  const ewBody = $('#ewBody');
  const ewBodyWrap = $('#ewBodyWrap');
  const ewToggle = $('#ewToggle');
  const ewModeInputs = root.querySelectorAll('input[name="ewMode"]');
  let ewMode = 'investir';
  const MODE_KEY = 'ew_mode';
  function loadMode() { return new Promise((resolve) => { try { chrome.storage.sync.get([MODE_KEY], (r) => resolve(r?.[MODE_KEY] || 'investir')); } catch { resolve('investir'); } }); }
  function saveMode(v) { return new Promise((resolve) => { try { chrome.storage.sync.set({ [MODE_KEY]: v }, () => resolve()); } catch { resolve(); } }); }
  

  // Utils (pt-BR parsing/formatting)
  function parseMoneyBR(text) {
    if (text == null) return NaN;
    let s = String(text).replace(/R\$|\s/g, '');
    s = s.replace(/\./g, '').replace(/,/g, '.');
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }
  function parseIntBR(text) {
    if (text == null) return NaN;
    const s = String(text).replace(/\./g, '').replace(/\s/g, '');
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : NaN;
  }
  function fmtBRL(n) { try { return n.toLocaleString('pt-BR', { style:'currency', currency:'BRL' }); } catch { return `R$ ${n.toFixed(2)}`; } }

  // Prefer the FIRST value shown in the page header (sensitive-field fw-600)
  function detectFirstSensitiveTotal() {
    const el = document.querySelector('span.sensitive-field.fw-600');
    if (!el) return NaN;
    const v = parseMoneyBR(el.textContent);
    return Number.isFinite(v) ? v : NaN;
  }

  function detectPortfolioTotal() {
    let maxVal = 0;
    document.querySelectorAll('span.sensitive-field.fw-600').forEach((sp) => {
      const v = parseMoneyBR(sp.textContent);
      if (Number.isFinite(v)) maxVal = Math.max(maxVal, v);
    });
    if (maxVal > 0) return maxVal;
    // Fallback: sum of currentValue if available, else price*quantity
    let sum = 0;
    document.querySelectorAll('tbody.list tr.item').forEach((r) => {
      const cv = r.querySelector('td[data-key="currentValue"]');
      let val = NaN;
      if (cv) {
        val = Number(cv.getAttribute('title'));
        if (!Number.isFinite(val)) val = parseMoneyBR(cv.textContent);
      }
      if (!Number.isFinite(val)) {
        const p = r.querySelector('td[data-key="price"]');
        const q = r.querySelector('td[data-key="quantity"]');
        let price = Number(p?.getAttribute('title'));
        if (!Number.isFinite(price)) price = parseMoneyBR(p?.textContent);
        const qty = Number(q?.getAttribute('title')) || parseIntBR(q?.textContent);
        if (Number.isFinite(price) && Number.isFinite(qty)) val = price * qty;
      }
      if (Number.isFinite(val)) sum += val;
    });
    return sum;
  }

  function readHoldingsFromPage() {
    const map = Object.create(null);
    document.querySelectorAll('tbody.list tr.item').forEach((r) => {
      const codeCell = r.querySelector('td[data-key="code"] .ticker');
      const code = (codeCell?.textContent || '').trim().toUpperCase();
      if (!code) return;
      const p = r.querySelector('td[data-key="price"]');
      const q = r.querySelector('td[data-key="quantity"]');
      let price = Number(p?.getAttribute('title'));
      if (!Number.isFinite(price)) price = parseMoneyBR(p?.textContent);
      const qty = Number(q?.getAttribute('title')) || parseIntBR(q?.textContent);
      map[code] = { price: Number.isFinite(price) ? price : NaN, qty: Number.isFinite(qty) ? qty : 0 };
    });
    return map;
  }

  function fetchTopNFromAPI(cb) {
    chrome.runtime.sendMessage({ type: 'GET_TOPN_CHECKLIST' }, (resp) => {
      if (resp && resp.ok && resp.json && Array.isArray(resp.json.data)) cb(null, resp.json.data);
      else cb(new Error(resp?.error || 'fetch checklist failed'));
    });
  }

  function normalizeChecklist(arr) {
    return (arr || []).map((r) => ({
      rank: Number(r.final_rank ?? r.rank ?? r.fm_rank),
      code: String(r.ticker || r.code || r.symbol || '').trim().toUpperCase(),
      price: Number(r.price || r.current_price || r.close || r.last || r.preco)
    })).filter(x => x.code && Number.isFinite(x.rank)).sort((a,b) => a.rank - b.rank);
  }

  // integer equal-weight allocator implemented in recompute()

  function recompute() {
    const N = Number(ewN.value) || 10;
    const total = parseMoneyBR(ewTotal.value);
    const holdings = readHoldingsFromPage();
    fetchTopNFromAPI((err, data) => {
      const normalized = normalizeChecklist(data);
      const top = normalized.slice(0, N);
      const targetPer = Number.isFinite(total) && total > 0 ? total / N : 0;
      ewBody.innerHTML = '';
      const computed = [];
      top.forEach((it) => {
        const fromPage = holdings[it.code] || { price: NaN, qty: 0 };
        const price = Number.isFinite(it.price) && it.price > 0 ? it.price : fromPage.price;
        const qty = Number.isFinite(fromPage.qty) ? fromPage.qty : 0;
        const currentAmount = Number.isFinite(price) ? price * qty : NaN;
        computed.push({
          rank: it.rank,
          code: it.code,
          price,
          qty,
          currentAmount,
          targetPer,
          // rest computed later by integer allocator
        });
      });
      // Integer allocation: two modes ('investir' vs 'rebalancear')
      let budgetCents = Number.isFinite(total) && total > 0 ? Math.round(total * 100) : 0;
      let spendMap = Object.create(null);
      let qtyMap = Object.create(null);

      if (ewMode === 'rebalancear') {
        // Interpret total as target final soma(ValueApós) dos Top N.
        // Portanto, o orçamento disponível para compras adicionais é: total - soma(ValorAtual).
        const targetTotalCents = Number.isFinite(total) && total > 0 ? Math.round(total * 100) : 0;
        const sumBaseCents = computed.reduce((acc, row) => acc + (Number.isFinite(row.currentAmount) ? Math.round(row.currentAmount * 100) : 0), 0);
        budgetCents = Math.max(0, targetTotalCents - sumBaseCents);
        // Rebalancear: compute target qty and buy only the additional quantity
        const items = computed.map((row) => {
          const priceCents = Number.isFinite(row.price) && row.price > 0 ? Math.round(row.price * 100) : 0;
          const baseCents = Number.isFinite(row.currentAmount) ? Math.round(row.currentAmount * 100) : 0;
          const targetCents = Number.isFinite(row.targetPer) ? Math.round(row.targetPer * 100) : 0;
          const targetQty = priceCents > 0 ? Math.floor(targetCents / priceCents) : 0;
          const baseQty = Number.isFinite(row.qty) ? row.qty : 0;
          const deltaQty = Math.max(0, targetQty - baseQty);
          const deficitCents = Math.max(0, targetCents - baseCents);
          return { code: row.code, rank: row.rank, priceCents, baseCents, targetCents, targetQty, deltaQty, deficitCents, q: 0, spendCents: 0 };
        });

        const minEligible = () => {
          let m = Number.MAX_SAFE_INTEGER;
          for (const it of items) if (it.priceCents > 0 && it.deltaQty > 0) m = Math.min(m, it.priceCents);
          return m;
        };
        const canBuyAny = () => items.some((it) => it.deltaQty > 0 && it.priceCents > 0 && it.priceCents <= budgetCents);
        while (canBuyAny() && budgetCents >= minEligible()) {
          // Update deficits based on current spend
          for (const it of items) {
            const after = it.baseCents + it.spendCents;
            it.deficitCents = Math.max(0, it.targetCents - after);
          }
          // Pick best by highest deficit ratio, then higher deficit, then lower price, then better rank
          let best = null;
          let bestRatio = -1;
          for (const it of items) {
            if (it.deltaQty <= 0 || it.priceCents <= 0 || it.priceCents > budgetCents) continue;
            const ratio = it.priceCents > 0 ? (it.deficitCents / it.priceCents) : 0;
            if (
              ratio > bestRatio ||
              (Math.abs(ratio - bestRatio) < 1e-9 && (
                it.deficitCents > (best?.deficitCents ?? -1) ||
                (it.deficitCents === (best?.deficitCents ?? -1) && (
                  it.priceCents < (best?.priceCents ?? Number.MAX_SAFE_INTEGER) ||
                  (it.priceCents === (best?.priceCents ?? 0) && it.rank < (best?.rank ?? 1e9))
                ))
              ))
            ) {
              best = it; bestRatio = ratio;
            }
          }
          if (!best) break;
          // Buy 1 share
          best.q += 1;
          best.deltaQty -= 1;
          best.spendCents += best.priceCents;
          budgetCents -= best.priceCents;
        }

        // Map results
        spendMap = Object.create(null);
        qtyMap = Object.create(null);
        for (const it of items) { spendMap[it.code] = (it.spendCents || 0) / 100; qtyMap[it.code] = it.q || 0; }
      } else {
        // Investir: buy towards targets and then equalize values with remaining budget
        const items = computed.map((row) => {
          const priceCents = Number.isFinite(row.price) && row.price > 0 ? Math.round(row.price * 100) : 0;
          const baseCents = Number.isFinite(row.currentAmount) ? Math.round(row.currentAmount * 100) : 0;
          const targetCents = Number.isFinite(row.targetPer) ? Math.round(row.targetPer * 100) : 0;
          const deficitCents = Math.max(0, targetCents - baseCents);
          return { code: row.code, rank: row.rank, priceCents, baseCents, targetCents, deficitCents, q: 0, spendCents: 0 };
        });

        const minPrice = () => {
          let m = Number.MAX_SAFE_INTEGER;
          for (const it of items) if (it.priceCents > 0) m = Math.min(m, it.priceCents);
          return m;
        };

        const canAffordAny = () => items.some((it) => it.priceCents > 0 && it.priceCents <= budgetCents);
        while (canAffordAny() && budgetCents >= minPrice()) {
          // Update dynamic deficits based on current spend
          for (const it of items) {
            const after = it.baseCents + it.spendCents;
            it.deficitCents = Math.max(0, it.targetCents - after);
          }

          // Prefer items still below initial target; else pick the one with smallest valueAfter
          const eligByDef = items.filter((it) => it.deficitCents > 0 && it.priceCents > 0 && it.priceCents <= budgetCents);

          let best = null;
          if (eligByDef.length) {
            let bestRatio = -1;
            for (const it of eligByDef) {
              const ratio = it.deficitCents / it.priceCents;
              if (
                ratio > bestRatio ||
                (Math.abs(ratio - bestRatio) < 1e-9 && (
                  it.priceCents < (best?.priceCents ?? Number.MAX_SAFE_INTEGER) ||
                  (it.priceCents === (best?.priceCents ?? 0) && it.rank < (best?.rank ?? 1e9))
                ))
              ) {
                best = it; bestRatio = ratio;
              }
            }
          } else {
            // All at/above target; continue equalizing by raising the lowest valueAfter
            let bestVal = Number.MAX_SAFE_INTEGER;
            for (const it of items) {
              if (it.priceCents <= 0 || it.priceCents > budgetCents) continue;
              const after = it.baseCents + it.spendCents;
              if (
                after < bestVal ||
                (after === bestVal && (
                  it.priceCents < (best?.priceCents ?? Number.MAX_SAFE_INTEGER) ||
                  (it.priceCents === (best?.priceCents ?? 0) && it.rank < (best?.rank ?? 1e9))
                ))
              ) {
                best = it; bestVal = after;
              }
            }
            if (!best) break;
          }

          // Buy 1 share of 'best'
          best.q += 1;
          best.spendCents += best.priceCents;
          budgetCents -= best.priceCents;
        }

        // Map results back
        spendMap = Object.create(null);
        qtyMap = Object.create(null);
        for (const it of items) { spendMap[it.code] = (it.spendCents || 0) / 100; qtyMap[it.code] = it.q || 0; }
      }

      // Render main table with resulting allocation
      computed.forEach((row) => {
        const tr = document.createElement('tr');
        const cost = Number(spendMap[row.code] || 0);
        const valueAfter = (Number.isFinite(row.currentAmount) ? row.currentAmount : 0) + cost;
        const faltaAfter = Number.isFinite(row.targetPer) ? Math.max(0, row.targetPer - valueAfter) : NaN;
        const qtyToBuy = Number(qtyMap[row.code] || 0);
        if (Number.isFinite(row.qty) && row.qty > 0) tr.classList.add('row-holding');
        tr.innerHTML = `
          <td>${row.rank}</td>
          <td>${row.code}</td>
          <td class="num">${Number.isFinite(row.price) ? fmtBRL(row.price) : '<span class="muted">—</span>'}</td>
          <td class="num">${Number.isFinite(row.qty) ? row.qty : '<span class="muted">—</span>'}</td>
          <td class="num">${Number.isFinite(row.currentAmount) ? fmtBRL(row.currentAmount) : '<span class="muted">—</span>'}</td>
          <td class="num">${Number.isFinite(row.targetPer) ? fmtBRL(row.targetPer) : '<span class="muted">—</span>'}</td>
          <td class="num">${(Number.isFinite(row.currentAmount) || Number.isFinite(cost)) ? fmtBRL(valueAfter) : '<span class="muted">—</span>'}</td>
          <td class="num">${Number.isFinite(faltaAfter) ? fmtBRL(faltaAfter) : '<span class="muted">—</span>'}</td>
          <td class="num">${qtyToBuy > 0 ? qtyToBuy : '<span class="muted">—</span>'}</td>
          <td class="num">${fmtBRL(cost)}</td>
        `;
        ewBody.appendChild(tr);
      });

      // Append remainder as the last row
      const remainder = Math.max(0, budgetCents) / 100;
      const remTr = document.createElement('tr');
      remTr.innerHTML = `
        <td></td>
        <td><strong>Sobra</strong></td>
        <td class="num"><span class="muted">—</span></td>
        <td class="num"><span class="muted">—</span></td>
        <td class="num"><span class="muted">—</span></td>
        <td class="num"><span class="muted">—</span></td>
        <td class="num"><span class="muted">—</span></td>
        <td class="num"><span class="muted">—</span></td>
        <td class="num">—</td>
        <td class="num">${fmtBRL(remainder)}</td>
      `;
      ewBody.appendChild(remTr);
    });
  }

  // Prefill total with detected portfolio total
  const first = detectFirstSensitiveTotal();
  const detected = Number.isFinite(first) && first > 0 ? first : detectPortfolioTotal();
  if (Number.isFinite(detected) && detected > 0) ewTotal.value = detected.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
  else ewTotal.value = '';

  // Events
  ewN.addEventListener('change', recompute);
  ewTotal.addEventListener('change', () => { // keep as BR currency if user typed raw number
    const n = parseMoneyBR(ewTotal.value);
    if (Number.isFinite(n)) ewTotal.value = n.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
    recompute();
  });
  // Mode change
  ewModeInputs.forEach((inp) => {
    inp.addEventListener('change', async () => {
      if (inp.checked) {
        ewMode = inp.value === 'rebalancear' ? 'rebalancear' : 'investir';
        await saveMode(ewMode);
        recompute();
      }
    });
  });

  // Persisted collapse state
  const COLLAPSE_KEY = 'ew_plan_collapsed';
  function loadCollapsed() { return new Promise((resolve) => { try { chrome.storage.sync.get([COLLAPSE_KEY], (r) => resolve(Boolean(r?.[COLLAPSE_KEY]))); } catch { resolve(false); } }); }
  function saveCollapsed(v) { return new Promise((resolve) => { try { chrome.storage.sync.set({ [COLLAPSE_KEY]: Boolean(v) }, () => resolve()); } catch { resolve(); } }); }

  function applyCollapseState(collapsed) {
    if (!ewBodyWrap || !ewToggle) return;
    ewBodyWrap.style.display = collapsed ? 'none' : 'block';
    ewToggle.textContent = collapsed ? 'Mostrar' : 'Ocultar';
  }

  ewToggle.addEventListener('click', async () => {
    const nowCollapsed = ewBodyWrap.style.display !== 'none' ? true : false;
    applyCollapseState(nowCollapsed);
    await saveCollapsed(nowCollapsed);
  });

  // Load initial collapsed state
  loadCollapsed().then((c) => applyCollapseState(c));
  // Load initial mode
  loadMode().then((m) => {
    ewMode = m === 'rebalancear' ? 'rebalancear' : 'investir';
    ewModeInputs.forEach((inp) => { inp.checked = (inp.value === ewMode); });
    recompute();
  });

  // Recompute on table changes (SPA)
  const tbody = document.querySelector('tbody.list');
  if (tbody) {
    const obs = new MutationObserver(() => recompute());
    obs.observe(tbody, { childList: true, subtree: false });
  }

  // Initial
  // recompute is also called after mode load
}
