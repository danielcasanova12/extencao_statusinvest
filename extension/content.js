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
  function fmtBRL(n) {
    if (n == null || !Number.isFinite(n)) return 'R$ 0,00';
    try { return n.toLocaleString('pt-BR', { style:'currency', currency:'BRL' }); }
    catch { return `R$ ${n.toFixed(2)}`; }
  }
  function fmtNumberBR(n) {
    if (n == null || !Number.isFinite(n)) return '0,00';
    try {
      return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch {
      return n.toFixed(2).replace('.', ',');
    }
  }

  function getPortfolioCostBasis() {
    let sum = 0;
    for (const r of findBodyRows()) {
        const avgPriceTd = r.querySelector('td[data-key="unitValue"]');
        const qtyTd = r.querySelector('td[data-key="quantity"]');
        let avgPrice = NaN;
        if (avgPriceTd) {
            const t = avgPriceTd.getAttribute('title');
            avgPrice = Number(t);
            if (!Number.isFinite(avgPrice)) avgPrice = parseMoneyBR(avgPriceTd.textContent);
        }
        const qty = qtyTd ? (Number(qtyTd.getAttribute('title')) || parseIntBR(qtyTd.textContent)) : NaN;
        if (Number.isFinite(avgPrice) && Number.isFinite(qty)) {
            sum += avgPrice * qty;
        }
    }
    return sum;
  }

  function getStocksPortfolioTotal() {
    const acoesHeader = findAcoesHeaderRoot();
    if (acoesHeader) {
        // The total value is usually in a sensitive field inside the header
        const totalSpan = acoesHeader.querySelector('span.sensitive-field');
        if (totalSpan) {
            const val = parseMoneyBR(totalSpan.textContent);
            if (Number.isFinite(val) && val > 0) {
                return val;
            }
        }
    }
    
    // Fallback to summing rows if header total is not found
    let sum = 0;
    for (const r of findBodyRows()) { // findBodyRows() targets the stocks table
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
    return sum > 0 ? sum : NaN;
  }

  function getStocksProfitLossBRL() {
    const acoesHeader = findAcoesHeaderRoot();
    if (!acoesHeader) return NaN;

    // The profit/loss is in a div with class 'total-1' inside the header
    const total1Div = acoesHeader.querySelector('.total-1');
    if (!total1Div) return NaN;

    // Inside it, a small tag contains a span with the value
    const valueSpan = total1Div.querySelector('small.sensitive-field span.fw-700');
    if (!valueSpan) return NaN;
    
    // The text content is something like " -231,87"
    const value = parseMoneyBR(valueSpan.textContent);
    return value;
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
      fmCell.style.setProperty('background-color', '#fff', 'important');
      fmCell.style.color = '';
      fmCell.style.fontWeight = '';

      if (rank == null || Number.isNaN(rank)) {
        fmCell.textContent = '-';
        // No data: red text
        fmCell.style.color = '#c62828';
        fmCell.style.fontWeight = '700';
      } else if (Number(rank) <= 20) {
        fmCell.textContent = String(rank);
        fmCell.style.color = '#03ab95'; // green text
        fmCell.style.fontWeight = '700';
      } else {
        fmCell.textContent = String(rank);
        fmCell.style.color = '#c62828'; // red text
        fmCell.style.fontWeight = '700';
      }
    }
    if (i10Cell) {
      const score = code && i10Map ? i10Map[code] : undefined;
      i10Cell.textContent = score != null ? String(score) : '-';
      i10Cell.style.color = score != null ? '#1565c0' : '#9e9e9e';
      i10Cell.style.setProperty('background-color', '#fff', 'important');
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
      // Fetch last-updated for all tables
      chrome.runtime.sendMessage({ type: 'FETCH_LAST_UPDATES' }, (lu) => {
        if (lu && lu.ok && lu.json && lu.json.updates) {
          const updates = lu.json.updates;
          const now = new Date();

          let priceUpdateInfo = null;
          let oldestUpdateInfo = { table: null, date: null, days: -1, isoTs: null };

          // Find both price update and oldest update
          for (const table in updates) {
            const isoTs = updates[table];
            if (isoTs) {
              const date = new Date(isoTs);
              const diffTime = now - date;
              const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

              // Check for price table (e.g., tb_statusinvest)
              if (/statusinvest/i.test(table)) {
                priceUpdateInfo = {
                  tableName: 'Preços',
                  date: date,
                  days: diffDays,
                  isoTs: isoTs,
                };
              }

              // Check for oldest
              if (oldestUpdateInfo.date === null || date < oldestUpdateInfo.date) {
                oldestUpdateInfo = { table, date, days: diffDays, isoTs: isoTs };
              }
            }
          }

          // Decide what to display: prioritize price update info
          if (priceUpdateInfo) {
            placeLastUpdatedIndicator(priceUpdateInfo.tableName, priceUpdateInfo.days, priceUpdateInfo.isoTs, true);
          } else if (oldestUpdateInfo.date) {
            // If no price info, show the oldest as before
            placeLastUpdatedIndicator(oldestUpdateInfo.table, oldestUpdateInfo.days, oldestUpdateInfo.isoTs, false);
          }

          // Alert should always be based on the absolute oldest data
          if (oldestUpdateInfo.date) {
            showOutdatedDataAlert(oldestUpdateInfo.isoTs);
          }
        } else {
          console.warn('[content] last-updates request failed:', lu?.error || 'unknown');
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

  const OUTDATED_ALERT_STORAGE_KEY = 'outdated_alert_last_shown';
  const OUTDATED_ALERT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  function showOutdatedDataAlert(isoTs) {
    if (!isoTs) return;

    const date = new Date(isoTs);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffTime = startOfToday - startOfDate;
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 30) {
      return; // Data is not outdated, do nothing.
    }

    chrome.storage.local.get([OUTDATED_ALERT_STORAGE_KEY], (result) => {
      if (chrome.runtime.lastError) {
        console.error('[StatusInvest Ext] Error getting storage:', chrome.runtime.lastError);
        return;
      }
      const lastShown = result[OUTDATED_ALERT_STORAGE_KEY];
      const nowMs = Date.now();

      if (lastShown && (nowMs - lastShown < OUTDATED_ALERT_INTERVAL_MS)) {
        // Alert was shown recently, do nothing.
        return;
      }

      // Time to show the alert.
      const alertId = 'fm-outdated-data-alert';
      if (document.getElementById(alertId)) return; // Already visible

      const alertDiv = document.createElement('div');
      alertDiv.id = alertId;
      Object.assign(alertDiv.style, {
        position: 'fixed',
        top: '20px',
        right: '20px',        
        backgroundColor: '#03ab95',
        color: 'white',
        padding: '16px',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        zIndex: '99999',
        maxWidth: '380px',
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
        fontSize: '14px',
        lineHeight: '1.5',
      });

      const message = document.createElement('p');
      message.textContent = "Seus dados estão desatualizados há mais de 30 dias. Para garantir a precisão da análise, baixe o novo CSV do StatusInvest e execute o processo 'TODOS' na extensão.";
      message.style.margin = '0';
      message.style.paddingRight = '20px'; // space for close button

      const closeButton = document.createElement('button');
      closeButton.innerHTML = '&times;'; // Use a multiplication sign for 'X'
      Object.assign(closeButton.style, { position: 'absolute', top: '8px', right: '10px', background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', fontSize: '20px', fontWeight: 'bold', padding: '0', lineHeight: '1', opacity: '0.8' });
      closeButton.onmouseover = () => { closeButton.style.opacity = '1'; };
      closeButton.onmouseout = () => { closeButton.style.opacity = '0.8'; };
      closeButton.onclick = () => { alertDiv.remove(); };

      alertDiv.appendChild(message);
      alertDiv.appendChild(closeButton);
      document.body.appendChild(alertDiv);

      // Update the timestamp in storage.
      chrome.storage.local.set({ [OUTDATED_ALERT_STORAGE_KEY]: nowMs });
    });
  }

  let headerIndicatorTries = 0;
  function placeLastUpdatedIndicator(tableName, daysAgo, isoTs, isPriceUpdate = false) {
    try {
      const id = 'fm-last-updated-indicator';
      if (!tableName || daysAgo < 0) return;

      // --- Start of color logic ---
      const diffDays = daysAgo;

      let bgColor = '';
      let textColor = '#777';
      let fontWeight = '400';

      if (diffDays >= 30) {
        // Red: 30+ days old
        bgColor = '#ffebee';
        textColor = '#c62828';
        fontWeight = '700';
      } else if (diffDays >= 15) {
        // Yellow: 15-29 days old
        bgColor = '#fff7ed';
        textColor = '#92400e';
        fontWeight = '500';
      } else {
        // Green: up to 14 days old
        bgColor = '#e6f7f5';
        textColor = '#03ab95';
      }

      const daysText = diffDays === 0 ? 'hoje' : (diffDays === 1 ? '1 dia atrás' : `${diffDays} dias atrás`);
      const text = isPriceUpdate
        ? `Preços atualizados ${daysText}`
        : `Dados mais antigos (${tableName}) atualizados ${daysText}`;
      
      const applyStyles = (el) => {
        if (!el) return;
        el.style.fontWeight = fontWeight;
        el.style.color = textColor;
        el.style.backgroundColor = bgColor;
        el.style.padding = '2px 6px';
        el.style.borderRadius = '4px';
        el.textContent = `• ${text}`;
        el.title = `Data exata: ${formatBrazil(isoTs)}`;
      };
      // --- End of color logic ---

      let placed = false;

      // 1) Preferir adicionar como uma "coluna" dentro do container do título AÇÕES
      const acoesContainer = findAcoesHeaderContainer();
      if (acoesContainer) {
        let wrapper = document.getElementById(id);
        if (!wrapper) {
          wrapper = document.createElement('div');
          wrapper.id = id;
          wrapper.style.display = 'flex';
          wrapper.style.alignItems = 'center';
          wrapper.style.marginLeft = '12px';

          const label = document.createElement('small');
          applyStyles(label);
          wrapper.appendChild(label);

          acoesContainer.appendChild(wrapper);
        } else {
          const lbl = wrapper.firstChild || document.createElement('small');
          applyStyles(lbl);
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
            applyStyles(label);
            wrapper.appendChild(label);
            headerRoot.appendChild(wrapper);
          } else {
            const lbl = wrapper.firstChild || document.createElement('small');
            applyStyles(lbl);
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
              node.style.display = 'inline-block';
              node.style.marginTop = '2px';
              applyStyles(node);
              acoesDiv.appendChild(node);
            } else {
              applyStyles(node);
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
            node.style.display = 'inline-block';
            applyStyles(node);
            anchor.insertAdjacentElement('afterend', node);
          } else {
            applyStyles(node);
          }
          placed = true;
        }
      }

      if (!placed && headerIndicatorTries < 10) {
        headerIndicatorTries += 1;
        setTimeout(() => placeLastUpdatedIndicator(tableName, daysAgo, isoTs), 500);
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

  function setShowAllOnPagination() {
    return new Promise((resolve, reject) => {
      try {
        // 1. Find the "AÇÕES" group.
        let acoesGroup = null;
        // Use a more specific selector for the "AÇÕES" header
        const acoesH3 = document.querySelector('.collapsible-header h3.text-category-1');
        if (acoesH3) {
          acoesGroup = acoesH3.closest('li.group');
        }

        if (!acoesGroup) {
          console.warn('[StatusInvest Ext] "AÇÕES" group not found. Cannot set pagination to "TODOS".');
          resolve();
          return;
        }

        // 2. Expand it if it's not active.
        if (!acoesGroup.classList.contains('active')) {
          const header = acoesGroup.querySelector('.collapsible-header');
          if (header) header.click();
        }
  
        // 3. Wait for animations and DOM updates.
        setTimeout(() => {
          try {
            // 4. Find the pagination control within the "AÇÕES" group and set it to "TODOS".
            const control = acoesGroup.querySelector('.pagination-control');
            if (control) {
              const selectElement = control.querySelector('select[data-formselect]');
              // Check if "TODOS" is not already selected. The value for TODOS is -1.
              if (selectElement && selectElement.value !== '-1') {
                // This is a Materialize CSS dropdown. We need to find the generated <ul> and click the <li>.
                const dropdownInput = control.querySelector('input.select-dropdown');
                if (dropdownInput) {
                  const dropdownId = dropdownInput.dataset.target;
                  if (dropdownId) {
                    const dropdownUl = document.getElementById(dropdownId);
                    if (dropdownUl) {
                      const todosLi = Array.from(dropdownUl.querySelectorAll('li > span'))
                                           .find(span => span.textContent.trim().toUpperCase() === 'TODOS')
                                           ?.parentElement;
                      // Click if it exists and is not already selected
                      if (todosLi && !todosLi.classList.contains('selected')) {
                        todosLi.click();
                      }
                    }
                  }
                }
              }
            } else {
              console.warn('[StatusInvest Ext] Pagination control for "AÇÕES" not found inside its group.');
            }
            resolve(); // Promise resolves successfully
          } catch (e) { reject(e); }
        }, 1000); // Wait 1s for animations
      } catch (e) { reject(e); }
    });
  }
  
  // Floating Shadow DOM panel: Portfolio Distribution
  function initPortfolioDistributionPanel() {
    const HOST_ID = 'portfolio-distribution-host';
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
        .header { display:flex; align-items:center; justify-content:space-between; padding: 10px 12px; border-bottom: 1px solid #f3f4f6; background:#03ab95; color: white; border-top-left-radius:10px; border-top-right-radius:10px; }
        .title { font-weight: 700; font-size: 14px; margin: 0; color: white; }
        .body { padding: 10px 12px; }
        .allocation-table { width:100%; border-collapse:collapse; font-size:12px; margin-top:8px; }
        .allocation-table th, .allocation-table td { padding:8px 10px; border:1px solid #e5e7eb; text-align:left; }
        .allocation-table th { background:#f3f4f6; font-weight:600; color:#374151; font-size:11px; }
        .allocation-table td { background:#fff; }
        .allocation-table .number { text-align:right; font-family: monospace; }
        .allocation-table tr:hover { background:#f8fafc; }
        .allocation-table td:first-child { font-weight:500; }
        .summary-row { display:flex; gap:12px; justify-content:space-between; margin-bottom:12px; }
        .summary-item { text-align:center; flex:1; padding:8px; background:#f9fafb; border-radius:6px; border:1px solid #e5e7eb; }
        .summary-value { font-size:14px; font-weight:600; color:#1f2937; margin-bottom:2px; }
        .summary-label { font-size:10px; color:#6b7280; }
        .loading { text-align:center; padding:20px; color:#6b7280; font-style:italic; }
        button { padding:6px 10px; border:1px solid #d1d5db; background:#03ab95; color:#fff; border-radius:6px; font-size:12px; cursor:pointer; margin-right:6px; }
        button:hover { background:#028a7a; }
        .add-row-section { margin:15px 0; text-align:center; }
        .add-row-btn { background:#6366f1; font-size:12px; padding:8px 15px; }
        .add-row-btn:hover { background:#5b21b6; }
        .edit-btn { background:#10b981; color:white; border:none; border-radius:6px; font-size:12px; padding:8px 15px; margin-right:8px; cursor:pointer; }
        .edit-btn:hover { background:#059669; }
        .save-btn { background:#f59e0b; color:white; border:none; border-radius:6px; font-size:12px; padding:8px 15px; margin-right:8px; cursor:pointer; }
        .save-btn:hover { background:#d97706; }
        .editable-cell { position:relative; }
        .editable-input { width:60px; padding:2px 4px; border:1px solid #d1d5db; border-radius:3px; text-align:center; font-size:11px; }
        .editable-input:focus { outline:none; border-color:#03ab95; }
        .remove-row-btn { background:#dc2626; color:#fff; border:none; padding:2px 6px; border-radius:3px; font-size:10px; cursor:pointer; }
        .remove-row-btn:hover { background:#b91c1c; }
      </style>
      <div class="card" part="card">
        <div class="header">
          <h3 class="title">Distribuição da Carteira por Classe</h3>
          <button id="refreshPortfolio">↻ Atualizar</button>
        </div>
        <div class="body">
          <div class="summary-row">
            <div class="summary-item">
              <div class="summary-value" id="totalValue">R$ 0,00</div>
              <div class="summary-label">Total Carteira</div>
            </div>
            <div class="summary-item">
              <div class="summary-value" id="assetsCount">0</div>
              <div class="summary-label">Total Ativos</div>
            </div>
            <div class="summary-item">
              <div class="summary-value" id="lastUpdate">-</div>
              <div class="summary-label">Última Atualização</div>
            </div>
          </div>
          
          <div class="add-row-section">
            <button id="editTableBtn" class="edit-btn">✏️ Editar</button>
            <button id="saveTableBtn" class="save-btn" style="display:none;">💾 Salvar</button>
            <button id="addNewRow" class="add-row-btn" style="display:none;">➕ Incluir Nova Classe</button>
          </div>
          
          <div id="distributionContent">
            <div class="loading">Clique em "Atualizar" para visualizar sua distribuição atual</div>
          </div>
        </div>
      </div>
    `;
    root.appendChild(wrap);

    // Edit mode state
    let isEditMode = false;
    let tempAllocationData = null; // Temporary data for editing

    const $ = (sel) => root.querySelector(sel);

    // Make real-time update functions available locally
    function updateTargetInRealTime(className, newValue) {
      if (!isEditMode || !tempAllocationData) return;
      
      const value = parseFloat(newValue) || 0;
      
      if (!tempAllocationData[className]) {
        tempAllocationData[className] = { target: value };
      } else {
        tempAllocationData[className].target = value;
      }
      
      // Update total immediately
      updateTotalTargetPercentage();
      
      console.log(`Real-time update: ${className} = ${value}%`);
    }

    function updateCustomValueInRealTime(className, newValue) {
      if (!isEditMode || !tempAllocationData) return;
      
      const value = parseFloat(newValue) || 0;
      
      if (tempAllocationData[className] && tempAllocationData[className].isCustom) {
        tempAllocationData[className].value = value;
        
        // Recalculate the table to show new percentages
        setTimeout(() => updatePortfolioDistribution(), 100);
        
        console.log(`Custom value real-time update: ${className} = ${formatCurrency(value)}`);
      }
    }

    // Remove allocation row function
    async function removeAllocationRow(className) {
      if (!confirm(`Deseja remover a classe "${className}"?`)) return;
      
      if (isEditMode) {
        // Remove from temporary data AND save to storage immediately
        if (tempAllocationData && tempAllocationData[className]) {
          delete tempAllocationData[className];
          
          // Save the change permanently to storage
          await saveAllocationData(tempAllocationData);
          updatePortfolioDistribution();
          
          console.log(`Classe "${className}" removida permanentemente`);
        }
      } else {
        // Remove directly from storage (legacy behavior)
        const allocationData = await getAllocationData();
        delete allocationData[className];
        await saveAllocationData(allocationData);
        updatePortfolioDistribution();
        
        console.log(`Classe "${className}" removida do storage`);
      }
    }

    // Update total target percentage display
    function updateTotalTargetPercentage() {
      const dataToUse = isEditMode && tempAllocationData ? tempAllocationData : null;
      
      if (dataToUse) {
        // Use temporary data in edit mode
        const totalTarget = Object.values(dataToUse).reduce((sum, data) => sum + (data.target || 0), 0);
        updateTotalDisplay(totalTarget);
      } else {
        // Use saved data in view mode
        getAllocationData().then(allocationData => {
          const totalTarget = Object.values(allocationData).reduce((sum, data) => sum + (data.target || 0), 0);
          updateTotalDisplay(totalTarget);
        });
      }
    }

    // Helper function to update total display
    function updateTotalDisplay(totalTarget) {
      // Update the total target percentage cell
      const targetCell = document.getElementById('total-target');
      if (targetCell) {
        targetCell.textContent = `${totalTarget.toFixed(1)}%`;
      }
      
      // Update the total difference cell
      const diffCell = document.getElementById('total-diff');
      if (diffCell) {
        const diffValue = Math.abs(100 - totalTarget);
        const isValid = diffValue <= 1;
        const diffColor = isValid ? '#6b7280' : '#dc2626';
        const diffIcon = isValid ? '✓' : '⚠️';
        diffCell.style.color = diffColor;
        diffCell.innerHTML = `${diffIcon} ${diffValue.toFixed(1)}%`;
      }
    }
    
    // Asset classification function
    function classifyAsset(ticker) {
      ticker = (ticker || '').toUpperCase();
      
      // FIIs - geralmente terminam com 11
      if (/\d{2}$/.test(ticker) && ticker.endsWith('11')) {
        return 'FIIs';
      }
      
      // ETFs - alguns padrões comuns
      if (/^(BOVA|SMAL|IVVB|SPXI|BRAX|XINA|PIBB|ISUS|IMAB|IVVB|IFIX|DIVO|FIND|MATB|ECOO|GOVE|BOVX)/.test(ticker)) {
        return 'ETFs';
      }
      
      // EUA - BDRs geralmente terminam com 34 ou 35
      if (ticker.endsWith('34') || ticker.endsWith('35')) {
        return 'EUA';
      }
      
      // Ações - padrão geral
      return 'Ações';
    }

    // Format currency
    function formatCurrency(value) {
      return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
      }).format(value || 0);
    }

    // Parse BRL currency value to number
    function parseBRLValue(text) {
      if (!text || typeof text !== 'string') return 0;
      
      try {
        // Remove "R$" and spaces, then replace thousand separators and decimal separator
        let cleanValue = text.replace(/R\$\s*/g, '').trim();
        
        // Handle negative values
        const isNegative = cleanValue.startsWith('-');
        if (isNegative) cleanValue = cleanValue.substring(1);
        
        // Replace thousand separators (.) and decimal separator (,)
        cleanValue = cleanValue.replace(/\./g, '').replace(',', '.');
        
        // Check if the clean value contains only valid numeric characters
        if (!/^\d+(\.\d+)?$/.test(cleanValue)) {
          console.warn(`[parseBRLValue] Invalid numeric format: "${text}" -> "${cleanValue}"`);
          return 0;
        }
        
        const number = parseFloat(cleanValue);
        console.log(`[parseBRLValue] Input: "${text}" -> Clean: "${cleanValue}" -> Number: ${number}`);
        
        if (isNaN(number)) {
          console.error(`[parseBRLValue] Failed to parse: "${text}" -> "${cleanValue}" -> NaN`);
          return 0;
        }
        
        return isNegative ? -number : number;
      } catch (error) {
        console.warn('[Portfolio Totals] Error parsing BRL value:', text, error);
        return 0;
      }
    }

    // Collect portfolio totals by asset class
    function collectPortfolioTotals() {
      const totals = {
        acoes: 0,
        fiis: 0,
        etfs: 0,
        exterior: 0
      };

      try {
        // Map of categories to consolidate
        const categoryMappings = {
          '1': 'acoes',          // Ações
          '2': 'fiis',           // FIIs
          '22': 'fiis',          // FI-Infra
          '24': 'fiis',          // FIAGRO
          '6': 'etfs',           // ETF Brasil
          '901': 'exterior'      // ETF Exterior
        };

        // Find all category headers and their corresponding total values
        console.log('[Portfolio Totals] Starting collection with category mappings:', categoryMappings);
        
        Object.keys(categoryMappings).forEach(categoryCode => {
          try {
            // Find headers with the category class
            const selector = `h3.text-category-${categoryCode}`;
            const headers = document.querySelectorAll(selector);
            console.log(`[Portfolio Totals] Found ${headers.length} headers for selector: ${selector}`);
            
            headers.forEach((header, index) => {
              console.log(`[Portfolio Totals] Processing header ${index + 1} for category ${categoryCode}`);
              try {
                // Find the parent collapsible header
                const collapsibleHeader = header.closest('header.collapsible-header');
                if (!collapsibleHeader) {
                  console.warn(`[Portfolio Totals] No collapsible header found for category ${categoryCode}`);
                  return;
                }
                
                // Find the percentage line section which contains the total value
                // Try different selectors for the line containing the value
                let percentageLine = collapsibleHeader.querySelector('.line');
                if (!percentageLine) {
                  // Try alternative selectors
                  percentageLine = collapsibleHeader.querySelector('.d-flex.align-items-center');
                  if (!percentageLine) {
                    percentageLine = collapsibleHeader.querySelector('div[class*="line"]');
                    if (!percentageLine) {
                      // Try to find any element containing the value pattern
                      percentageLine = collapsibleHeader;
                    }
                  }
                }
                
                if (!percentageLine) {
                  console.warn(`[Portfolio Totals] No percentage line found for category ${categoryCode}`);
                  console.log(`[Portfolio Totals] Available elements in header:`, collapsibleHeader.innerHTML.substring(0, 200) + '...');
                  return;
                }
                
                // Find the total value in the format: R$<span class="sensitive-field fw-600">12.161,25</span>
                // Try different selectors for the value container
                let valueContainer = percentageLine.querySelector('small.fs-3.lh-3.fw-100');
                if (!valueContainer) {
                  // Try alternative selectors
                  valueContainer = percentageLine.querySelector('small');
                  if (!valueContainer) {
                    valueContainer = percentageLine.querySelector('.fs-3');
                    if (!valueContainer) {
                      valueContainer = percentageLine.querySelector('[class*="fs-"]');
                      if (!valueContainer) {
                        // Last resort: search in the entire line
                        valueContainer = percentageLine;
                      }
                    }
                  }
                }
                
                if (!valueContainer) {
                  console.warn(`[Portfolio Totals] No value container found for category ${categoryCode}`);
                  console.log(`[Portfolio Totals] Available elements in percentage line:`, percentageLine.innerHTML.substring(0, 200) + '...');
                  return;
                }
                
                // Find the span with the actual value
                let valueSpan = valueContainer.querySelector('span.sensitive-field.fw-600');
                if (!valueSpan) {
                  // Try alternative selectors
                  valueSpan = valueContainer.querySelector('span.sensitive-field');
                  if (!valueSpan) {
                    valueSpan = valueContainer.querySelector('span.fw-600');
                    if (!valueSpan) {
                      valueSpan = valueContainer.querySelector('span[class*="sensitive"]');
                      if (!valueSpan) {
                        // Try any span with numeric content that looks like currency
                        const allSpans = valueContainer.querySelectorAll('span');
                        for (const span of allSpans) {
                          const text = span.textContent?.trim();
                          if (text && /\d+[.,]\d+/.test(text) && !text.toLowerCase().includes('ativo')) {
                            valueSpan = span;
                            console.log(`[Portfolio Totals] Found numeric span: "${text}"`);
                            break;
                          }
                        }
                      }
                    }
                  }
                }
                
                if (!valueSpan) {
                  console.warn(`[Portfolio Totals] No value span found for category ${categoryCode}`);
                  console.log(`[Portfolio Totals] Available spans in value container:`, 
                    Array.from(valueContainer.querySelectorAll('span')).map(s => s.className + ': ' + s.textContent).join(', '));
                  return;
                }
                
                const valueText = valueSpan.textContent?.trim();
                console.log(`[Portfolio Totals] Category ${categoryCode}: Raw value text = "${valueText}"`);
                
                if (valueText) {
                  const value = parseBRLValue('R$ ' + valueText); // Add R$ prefix for parsing
                  console.log(`[Portfolio Totals] Category ${categoryCode}: Parsed value = ${value} (from "${valueText}")`);
                  
                  const consolidatedCategory = categoryMappings[categoryCode];
                  
                  if (isNaN(value)) {
                    console.error(`[Portfolio Totals] NaN detected for category ${categoryCode}! Raw text: "${valueText}", Attempted parse: ${value}`);
                    console.log(`[Portfolio Totals] Full element HTML:`, valueSpan.outerHTML);
                  } else {
                    totals[consolidatedCategory] += value;
                    console.log(`[Portfolio Totals] ✓ Category ${categoryCode} (${consolidatedCategory}): R$ ${valueText} -> ${value}`);
                  }
                } else {
                  console.warn(`[Portfolio Totals] No value text found for category ${categoryCode}`);
                  console.log(`[Portfolio Totals] Value span content:`, valueSpan);
                }
              } catch (error) {
                console.warn(`[Portfolio Totals] Error processing category ${categoryCode} header:`, error);
              }
            });
          } catch (error) {
            console.warn(`[Portfolio Totals] Error processing category ${categoryCode}:`, error);
          }
        });

        console.log('[Portfolio Totals] Final totals:', totals);
        return totals;
      } catch (error) {
        console.error('[Portfolio Totals] Error collecting portfolio totals:', error);
        return totals;
      }
    }

    // Save portfolio totals to cache
    function savePortfolioTotalsToCache(totals) {
      try {
        chrome.storage.local.set({ portfolio_totals_by_class: totals }, () => {
          if (chrome.runtime.lastError) {
            console.error('[Portfolio Totals] Error saving to cache:', chrome.runtime.lastError.message);
          } else {
            console.log('[Portfolio Totals] Totals saved to cache:', totals);
          }
        });
      } catch (error) {
        console.error('[Portfolio Totals] Error saving totals to cache:', error);
      }
    }

    // Get portfolio totals from cache
    function getPortfolioTotalsFromCache(callback) {
      try {
        chrome.storage.local.get(['portfolio_totals_by_class'], (result) => {
          if (chrome.runtime.lastError) {
            console.error('[Portfolio Totals] Error reading from cache:', chrome.runtime.lastError.message);
            callback(null);
          } else {
            const totals = result.portfolio_totals_by_class || {
              acoes: 0,
              fiis: 0,
              etfs: 0,
              exterior: 0
            };
            console.log('[Portfolio Totals] Totals retrieved from cache:', totals);
            callback(totals);
          }
        });
      } catch (error) {
        console.error('[Portfolio Totals] Error getting totals from cache:', error);
        callback(null);
      }
    }

    // Portfolio allocation management (simplified)
    function getAllocationData() {
      return new Promise((resolve) => {
        chrome.storage.local.get(['allocation_data'], (result) => {
          const defaultData = {
            'Ações': { target: 50 },
            'FIIs': { target: 20 },
            'ETFs': { target: 15 },
            'EUA': { target: 15 }
          };
          resolve(result.allocation_data || defaultData);
        });
      });
    }

    function saveAllocationData(data) {
      chrome.storage.local.set({ allocation_data: data }, () => {
        console.log('[Allocation] Saved allocation data:', data);
      });
    }

    function addNewAllocationRow() {
      const className = prompt('Nome da nova classe (ex: Renda Fixa):');
      if (!className || className.trim() === '') return;

      const value = parseFloat(prompt('Valor atual em R$ (deixe 0 se não tiver):') || '0');
      const target = parseFloat(prompt('Porcentagem alvo (%):') || '10');

      getAllocationData().then(data => {
        if (data[className.trim()]) {
          alert('Já existe uma classe com este nome.');
          return;
        }

        data[className.trim()] = { 
          value: value,
          target: target,
          isCustom: true
        };
        
        saveAllocationData(data);
        setTimeout(() => updatePortfolioDistribution(), 200);
      });
    }

    // Update target value with real-time total update
    window.updateTargetValue = async (className, newValue) => {
      const value = parseFloat(newValue) || 0;
      const allocationData = await getAllocationData();
      
      if (!allocationData[className]) {
        allocationData[className] = { target: value };
      } else {
        allocationData[className].target = value;
      }
      
      await saveAllocationData(allocationData);
      console.log(`Target updated for ${className}: ${value}%`);
      
      // Update total target percentage in real time
      updateTotalTargetPercentage();
    };

    // Read holdings from page for portfolio calculations
    function readHoldingsFromPage(rootEl) {
      try {
        const scope = rootEl && typeof rootEl.querySelectorAll === 'function' ? rootEl : document;
        const map = Object.create(null);
        
        console.log('[readHoldingsFromPage] Starting to read holdings from scope:', scope === document ? 'document' : 'rootEl');
        
        const rows = scope.querySelectorAll('tbody.list tr.item');
        console.log(`[readHoldingsFromPage] Found ${rows.length} holding rows`);
        
        rows.forEach((r, index) => {
          try {
            const codeTd = r.querySelector('td[data-key="code"]');
            const code = (codeTd?.getAttribute('title') || codeTd?.textContent || '').trim().toUpperCase();
            if (!code) {
              console.warn(`[readHoldingsFromPage] Row ${index}: No code found`);
              return;
            }
            
            const p = r.querySelector('td[data-key="price"]');
            const q = r.querySelector('td[data-key="quantity"]');
            const avg = r.querySelector('td[data-key="unitValue"]');
            
            let price = Number(p?.getAttribute('title'));
            if (!Number.isFinite(price)) price = parseMoneyBR(p?.textContent);
            
            const qty = Number(q?.getAttribute('title')) || parseIntBR(q?.textContent);
            
            let avgPrice = Number(avg?.getAttribute('title'));
            if (!Number.isFinite(avgPrice)) avgPrice = parseMoneyBR(avg?.textContent);
            
            map[code] = { 
              price: Number.isFinite(price) ? price : NaN, 
              qty: Number.isFinite(qty) ? qty : 0, 
              avgPrice: Number.isFinite(avgPrice) ? avgPrice : NaN 
            };
            
            console.log(`[readHoldingsFromPage] Row ${index}: ${code} - Price: ${price}, Qty: ${qty}`);
          } catch (rowError) {
            console.error(`[readHoldingsFromPage] Error processing row ${index}:`, rowError);
          }
        });
        
        const holdingCodes = Object.keys(map);
        console.log(`[readHoldingsFromPage] Successfully processed ${holdingCodes.length} holdings:`, holdingCodes);
        
        return map;
      } catch (error) {
        console.error('[readHoldingsFromPage] Critical error:', error);
        return Object.create(null);
      }
    }

    // Update portfolio distribution
    // Update portfolio distribution
    async function updatePortfolioDistribution() {
      const functionName = 'updatePortfolioDistribution';
      console.log(`[${functionName}] Starting portfolio distribution update`);
      
      try {
        $('#distributionContent').innerHTML = '<div class="loading">Carregando...</div>';

        // Step 1: Collect portfolio totals by asset class
        try {
          const portfolioTotals = collectPortfolioTotals();
          savePortfolioTotalsToCache(portfolioTotals);
        } catch (totalsError) {
          console.error(`[${functionName}] Error collecting portfolio totals:`, totalsError);
        }

        // Step 2: Get holdings from page for ticker classification
        const holdings = readHoldingsFromPage(document);
        if (!holdings || Object.keys(holdings).length === 0) {
          $('#distributionContent').innerHTML = '<div class="loading">Nenhum ativo encontrado. Certifique-se de que a página da carteira carregou completamente.</div>';
          return;
        }

        // Step 3: Get allocation data and portfolio totals
        const [baseAllocationData, cachedTotals] = await Promise.all([
          getAllocationData(),
          new Promise(resolve => getPortfolioTotalsFromCache(resolve))
        ]);
        
        // Use temporary data if in edit mode, otherwise use saved data
        const allocationData = isEditMode && tempAllocationData ? tempAllocationData : baseAllocationData;
        if (!tempAllocationData && isEditMode) {
          tempAllocationData = JSON.parse(JSON.stringify(baseAllocationData)); // Deep copy
        }

        if (!cachedTotals) {
          $('#distributionContent').innerHTML = '<div class="loading" style="color:#dc2626;">Erro ao carregar totais. Tente novamente.</div>';
          return;
        }

        // Step 4: Build distribution data
        const distribution = {
          'Ações': { value: cachedTotals.acoes, count: 0, tickers: [] },
          'FIIs': { value: cachedTotals.fiis, count: 0, tickers: [] },
          'ETFs': { value: cachedTotals.etfs, count: 0, tickers: [] },
          'EUA': { value: cachedTotals.exterior, count: 0, tickers: [] }
        };

        // Count tickers per class
        Object.entries(holdings).forEach(([ticker, data]) => {
          if (data && typeof data.qty === 'number' && data.qty > 0) {
            const assetClass = classifyAsset(ticker);
            distribution[assetClass].tickers.push(ticker);
            distribution[assetClass].count++;
          }
        });

        // Add custom classes
        console.log('Adding custom classes from allocationData:', allocationData);
        console.log('Is in edit mode:', isEditMode);
        console.log('Temp allocation data:', tempAllocationData);
        Object.entries(allocationData).forEach(([className, data]) => {
          if (data.isCustom && !distribution[className]) {
            console.log(`Adding custom class: ${className}`, data);
            distribution[className] = {
              value: data.value || 0,
              count: 0,
              tickers: [],
              isCustom: true
            };
          }
        });

        console.log('Final distribution object:', distribution);

        // Calculate total value
        let totalValue = 0;
        Object.values(distribution).forEach(data => {
          totalValue += data.value;
        });

        // Step 5: Create editable table
        let portfolioHTML = `
          <table class="allocation-table">
            <thead>
              <tr>
                <th>Classe</th>
                <th style="text-align:right;">Valor</th>
                <th style="text-align:right;">% Atual</th>
                <th style="text-align:right;">% Meta</th>
                <th style="text-align:right;">Diferença</th>
                ${isEditMode ? '<th style="text-align:center;">Ações</th>' : ''}
              </tr>
            </thead>
            <tbody>
        `;

        Object.entries(distribution).forEach(([className, data]) => {
          console.log(`Rendering class: ${className}`, data);
          
          const percentage = totalValue > 0 ? (data.value / totalValue * 100) : 0;
          const targetPercentage = allocationData[className]?.target || 0;
          const difference = percentage - targetPercentage;
          
          console.log(`${className}: value=${data.value}, percentage=${percentage.toFixed(1)}%, target=${targetPercentage}%`);
          
          const diffColor = Math.abs(difference) <= 1 ? '#6b7280' : 
                           difference > 0 ? '#dc2626' : '#03ab95';
          const diffIcon = Math.abs(difference) <= 1 ? '✓' :
                           difference > 0 ? '↑' : '↓';

          const isCustom = data.isCustom;
          const valueCell = isCustom 
            ? (isEditMode ? `<input type="number" class="editable-input custom-value-input" value="${data.value.toFixed(2)}" data-class="${className}" style="width:80px;">` : formatCurrency(data.value))
            : formatCurrency(data.value);

          portfolioHTML += `
            <tr ${isCustom ? 'style="background:#f8fafc;"' : ''}>
              <td><strong>${className}</strong> ${isCustom ? '<small style="color:#6b7280;">(Custom)</small>' : ''}</td>
              <td class="number">${valueCell}</td>
              <td class="number">${percentage.toFixed(1)}%</td>
              <td class="editable-cell">
                ${isEditMode ? 
                  `<input type="number" class="editable-input target-input" value="${targetPercentage.toFixed(1)}" 
                         data-class="${className}" min="0" max="100" step="0.1" style="width:60px;">` :
                  `<span>${targetPercentage.toFixed(1)}%</span>`
                }
              </td>
              <td class="number" style="color:${diffColor};">${diffIcon} ${Math.abs(difference).toFixed(1)}%</td>
              ${isEditMode ? `<td style="text-align:center;">
                ${isCustom ? `<button class="remove-row-btn" data-class="${className}">🗑️</button>` : '-'}
              </td>` : ''}
            </tr>
          `;
        });

        // Total row
        let totalTargetPercentage = 0;
        Object.entries(allocationData).forEach(([className, data]) => {
          totalTargetPercentage += (data.target || 0);
        });
        
        portfolioHTML += `
          <tr id="total-row" style="border-top:2px solid #e5e7eb; background:#f3f4f6; font-weight:600;">
            <td><strong>TOTAL</strong></td>
            <td class="number">${formatCurrency(totalValue)}</td>
            <td class="number">100.0%</td>
            <td id="total-target" class="number">${totalTargetPercentage.toFixed(1)}%</td>
            <td id="total-diff" class="number" style="color:${Math.abs(100 - totalTargetPercentage) <= 1 ? '#6b7280' : '#dc2626'};">
              ${Math.abs(100 - totalTargetPercentage) <= 1 ? '✓' : '⚠️'} ${Math.abs(100 - totalTargetPercentage).toFixed(1)}%
            </td>
            ${isEditMode ? '<td>-</td>' : ''}
          </tr>
        `;

        portfolioHTML += '</tbody></table>';
        $('#distributionContent').innerHTML = portfolioHTML;

        // Add event listeners for real-time updates if in edit mode
        if (isEditMode) {
          const targetInputs = $('#distributionContent').querySelectorAll('.target-input');
          targetInputs.forEach(input => {
            input.addEventListener('input', (e) => {
              const className = e.target.getAttribute('data-class');
              const newValue = e.target.value;
              updateTargetInRealTime(className, newValue);
            });
          });

          const customValueInputs = $('#distributionContent').querySelectorAll('.custom-value-input');
          customValueInputs.forEach(input => {
            input.addEventListener('input', (e) => {
              const className = e.target.getAttribute('data-class');
              const newValue = e.target.value;
              updateCustomValueInRealTime(className, newValue);
            });
          });

          const removeButtons = $('#distributionContent').querySelectorAll('.remove-row-btn');
          removeButtons.forEach(button => {
            button.addEventListener('click', (e) => {
              const className = e.target.getAttribute('data-class');
              removeAllocationRow(className);
            });
          });
        }

        // Update summary
        $('#totalValue').textContent = formatCurrency(totalValue);
        $('#assetsCount').textContent = Object.keys(holdings).length.toString();
        $('#lastUpdate').textContent = new Date().toLocaleTimeString('pt-BR', { 
          hour: '2-digit', 
          minute: '2-digit' 
        });

        console.log(`[${functionName}] Portfolio distribution updated successfully`);

      } catch (error) {
        console.error(`[${functionName}] Critical error:`, error);
        $('#distributionContent').innerHTML = '<div class="loading" style="color:#dc2626;">Erro ao carregar. Tente recarregar a página.</div>';
      }
    }

    // Event listeners
    $('#refreshPortfolio').addEventListener('click', updatePortfolioDistribution);
    $('#addNewRow').addEventListener('click', addNewAllocationRow);
    $('#editTableBtn').addEventListener('click', toggleEditMode);
    $('#saveTableBtn').addEventListener('click', saveTableChanges);

    // Add new allocation row (modified for edit mode)
    window.addNewAllocationRow = async () => {
      if (!isEditMode) {
        alert('Entre no modo de edição primeiro.');
        return;
      }
      
      const className = prompt('Digite o nome da nova classe de ativo:');
      if (!className || !className.trim()) return;
      
      const value = parseFloat(prompt(`Digite o valor atual para ${className.trim()}:`, '0') || '0');
      const target = parseFloat(prompt(`Digite a porcentagem meta para ${className.trim()}:`, '0') || '0');
      
      try {
        if (!tempAllocationData) {
          tempAllocationData = await getAllocationData();
        }
        
        if (tempAllocationData[className.trim()]) {
          alert('Já existe uma classe com este nome.');
          return;
        }
        
        // Add to temporary data first
        tempAllocationData[className.trim()] = {
          value: value,
          target: target,
          isCustom: true
        };
        
        // Save permanently to storage AND update temp data
        await saveAllocationData(tempAllocationData);
        
        // Force immediate regeneration with updated data
        console.log('Forcing table regeneration after adding class:', className.trim());
        console.log('Current tempAllocationData:', tempAllocationData);
        
        // Small delay to ensure storage is updated, then regenerate
        setTimeout(() => {
          updatePortfolioDistribution();
        }, 50);
        
        console.log(`Nova classe adicionada e exibida imediatamente: ${className.trim()}`);
      } catch (error) {
        console.error('Error adding new class:', error);
        alert('Erro ao adicionar nova classe.');
      }
    };

    // Fix incorrect Ações percentage (temporary function)
    async function fixIncorrectTargets() {
      const allocationData = await getAllocationData();
      
      // Fix Ações from 50% to 40%
      if (allocationData['Ações'] && allocationData['Ações'].target === 50) {
        allocationData['Ações'].target = 40;
        await saveAllocationData(allocationData);
        console.log('Fixed Ações target from 50% to 40%');
      }
    }

    // Call fix function when initializing
    fixIncorrectTargets();

    // Toggle edit mode
    function toggleEditMode() {
      isEditMode = true;
      tempAllocationData = null; // Will be initialized in updatePortfolioDistribution
      
      // Update button visibility
      $('#editTableBtn').style.display = 'none';
      $('#saveTableBtn').style.display = 'inline-block';
      $('#addNewRow').style.display = 'inline-block';
      
      // Regenerate table in edit mode
      updatePortfolioDistribution();
    }

    // Save table changes
    async function saveTableChanges() {
      try {
        // Get fresh data from storage to preserve any add/delete operations that were already saved
        const freshStorageData = await getAllocationData();
        console.log('Fresh storage data (includes add/delete):', freshStorageData);
        
        // Update only the target percentages from the form inputs
        const targetInputs = document.querySelectorAll('.target-input');
        console.log('Found target inputs:', targetInputs.length);
        
        targetInputs.forEach(input => {
          const className = input.getAttribute('data-class');
          const value = parseFloat(input.value) || 0;
          console.log(`Updating target for ${className}: ${input.value} -> ${value}`);
          
          // Update in fresh storage data (which includes any add/delete operations)
          if (freshStorageData[className]) {
            freshStorageData[className].target = value;
          }
        });
        
        // Update custom values from form inputs
        const customValueInputs = document.querySelectorAll('.custom-value-input');
        console.log('Found custom value inputs:', customValueInputs.length);
        
        customValueInputs.forEach(input => {
          const className = input.getAttribute('data-class');
          const value = parseFloat(input.value) || 0;
          console.log(`Updating custom value for ${className}: ${input.value} -> ${value}`);
          
          if (freshStorageData[className]) {
            freshStorageData[className].value = value;
          }
        });
        
        console.log('Final data before saving (preserves add/delete operations):', freshStorageData);
        
        // Save the combined data to permanent storage
        await saveAllocationData(freshStorageData);
        
        // Exit edit mode
        isEditMode = false;
        tempAllocationData = null;
        
        // Update button visibility
        $('#editTableBtn').style.display = 'inline-block';
        $('#saveTableBtn').style.display = 'none';
        $('#addNewRow').style.display = 'none';
        
        // Regenerate table in view mode
        updatePortfolioDistribution();
        
        console.log('Table changes saved successfully');
        
      } catch (error) {
        console.error('Error saving table changes:', error);
        alert('Erro ao salvar alterações. Tente novamente.');
      }
    }

    // Update custom value
    window.updateCustomValue = async (className, newValue) => {
      const value = parseFloat(newValue) || 0;
      const allocationData = await getAllocationData();
      
      if (allocationData[className] && allocationData[className].isCustom) {
        allocationData[className].value = value;
        await saveAllocationData(allocationData);
        console.log(`Custom value updated for ${className}: ${formatCurrency(value)}`);
        updatePortfolioDistribution();
      }
    };

    // Add new custom class
    async function addNewCustomClass(className, value, target) {
      try {
        const allocationData = await getAllocationData();
        allocationData[className] = {
          value: value,
          target: target,
          isCustom: true
        };
        
        await saveAllocationData(allocationData);
        updatePortfolioDistribution();
        console.log(`Custom class added: ${className} - ${formatCurrency(value)} (${target}%)`);
      } catch (error) {
        console.error('Error adding custom class:', error);
      }
    }

    // Initial load
    setTimeout(updatePortfolioDistribution, 1000);
  }

  // Floating Shadow DOM panel: Rebalance dates manager
  // Idempotent and robust to SPA rerenders
  function initRebalancePanel() {
    const HOST_ID = 'rebalance-panel-host';
    if (document.getElementById(HOST_ID)) return; // prevent duplicates
  
    const host = document.createElement('div');
    host.id = HOST_ID;
    
    // Try to insert after portfolio distribution panel, fallback to original position
    const portfolioHost = document.getElementById('portfolio-distribution-host');
    if (portfolioHost && portfolioHost.parentElement) {
      portfolioHost.insertAdjacentElement('afterend', host);
    } else {
      const anchor = document.getElementById('cashposition-result');
      if (anchor && anchor.parentElement) anchor.insertAdjacentElement('afterend', host);
      else document.body.appendChild(host);
    }
  
    const root = host.attachShadow({ mode: 'open' });
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <style>
        :host { all: initial; display: block; width: 100%; }
        .card { width: 100%; background: #fff; color: #1f2937; border: 1px solid #e5e7eb; border-radius: 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; margin: 12px 0; }      
        .header { display:flex; align-items:center; justify-content:space-between; padding: 10px 12px; border-bottom: 1px solid #f3f4f6; background:#03ab95; color: white; border-top-left-radius:10px; border-top-right-radius:10px; }
        .title { font-weight: 700; font-size: 14px; margin: 0; color: white; }
        .body { padding: 10px 12px; }
        .row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:8px; }
        label { font-size: 12px; color:#374151; margin-bottom: 4px; display: block; }
        input[type="date"], input[type="text"], select { padding:6px 8px; border:1px solid #e5e7eb; border-radius:6px; font-size:12px; background:#fff; box-sizing: border-box; width: 100%; }
        button { padding:6px 10px; border:1px solid #d1d5db; background:#03ab95; color:#fff; border-radius:6px; font-size:12px; cursor:pointer; }
        button.secondary { background:#e6f7f5; color:#028a7a; border-color:#beebe4; }
        button.danger { background:#fee2e2; color:#991b1b; border-color:#fecaca; }
        .table-wrap { max-height: 260px; overflow:auto; border-top:1px solid #f3f4f6; margin-top:8px; }
        table { width:100%; border-collapse:collapse; font-size:12px; }
        thead th { position: sticky; top: 0; background:#e6f7f5; z-index:1; text-align:left; padding:6px 8px; border-bottom:1px solid #beebe4; font-weight: 600; color: #028a7a; }
        thead th.num { text-align: right; }
        tbody td { padding:6px 8px; border-bottom:1px solid #f3f4f6; vertical-align:middle; }
        .status-late { color:#c62828; font-weight:700; }
        .status-today { color:#03ab95; font-weight:700; }
        .status-soon { color:#92400e; }
        .banner { background:#fff7ed; color:#7c2d12; border:1px solid #fed7aa; border-radius:6px; padding:6px 8px; margin: 6px 0 8px 0; display:none; }
        .actions { display:flex; gap:6px; }
        .muted { color:#6b7280; }      
        .num { text-align: right; }
        .status-profit { color: #03ab95; font-weight: 700; }
        .status-loss { color: #c62828; font-weight: 700; }
        /* Late highlighting: whole row/cells in red background */
        .row-late td { background:#ffebee; }
        .row-late td.next, .row-late td.status { color:#c62828; font-weight:700; }
      </style>
      <div class="card" part="card">
        <div class="header"><h3 class="title">Quando foi o último rebalanceamento?</h3></div>
        <div class="body">
          <div class="row">
            <div style="flex: 1;">
              <label for="lastRebDate">Último rebalance</label>
              <input type="date" id="lastRebDate" />
            </div>
            <div style="flex: 0.5;">
              <label for="rebalanceInterval">Intervalo (meses)</label>
              <select id="rebalanceInterval">
                <option value="3">3</option>
                <option value="6">6</option>
                <option value="9">9</option>
                <option value="12">12</option>
              </select>
            </div>
            <div style="display:flex; align-items:flex-end; flex: 0.5;">
              <button id="addBtn">Adicionar</button>
            </div>
          </div>
          <div class="row" style="margin-top: 12px; align-items: flex-start;">
            <div style="flex:1;">
              <label for="currentPosition">Posição atual em ações</label>
              <input type="text" id="currentPosition" placeholder="R$ 0,00" />
            </div>
            <div style="flex:1;">
              <label for="investedPosition">Posição investida</label>
              <input type="text" id="investedPosition" placeholder="R$ 0,00" />
            </div>
            <div style="flex:1;">
              <label>Lucro/Prejuízo (%)</label>
              <div id="profitLoss" style="padding: 7px 8px; font-weight: bold; font-size: 12px; border: 1px solid transparent; border-radius: 6px;">-</div>
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
                  <th class="num">Pos. Atual</th>
                  <th class="num">Pos. Investida</th>
                  <th class="num">Lucro/Prej. (%)</th>
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
  
    const inputCurrentPos = $('#currentPosition');
    const inputInvestedPos = $('#investedPosition');
    const profitLossDisplay = $('#profitLoss');
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
    function parseISODateAsLocal(isoDateString) {
        if (!isoDateString) return new Date(NaN);
        // "YYYY-MM-DD" -> cria data à meia-noite local, evitando desvios de fuso horário.
        const parts = isoDateString.split('-').map(Number);
        return new Date(parts[0], parts[1] - 1, parts[2]);
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
    function nextRebalance(dateISO) { return addMonthsSafe(parseISODateAsLocal(dateISO), intervalMonths); }
    function computeStatus(next, current) {
      const dd = diffDays(startOfDayLocal(current), startOfDayLocal(next));
      if (dd === 0) return { text: 'Hoje!', cls: 'status-today', late: false, soon: true };
      if (dd < 0) return { text: `Atrasado ${Math.abs(dd)} dias`, cls: 'status-late', late: true, soon: false };
      return { text: `Faltam ${dd} dias`, cls: dd <= 10 ? 'status-soon' : '', late: false, soon: dd <= 10 };
    }
    function renderList(currentDate) {
      loadDates().then((arr) => {
        // Ordena a lista para que o item adicionado mais recentemente (maior ID) apareça primeiro.
        arr.sort((a, b) => (b.id || 0) - (a.id || 0));

        listBody.innerHTML = '';
        // Para o banner, encontre o item com a data de rebalanceamento mais recente
        if (arr.length) {
          // Cria uma cópia rasa para ordenar para a lógica do banner sem afetar a matriz principal
          const latestRebalanceItem = [...arr].sort((a, b) => new Date(b.dateISO) - new Date(a.dateISO))[0];
          if (latestRebalanceItem) {
            const next = nextRebalance(latestRebalanceItem.dateISO);
            const dd = diffDays(startOfDayLocal(new Date()), next);
            banner.style.display = dd > 0 && dd <= 10 ? 'block' : (dd === 0 ? 'block' : 'none');
            banner.textContent = dd === 0 ? 'Hoje! Dia do próximo rebalanceamento' : '⚠️ Está chegando a data do próximo rebalanceamento';
          }
        } else { banner.style.display = 'none'; }

        arr.forEach((item) => {
          const orig = parseISODateAsLocal(item.dateISO);
          const next = nextRebalance(item.dateISO);
          const { text, cls, late } = computeStatus(next, currentDate);
          
          const currentPos = item.currentPosition;
          const investedPos = item.investedPosition;
          let profitLoss = NaN;
          if (Number.isFinite(currentPos) && Number.isFinite(investedPos) && investedPos > 0) {
              profitLoss = ((currentPos / investedPos) - 1) * 100;
          }
          const profitLossText = Number.isFinite(profitLoss) ? `${profitLoss.toFixed(2)}%` : '-';
          const profitLossClass = Number.isFinite(profitLoss) ? (profitLoss >= 0 ? 'status-profit' : 'status-loss') : '';
  
          const tr = document.createElement('tr');
          tr.dataset.id = String(item.id);
          tr.innerHTML = `
            <td class="orig">${fmtDateBR(orig)}</td>
            <td class="next">${fmtDateBR(next)}</td>
            <td class="status ${cls}">${text}</td>
            <td class="num current-pos">${Number.isFinite(currentPos) ? fmtBRL(currentPos) : '-'}</td>
            <td class="num invested-pos">${Number.isFinite(investedPos) ? fmtBRL(investedPos) : '-'}</td>
            <td class="num profit-loss ${profitLossClass}">${profitLossText}</td>
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
  
    function updateProfitLoss() {
        const currentVal = parseMoneyBR(inputCurrentPos.value);
        const investedVal = parseMoneyBR(inputInvestedPos.value);
        if (Number.isFinite(currentVal) && Number.isFinite(investedVal) && investedVal > 0) {
            const perc = ((currentVal / investedVal) - 1) * 100;
            profitLossDisplay.textContent = `${perc.toFixed(2)}%`;
            profitLossDisplay.style.color = perc >= 0 ? '#03ab95' : '#c62828';
        } else {
            profitLossDisplay.textContent = '-';
            profitLossDisplay.style.color = '#6b7280';
        }
    }
  
    inputCurrentPos.addEventListener('input', updateProfitLoss);
    inputInvestedPos.addEventListener('input', updateProfitLoss);
    inputCurrentPos.addEventListener('change', (e) => {
        const n = parseMoneyBR(e.target.value);
        if (Number.isFinite(n)) e.target.value = fmtBRL(n); else e.target.value = '';
    });
    inputInvestedPos.addEventListener('change', (e) => {
        const n = parseMoneyBR(e.target.value);
        if (Number.isFinite(n)) e.target.value = fmtBRL(n); else e.target.value = '';
    });
  
    // Auto-fill on init
    const detectedStocksTotal = getStocksPortfolioTotal();
    const detectedProfitLoss = getStocksProfitLossBRL();
    let calculatedCostBasis = NaN;

    if (Number.isFinite(detectedStocksTotal) && Number.isFinite(detectedProfitLoss)) {
      calculatedCostBasis = detectedStocksTotal - detectedProfitLoss;
    }
    
    // Fallback to summing rows if DOM scraping fails
    const finalCostBasis = Number.isFinite(calculatedCostBasis) ? calculatedCostBasis : getPortfolioCostBasis();

    if (Number.isFinite(detectedStocksTotal) && detectedStocksTotal > 0) inputCurrentPos.value = fmtBRL(detectedStocksTotal);
    if (Number.isFinite(finalCostBasis) && finalCostBasis > 0) inputInvestedPos.value = fmtBRL(finalCostBasis);
    updateProfitLoss();
  
  
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
      
      const currentPosition = parseMoneyBR(inputCurrentPos.value);
      const investedPosition = parseMoneyBR(inputInvestedPos.value);
  
      const list = await loadDates();
      // Adiciona no início da lista para que o mais recente apareça primeiro
      list.unshift({ id: Date.now(), dateISO: v, createdAtISO: new Date().toISOString(),
        currentPosition: Number.isFinite(currentPosition) ? currentPosition : null,
        investedPosition: Number.isFinite(investedPosition) ? investedPosition : null,
      });
      await saveDates(list);
      // Reset date to today for next entry
      inputLast.value = toLocalDateInputValue(new Date());
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
        const item = list[idx];
  
        const tdOrig = tr.querySelector('td.orig');
        const tdCurrentPos = tr.querySelector('td.current-pos');
        const tdInvestedPos = tr.querySelector('td.invested-pos');
        const tdActions = tr.querySelector('td.actions');
  
        const createInput = (type, value) => {
          const input = document.createElement('input');
          input.type = type;
          input.value = value;
          Object.assign(input.style, { padding: '4px 6px', border: '1px solid #e5e7eb', borderRadius: '6px', width: '100%', boxSizing: 'border-box' });
          return input;
        };
  
        const editInputDate = createInput('date', item.dateISO);
        const editInputCurrent = createInput('text', Number.isFinite(item.currentPosition) ? fmtBRL(item.currentPosition) : '');
        const editInputInvested = createInput('text', Number.isFinite(item.investedPosition) ? fmtBRL(item.investedPosition) : '');
  
        tdOrig.innerHTML = '';
        tdOrig.appendChild(editInputDate);
        tdCurrentPos.innerHTML = '';
        tdCurrentPos.appendChild(editInputCurrent);
        tdInvestedPos.innerHTML = '';
        tdInvestedPos.appendChild(editInputInvested);
  
        tdActions.innerHTML = '';
        const saveBtn = document.createElement('button'); saveBtn.textContent = 'Salvar'; saveBtn.className = 'secondary';
        const cancelBtn = document.createElement('button'); cancelBtn.textContent = 'Cancelar'; cancelBtn.className = 'danger';
        tdActions.appendChild(saveBtn); tdActions.appendChild(cancelBtn);
        
        saveBtn.addEventListener('click', async () => {
          const newDate = editInputDate.value;
          if (!newDate) { alert('Selecione uma data válida.'); return; }
          const newCurrent = parseMoneyBR(editInputCurrent.value);
          const newInvested = parseMoneyBR(editInputInvested.value);
          list[idx].dateISO = newDate;
          list[idx].currentPosition = Number.isFinite(newCurrent) ? newCurrent : null;
          list[idx].investedPosition = Number.isFinite(newInvested) ? newInvested : null;
          await saveDates(list);
          refresh();
        });
        cancelBtn.addEventListener('click', () => { refresh(); });
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
        .header { display:flex; align-items:center; justify-content:space-between; padding:10px 12px; border-bottom:1px solid #f3f4f6; background:#03ab95; color: white; border-top-left-radius:10px; border-top-right-radius:10px; }
        .title { font-weight:700; font-size:14px; margin:0; color: white; }
        .controls { display:flex; flex-direction: column; gap:8px; align-items:flex-end; }
        .controls-row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; justify-content: flex-end; }
        .toggle-btn { padding:6px 10px; border:1px solid #beebe4; background:#e6f7f5; color:#028a7a; border-radius:6px; font-size:12px; cursor:pointer; }
        select, input[type="text"] { padding:6px 8px; border:1px solid #e5e7eb; border-radius:6px; font-size:12px; background:#fff; }
        .body { padding:10px 12px; }
        .table-wrap { max-height:420px; overflow:auto; border-top:1px solid #f3f4f6; margin-top:8px; }
        table { width:100%; border-collapse:collapse; font-size:12px; }
        thead th { position:sticky; top:0; background:#e6f7f5; z-index:1; text-align:left; padding:6px 8px; border-bottom:1px solid #beebe4; font-weight: 600; color: #028a7a; }
        tbody td { padding:6px 8px; border-bottom:1px solid #f3f4f6; vertical-align:middle; }
        .num { text-align:right; }
        .muted { color:#6b7280; }
        /* Highlight rows for tickers already in the portfolio */
        .header.sell-header { background-color: #03ab95; }
        tr.row-holding td { background:#e6f7f5; }
        tr.row-holding td:nth-child(2) { color:#03ab95; font-weight:700; }
        tr.row-sell-selected { background-color: #03ab95; color: white; }
        tr.row-sell-selected .muted { color: #f0fdfa; }
        .table-wrap.no-scroll { max-height: none; overflow: visible; }
        .mode { display:flex; align-items:center; gap:6px; }
        .mode label { display:flex; align-items:center; gap:4px; cursor:pointer; }
      </style>
      <div class="card">
        <div class="header">
          <h3 class="title">Plano de Rebalanceamento (Equal-Weight)</h3>
          <div class="controls">
            <div class="controls-row">
              <label>Fonte
                <select id="ewSource">
                  <option value="fm" selected>Fórmula Mágica</option>
                  <option value="fm_inv10">FM + Inv10</option>
                  <option value="magic_inv10+sum">FM + Inv10 (Soma)</option>
                </select>
              </label>
              <label>Top
                <select id="ewN">
                  <option value="5">5</option>
                  <option value="10" selected>10</option>
                  <option value="15">15</option>
                  <option value="20">20</option>
                  <option value="30">30</option>
                </select>
              </label>
              <label>Total (R$)
                <input type="text" id="ewTotal" size="12"/>
              </label>
              <span class="mode">
                <label title="Compra com base no orçamento, sem vender posições."><input type="radio" name="ewMode" value="investir" checked /> Investir</label>
                <label title="Ajusta quantidades para chegar ao alvo por ativo; só considera compras adicionais."><input type="radio" name="ewMode" value="rebalancear" /> Rebalancear</label>
              </span>
            </div>
            <div class="controls-row">
              <span id="ewAutoRefreshStatus" style="color: white; font-size: 11px; font-style: italic; margin-right: auto;"></span>
              <button id="ewAutoRefresh" class="toggle-btn" type="button" title="Verificar automaticamente a cada 5 minutos se os preços das ações foram atualizados.">Iniciar Verificação</button>
              <button id="ewUpdateMyStocks" class="toggle-btn" type="button" title="Exibe todos os ativos e salva a lista da sua carteira para uso nos cálculos.">Atualizar Minhas Ações</button>
              <button id="ewExportCsv" class="toggle-btn" type="button" title="Baixar tabela em CSV.">Exportar CSV</button>
              <button id="ewToggle" class="toggle-btn" type="button">Ocultar</button>
            </div>
          </div>
        </div>
        <div id="ewRefreshAlert" style="display:none; position:fixed; bottom:20px; right:20px; z-index:10000; background:white; border:1px solid #e5e7eb; border-radius:10px; box-shadow:0 4px 12px rgba(0,0,0,.15); width:300px; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;">
          <div style="padding:10px 12px; background:#03ab95; color:white; border-top-left-radius:10px; border-top-right-radius:10px; font-weight:700; font-size:14px; display:flex; justify-content:space-between; align-items:center;">
            <span>Verificando Preços</span>
            <div style="display:flex; align-items:center; gap:8px;">
              <span id="ewRefreshCount" style="font-size:12px; font-style:italic;"></span>
              <button id="ewClearLogBtn" title="Limpar histórico de alterações de preços" style="background:transparent; border:1px solid #beebe4; color:white; border-radius:4px; font-size:10px; cursor:pointer; padding: 2px 5px; line-height:1;">Limpar</button>
            </div>
          </div>
          <div style="padding:12px;">
            <div id="ewRefreshCountdown" style="font-size:13px; margin-bottom:10px; color:#374151;"></div>
            <div id="ewRefreshStockList" style="max-height:200px; overflow-y:auto; font-size:12px;">
              <!-- Stock list will be populated here -->
            </div>
            <div id="ewRefreshChangeLog" style="margin-top:10px; border-top: 1px solid #e5e7eb; padding-top:10px; font-size:12px; display:none;">
              <!-- Change log will be populated here -->
            </div>
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
                  <th class="num">Preço Médio</th>
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
        <div class="header sell-header" id="ewSellHeader" style="margin-top: 16px; display: none;">
          <h3 class="title">Plano de Venda (Ativos Fora do Top N)</h3>
          <div class="controls">
            <div class="controls-row">
              <label style="color:white; font-size:12px; display:flex; align-items:center; gap:4px; cursor:pointer;"><input type="checkbox" id="ewSellShowCurrency"> Mostrar R$</label>
              <button id="ewSellExportCsv" class="toggle-btn" type="button" title="Baixar lista em CSV.">Exportar CSV</button>
              <button id="ewSellToggle" class="toggle-btn" type="button">Ocultar</button>
            </div>
          </div>
        </div>
        <div class="body" id="ewSellBodyWrap" style="display: none;">
            <div class="table-wrap no-scroll">
                <table>
                    <thead>
                        <tr>
                            <th>Ticker</th>
                            <th class="num">Qtd atual</th>
                            <th class="num">Preço</th>
                            <th class="num">Valor total</th>
                            <th class="num" style="text-align:center; width:50px;"><input type="checkbox" id="ewSellSelectAll" title="Selecionar Todos"></th>
                        </tr>
                    </thead>
                    <tbody id="ewSellBody"></tbody>
                </table>
            </div>
        </div>
      </div>
    `;
    root.appendChild(wrap);
  
    const $ = (sel) => root.querySelector(sel);
    const ewN = $('#ewN');
    const ewSource = $('#ewSource');
    const ewTotal = $('#ewTotal');
    const ewBody = $('#ewBody');
    const ewBodyWrap = $('#ewBodyWrap');
    const ewToggle = $('#ewToggle');
    const ewUpdateMyStocks = $('#ewUpdateMyStocks');
    const ewExportCsv = $('#ewExportCsv');
    const ewAutoRefresh = $('#ewAutoRefresh');
    const ewAutoRefreshStatus = $('#ewAutoRefreshStatus');
    const ewRefreshAlert = $('#ewRefreshAlert');
    const ewRefreshCountdown = $('#ewRefreshCountdown');
    const ewRefreshStockList = $('#ewRefreshStockList');
    const ewRefreshChangeLog = $('#ewRefreshChangeLog');
    const ewRefreshCount = $('#ewRefreshCount');
    const ewClearLogBtn = $('#ewClearLogBtn');

    const ewSellHeader = $('#ewSellHeader');
    const ewSellBodyWrap = $('#ewSellBodyWrap');
    const ewSellToggle = $('#ewSellToggle');
    const ewSellExportCsv = $('#ewSellExportCsv');
    const ewSellShowCurrency = $('#ewSellShowCurrency');

    const ewModeInputs = root.querySelectorAll('input[name="ewMode"]');
    let ewMode = 'investir';
    let ewSourceValue = 'fm';
    const MODE_KEY = 'ew_mode';
    const SOURCE_KEY = 'ew_source';
    function loadMode() { return new Promise((resolve) => { try { chrome.storage.sync.get([MODE_KEY], (r) => resolve(r?.[MODE_KEY] || 'investir')); } catch { resolve('investir'); } }); }
    function saveMode(v) { return new Promise((resolve) => { try { chrome.storage.sync.set({ [MODE_KEY]: v }, () => resolve()); } catch { resolve(); } }); }
    function loadSource() { return new Promise((resolve) => { try { chrome.storage.sync.get([SOURCE_KEY], (r) => resolve(r?.[SOURCE_KEY] || 'fm')); } catch { resolve('fm'); } }); }
    function saveSource(v) { return new Promise((resolve) => { try { chrome.storage.sync.set({ [SOURCE_KEY]: v }, () => resolve()); } catch { resolve(); } }); }

    const SELL_CURRENCY_KEY = 'ew_sell_plan_show_currency';
    function loadSellCurrency() { return new Promise((resolve) => { try { chrome.storage.sync.get([SELL_CURRENCY_KEY], (r) => resolve(Boolean(r?.[SELL_CURRENCY_KEY]))); } catch { resolve(false); } }); }
    function saveSellCurrency(v) { return new Promise((resolve) => { try { chrome.storage.sync.set({ [SELL_CURRENCY_KEY]: Boolean(v) }, () => resolve()); } catch { resolve(); } }); }
    
    if (ewClearLogBtn) {
      ewClearLogBtn.addEventListener('click', async () => {
        if (confirm('Tem certeza que deseja limpar o histórico de alterações de preços?')) {
          await new Promise(resolve => chrome.storage.local.set({ [PRICE_CHANGE_LOG_KEY]: [] }, resolve));
          ewRefreshChangeLog.innerHTML = '';
          ewRefreshChangeLog.style.display = 'none';
        }
      });
    }

    // Utils are now global
  
    // --- Auto-refresh price checker logic ---
    const REFRESH_KEY = 'ew_auto_refresh_running';
    const REFRESH_COUNT_KEY = 'ew_auto_refresh_count';
    const PRICE_CHANGE_LOG_KEY = 'ew_price_change_log';
    const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
    let refreshTimeoutId = null;
    let countdownIntervalId = null;
    // Use window.sessionStorage as chrome.storage.session is not available in content scripts.
    const sessionGet = (keys) => new Promise(resolve => {
      const result = {};
      if (Array.isArray(keys)) {
        keys.forEach(key => {
          const value = sessionStorage.getItem(key);
          if (value !== null) {
            try { result[key] = JSON.parse(value); } catch { result[key] = value; }
          }
        });
      }
      resolve(result);
    });
    const sessionSet = (obj) => new Promise(resolve => {
      if (typeof obj === 'object' && obj !== null) {
        for (const key in obj) {
          if (Object.hasOwnProperty.call(obj, key)) {
            sessionStorage.setItem(key, JSON.stringify(obj[key]));
          }
        }
      }
      resolve();
    });
    const localGet = (keys) => new Promise((resolve, reject) => {
      try {
        chrome.storage.local.get(keys, (result) => {
          if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
          resolve(result);
        });
      } catch (e) { reject(e); }
    });

    async function handleAutoRefresh() {
      if (refreshTimeoutId) clearTimeout(refreshTimeoutId);
      if (countdownIntervalId) clearInterval(countdownIntervalId);

      const { [REFRESH_KEY]: isRunning, [REFRESH_COUNT_KEY]: currentCount } = await sessionGet([REFRESH_KEY, REFRESH_COUNT_KEY]);

      if (!isRunning) {
        ewRefreshAlert.style.display = 'none';
        ewAutoRefresh.textContent = 'Iniciar Verificação';
        ewAutoRefreshStatus.textContent = '';
        ewRefreshCount.textContent = '';
        ewAutoRefresh.disabled = false;
        return;
      }

      // It is running, so increment and display count.
      // The count is initialized to 0 when starting, so the first refresh will be #1.
      const newCount = (Number(currentCount) || 0) + 1;
      await sessionSet({ [REFRESH_COUNT_KEY]: newCount });
      ewRefreshCount.textContent = `Atualização #${newCount}`;

      ewAutoRefresh.textContent = 'Parar Verificação';
      ewAutoRefreshStatus.textContent = 'Aguardando tabela...';
      ewAutoRefresh.disabled = false;

      await new Promise(resolve => {
        let tries = 0;
        const iv = setInterval(() => {
          if (findBodyRows().length > 0 || ++tries > 20) {
            clearInterval(iv);
            resolve();
          }
        }, 500);
      });

      ewAutoRefreshStatus.textContent = 'Verificando preços...';

      const { my_portfolio_holdings: cachedHoldings } = await localGet(['my_portfolio_holdings']);
      
      if (!cachedHoldings || Object.keys(cachedHoldings).length === 0) {
        ewAutoRefreshStatus.textContent = 'Cache vazio. Atualize.';
        await sessionSet({ [REFRESH_KEY]: false });
        ewRefreshAlert.style.display = 'none';
        ewAutoRefresh.textContent = 'Iniciar Verificação';
        return;
      }

      const pageHoldings = readHoldingsFromPage(document);
      const changes = [];

      for (const ticker in cachedHoldings) {
        if (pageHoldings[ticker]) {
          const cachedPrice = cachedHoldings[ticker].price;
          const pagePrice = pageHoldings[ticker].price;

          if (Number.isFinite(cachedPrice) && Number.isFinite(pagePrice) && Math.abs(cachedPrice - pagePrice) > 0.001) {
            changes.push({
              ticker,
              oldPrice: cachedPrice,
              newPrice: pagePrice,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }

      if (changes.length > 0) {
        // Changes detected. Log them, update cache, and continue the loop.
        ewAutoRefreshStatus.textContent = 'Preços atualizados!';

        // Update and show the floating panel
        ewRefreshAlert.style.display = 'block';
        ewRefreshCountdown.textContent = 'Preços alterados detectados! Continuando...';
        ewRefreshCountdown.style.fontWeight = 'bold';
        ewRefreshCountdown.style.color = '#03ab95';

        // --- NEW: Persistent Price Change Log ---
        const { [PRICE_CHANGE_LOG_KEY]: existingLog = [] } = await localGet([PRICE_CHANGE_LOG_KEY]);
        const newLogEntry = {
          timestamp: new Date().toISOString(),
          changes: changes.map(c => ({ ticker: c.ticker, oldPrice: c.oldPrice, newPrice: c.newPrice })),
        };
        const newLog = [newLogEntry, ...existingLog].slice(0, 50); // Keep last 50 entries
        await new Promise(resolve => chrome.storage.local.set({ [PRICE_CHANGE_LOG_KEY]: newLog }, resolve));

        // Build and display the change log from the full history
        const logHTML = `
          <div style="font-weight:bold; margin-bottom:5px;">Histórico de Alterações de Preços:</div>
          ${newLog.map(entry => `
            <div style="border-bottom: 1px solid #f3f4f6; padding-bottom: 5px; margin-bottom: 5px;">
              <div style="font-size:11px; color:#6b7280; font-weight:bold; margin-bottom:4px;">
                ${new Date(entry.timestamp).toLocaleString('pt-BR')}
              </div>
              <table style="width:100%; font-size:12px; border-collapse:collapse;">
                <thead>
                  <tr>
                    <th style="padding:2px; border-bottom:1px solid #e5e7eb; text-align:left;">Ativo</th>
                    <th style="padding:2px; border-bottom:1px solid #e5e7eb; text-align:right;">Preço Antigo</th>
                    <th style="padding:2px; border-bottom:1px solid #e5e7eb; text-align:right;">Preço Novo</th>
                  </tr>
                </thead>
                <tbody>
                  ${entry.changes.map(change => `
                    <tr>
                      <td style="padding:2px;">${change.ticker}</td>
                      <td style="padding:2px; text-align:right;">${fmtBRL(change.oldPrice)}</td>
                      <td style="padding:2px; text-align:right; font-weight:bold; color:#03ab95;">${fmtBRL(change.newPrice)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `).join('')}
        `;
        ewRefreshChangeLog.innerHTML = logHTML;
        ewRefreshChangeLog.style.display = 'block';

        ewUpdateMyStocks.click(); // Atualiza o cache com os novos preços

        // Schedule the next check instead of stopping
        const nextCheck = new Date(Date.now() + REFRESH_INTERVAL_MS);
        ewAutoRefreshStatus.textContent = `Preços atualizados! Próxima verificação às ${nextCheck.toLocaleTimeString('pt-BR')}`;
        refreshTimeoutId = setTimeout(() => location.reload(), REFRESH_INTERVAL_MS);
        if (countdownIntervalId) clearInterval(countdownIntervalId);
        countdownIntervalId = setInterval(() => {
          const remaining = Math.max(0, nextCheck.getTime() - Date.now());
          const minutes = String(Math.floor(remaining / 60000)).padStart(2, '0');
          const seconds = String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0');
          ewRefreshCountdown.textContent = `Próxima atualização em: ${minutes}:${seconds}`;
          // After the first second, reset the style to normal for the countdown
          ewRefreshCountdown.style.fontWeight = 'normal';
          ewRefreshCountdown.style.color = '#374151';
        }, 1000);
      } else {
        ewRefreshAlert.style.display = 'block';
        ewRefreshStockList.innerHTML = `
          <table style="width:100%; font-size:12px; border-collapse:collapse;">
            <thead style="text-align:left;">
              <tr>
                <th style="padding:4px; border-bottom:1px solid #e5e7eb;">Ativo</th>
                <th style="padding:4px; border-bottom:1px solid #e5e7eb; text-align:right;">Preço em Cache</th>
                <th style="padding:4px; border-bottom:1px solid #e5e7eb; text-align:right;">Preço Atual</th>
              </tr>
            </thead>
            <tbody>
              ${Object.entries(cachedHoldings).map(([ticker, data]) => {
                const currentPageHolding = pageHoldings[ticker];
                const currentPrice = currentPageHolding ? currentPageHolding.price : NaN;
                return `
                  <tr>
                    <td style="padding:4px;">${ticker}</td>
                    <td style="padding:4px; text-align:right;">${fmtBRL(data.price)}</td>
                    <td style="padding:4px; text-align:right;">${Number.isFinite(currentPrice) ? fmtBRL(currentPrice) : '-'}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        `;
        const nextCheck = new Date(Date.now() + REFRESH_INTERVAL_MS);
        ewAutoRefreshStatus.textContent = `Próxima verificação às ${nextCheck.toLocaleTimeString('pt-BR')}`;
        refreshTimeoutId = setTimeout(() => location.reload(), REFRESH_INTERVAL_MS);
        countdownIntervalId = setInterval(() => {
          const remaining = Math.max(0, nextCheck.getTime() - Date.now());
          const minutes = String(Math.floor(remaining / 60000)).padStart(2, '0');
          const seconds = String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0');
          ewRefreshCountdown.textContent = `Próxima atualização em: ${minutes}:${seconds}`;
        }, 1000);
      }
    }

    ewAutoRefresh.addEventListener('click', async () => {
      ewAutoRefresh.disabled = true;
      const { [REFRESH_KEY]: isRunning } = await sessionGet([REFRESH_KEY]);
      if (isRunning) {
        if (refreshTimeoutId) clearTimeout(refreshTimeoutId);
        if (countdownIntervalId) clearInterval(countdownIntervalId);
        await sessionSet({ [REFRESH_KEY]: false });
        handleAutoRefresh(); // Update UI to stopped state
      } else {
        // Reset UI from previous run before starting a new one
        ewRefreshAlert.style.display = 'none';
        ewRefreshChangeLog.style.display = 'none';
        ewRefreshChangeLog.innerHTML = '';
        ewRefreshCountdown.style.fontWeight = 'normal';
        ewRefreshCountdown.style.color = '#374151';
        ewRefreshCount.textContent = '';

        const { my_portfolio_holdings: cachedHoldings } = await localGet(['my_portfolio_holdings']);
        if (!cachedHoldings || Object.keys(cachedHoldings).length === 0) {
          alert('Para iniciar a verificação, primeiro clique em "Atualizar Minhas Ações" para criar um cache dos preços atuais.');
          ewAutoRefresh.disabled = false;
          return;
        }
        await sessionSet({ [REFRESH_KEY]: true, [REFRESH_COUNT_KEY]: 0 });
        location.reload();
      }
    });

    function csvEscape(value) {
      if (value == null) return '';
      const str = String(value).replace(/\r?\n/g, ' ').trim();
      if (/[";\r\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
      return str;
    }

    function cellTextForCsv(cell) {
      if (!cell) return '';
      const checkbox = cell.querySelector('input[type="checkbox"]');
      if (checkbox) return checkbox.checked ? 'Sim' : 'Nao';
      return (cell.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function serializeTableToCsv(table) {
      if (!table) return '';
      const lines = [];
      const sections = [];
      if (table.tHead) sections.push(table.tHead);
      if (table.tBodies) sections.push(...Array.from(table.tBodies));
      if (table.tFoot) sections.push(table.tFoot);
      sections.forEach((section) => {
        if (!section) return;
        Array.from(section.rows).forEach((row) => {
          const cells = Array.from(row.cells).map((cell) => csvEscape(cellTextForCsv(cell)));
          lines.push(cells.join(';'));
        });
      });
      return lines.join('\n');
    }

    function downloadCsv(content, filename) {
      if (!content) return;
      const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function timestampSuffix() {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      return now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
    }

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
  
    function fetchTopNFromAPI(cb) {
      const source = ewSource.value || 'fm';
      chrome.runtime.sendMessage({ type: 'GET_TOPN_CHECKLIST', source }, (resp) => {
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
      const totalFromInput = parseMoneyBR(ewTotal.value);
  
      chrome.storage.local.get(['my_portfolio_holdings'], (result) => {
        const holdings = result.my_portfolio_holdings;
  
        if (!holdings || typeof holdings !== 'object' || Object.keys(holdings).length === 0) {
          ewBody.innerHTML = `
            <tr>
              <td colspan="11" style="text-align: center; padding: 20px; color: #6b7280; font-style: italic;">
                Sua carteira ainda não foi carregada. Por favor, clique no botão "Atualizar Minhas Ações" para fazer a leitura inicial.
              </td>
            </tr>
          `;
          return;
        }
  
        fetchTopNFromAPI((err, data) => {
          if (err) {
            ewBody.innerHTML = `<tr><td colspan="11" style="text-align: center; padding: 20px; color: #c62828;">Erro ao buscar dados da API: ${err.message}</td></tr>`;
            return;
          }
          const normalized = normalizeChecklist(data);
          const top = normalized.slice(0, N);
          const topTickers = new Set(top.map(t => t.code));
  
          let targetPer = 0;
          if (ewMode === 'rebalancear') {
            targetPer = Number.isFinite(totalFromInput) && totalFromInput > 0 ? totalFromInput / N : 0;
          } else { // 'investir'
            const investmentAmount = totalFromInput;
            // Consider only the cost basis of assets that are in the Top N list, not the whole portfolio.
            // This makes the 'target per asset' calculation more intuitive for the user.
            const currentPortfolioTotal = Object.entries(holdings)
              .filter(([ticker, _]) => topTickers.has(ticker))
              .reduce((acc, [_, stock]) => {
                if (stock && Number.isFinite(stock.avgPrice) && stock.avgPrice > 0 && Number.isFinite(stock.qty)) {
                  return acc + (stock.avgPrice * stock.qty);
                }
                return acc;
              }, 0);
            const finalPortfolioTotal = currentPortfolioTotal + (Number.isFinite(investmentAmount) ? investmentAmount : 0);
            targetPer = finalPortfolioTotal > 0 ? finalPortfolioTotal / N : 0;
          }
  
          ewBody.innerHTML = '';
          const computed = [];
          top.forEach((it) => {
            const fromCache = holdings[it.code] || { price: NaN, qty: 0, avgPrice: NaN };
            const price = Number.isFinite(it.price) && it.price > 0 ? it.price : fromCache.price;
            const qty = Number.isFinite(fromCache.qty) ? fromCache.qty : 0;
            const avgPrice = fromCache.avgPrice;
            const currentAmount = Number.isFinite(price) && price > 0 && qty > 0 ? price * qty : 0; // Market Value
            const investedAmount = (Number.isFinite(avgPrice) && avgPrice > 0 && qty > 0) ? avgPrice * qty : 0; // Cost Basis
            computed.push({
              rank: it.rank,
              code: it.code,
              price,
              qty,
              avgPrice,
              currentAmount, // For display
              investedAmount, // For calculation
              targetPer,
            });
          });
          
          let budgetCents = Number.isFinite(totalFromInput) && totalFromInput > 0 ? Math.round(totalFromInput * 100) : 0;
          let spendMap = Object.create(null);
          let qtyMap = Object.create(null);
  
          if (ewMode === 'rebalancear') {
            const targetTotalCents = Number.isFinite(totalFromInput) && totalFromInput > 0 ? Math.round(totalFromInput * 100) : 0;
            const sumBaseCents = computed.reduce((acc, row) => acc + (Number.isFinite(row.investedAmount) ? Math.round(row.investedAmount * 100) : 0), 0);
            budgetCents = Math.max(0, targetTotalCents - sumBaseCents);
            const items = computed.map((row) => {
              const priceCents = Number.isFinite(row.price) && row.price > 0 ? Math.round(row.price * 100) : 0;
              const baseCents = Number.isFinite(row.investedAmount) ? Math.round(row.investedAmount * 100) : 0;
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
              for (const it of items) {
                const after = it.baseCents + it.spendCents;
                it.deficitCents = Math.max(0, it.targetCents - after);
              }
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
              best.q += 1;
              best.deltaQty -= 1;
              best.spendCents += best.priceCents;
              budgetCents -= best.priceCents;
            }
  
            spendMap = Object.create(null);
            qtyMap = Object.create(null);
            for (const it of items) { spendMap[it.code] = (it.spendCents || 0) / 100; qtyMap[it.code] = it.q || 0; }
          } else {
            const items = computed.map((row) => {
              const priceCents = Number.isFinite(row.price) && row.price > 0 ? Math.round(row.price * 100) : 0;
              const baseCents = Number.isFinite(row.investedAmount) ? Math.round(row.investedAmount * 100) : 0;
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
              for (const it of items) {
                const after = it.baseCents + it.spendCents;
                it.deficitCents = Math.max(0, it.targetCents - after);
              }
  
              const eligByDef = items.filter((it) => it.deficitCents > 0 && it.priceCents > 0 && it.priceCents <= budgetCents);
  
              let best = null;
              if (eligByDef.length) {
                // For 'investir' mode, prioritize the one with the largest absolute deficit to be more intuitive.
                let bestDeficit = -1;
                for (const it of eligByDef) {
                  if (
                    it.deficitCents > bestDeficit ||
                    (it.deficitCents === bestDeficit && (
                      it.priceCents < (best?.priceCents ?? Number.MAX_SAFE_INTEGER) ||
                      (it.priceCents === (best?.priceCents ?? 0) && it.rank < (best?.rank ?? 1e9))
                    ))
                  ) {
                    best = it;
                    bestDeficit = it.deficitCents;
                  }
                }
              } else {
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
  
              best.q += 1;
              best.spendCents += best.priceCents;
              budgetCents -= best.priceCents;
            }
  
            spendMap = Object.create(null);
            qtyMap = Object.create(null);
            for (const it of items) { spendMap[it.code] = (it.spendCents || 0) / 100; qtyMap[it.code] = it.q || 0; }
          }
  
          computed.forEach((row) => {
            const tr = document.createElement('tr');
            const cost = Number(spendMap[row.code] || 0);
            const valueAfter = (Number.isFinite(row.investedAmount) ? row.investedAmount : 0) + cost;
            const faltaAfter = Number.isFinite(row.targetPer) ? Math.max(0, row.targetPer - valueAfter) : NaN;
            const qtyToBuy = Number(qtyMap[row.code] || 0);
            if (Number.isFinite(row.qty) && row.qty > 0) tr.classList.add('row-holding');
            tr.innerHTML = `
              <td>${row.rank}</td>
              <td>${row.code}</td>
              <td class="num">${Number.isFinite(row.price) ? fmtBRL(row.price) : '<span class="muted">—</span>'}</td>
              <td class="num">${Number.isFinite(row.avgPrice) ? fmtBRL(row.avgPrice) : '<span class="muted">—</span>'}</td>
              <td class="num">${Number.isFinite(row.qty) ? row.qty : '<span class="muted">—</span>'}</td>
              <td class="num">${row.qty > 0 ? fmtBRL(row.investedAmount) : '<span class="muted">—</span>'}</td>
              <td class="num">${Number.isFinite(row.targetPer) ? fmtBRL(row.targetPer) : '<span class="muted">—</span>'}</td>
              <td class="num">${(Number.isFinite(row.investedAmount) || Number.isFinite(cost)) ? fmtBRL(valueAfter) : '<span class="muted">—</span>'}</td>
              <td class="num">${Number.isFinite(faltaAfter) ? fmtBRL(faltaAfter) : '<span class="muted">—</span>'}</td>
              <td class="num">${qtyToBuy > 0 ? qtyToBuy : '<span class="muted">—</span>'}</td>
              <td class="num">${fmtBRL(cost)}</td>
            `;
            ewBody.appendChild(tr);
          });
  
          const remainder = Math.max(0, budgetCents) / 100;
          const remTr = document.createElement('tr');
          remTr.innerHTML = `
            <td></td>
            <td><strong>Sobra</strong></td>
            <td class="num" colspan="8"><span class="muted">—</span></td>
            <td class="num">${fmtBRL(remainder)}</td>
          `;
          ewBody.appendChild(remTr);

          // --- SELL PLAN LOGIC ---
          const ewSellBody = $('#ewSellBody');
          ewSellBody.innerHTML = '';

          const stocksToSell = [];
          for (const ticker in holdings) {
            if (holdings[ticker] && holdings[ticker].qty > 0 && !topTickers.has(ticker)) {
              const stock = holdings[ticker];
              stocksToSell.push({
                code: ticker,
                qty: stock.qty,
                price: stock.price,
                totalValue: (Number.isFinite(stock.price) && Number.isFinite(stock.qty)) ? stock.price * stock.qty : 0,
              });
            }
          }

          if (stocksToSell.length > 0) {
            ewSellHeader.style.display = 'flex';
            // Visibility of ewSellBodyWrap is controlled by its own collapse logic
            const showCurrency = ewSellShowCurrency.checked;
            const priceFormatter = showCurrency ? fmtBRL : fmtNumberBR;

            stocksToSell.sort((a, b) => b.totalValue - a.totalValue);
            let totalSellValue = 0;
            stocksToSell.forEach(stock => {
              const tr = document.createElement('tr');
              tr.innerHTML = `
                <td>${stock.code}F</td>
                <td class="num">${stock.qty}</td>
                <td class="num">${Number.isFinite(stock.price) ? priceFormatter(stock.price) : '<span class="muted">—</span>'}</td>
                <td class="num">${Number.isFinite(stock.totalValue) ? fmtBRL(stock.totalValue) : '<span class="muted">—</span>'}</td>
                <td class="num" style="text-align:center;"><input type="checkbox" class="ew-sell-checkbox" data-ticker="${stock.code}"></td>
              `;
              ewSellBody.appendChild(tr);
              if (Number.isFinite(stock.totalValue)) totalSellValue += stock.totalValue;
            });
            const totalTr = document.createElement('tr');
            totalTr.style.fontWeight = 'bold';
            totalTr.style.borderTop = '2px solid #d1d5db';
            totalTr.innerHTML = `<td colspan="3">Valor Total a Vender</td><td class="num" id="ewSellTotalValue">${fmtBRL(totalSellValue)}</td><td></td>`;
            ewSellBody.appendChild(totalTr);
          } else {
            ewSellHeader.style.display = 'none';
            ewSellBodyWrap.style.display = 'none';
          }
          // --- END OF SELL PLAN LOGIC ---
        });
      });
    }

    // --- Sell Plan Collapse Logic ---
    const SELL_COLLAPSE_KEY = 'ew_sell_plan_collapsed';
    function loadSellCollapsed() { return new Promise((resolve) => { try { chrome.storage.sync.get([SELL_COLLAPSE_KEY], (r) => resolve(Boolean(r?.[SELL_COLLAPSE_KEY]))); } catch { resolve(false); } }); }
    function saveSellCollapsed(v) { return new Promise((resolve) => { try { chrome.storage.sync.set({ [SELL_COLLAPSE_KEY]: Boolean(v) }, () => resolve()); } catch { resolve(); } }); }
  
    function applySellCollapseState(collapsed) {
      if (!ewSellBodyWrap || !ewSellToggle) return;
      ewSellBodyWrap.style.display = collapsed ? 'none' : 'block';
      ewSellToggle.textContent = collapsed ? 'Mostrar' : 'Ocultar';
    }
  
    ewSellShowCurrency.addEventListener('change', async () => {
      await saveSellCurrency(ewSellShowCurrency.checked);
      recompute();
    });

    ewSellToggle.addEventListener('click', async () => {
      const nowCollapsed = ewSellBodyWrap.style.display !== 'none' ? true : false;
      applySellCollapseState(nowCollapsed);
      await saveSellCollapsed(nowCollapsed);
    });

    // Load initial state for sell plan collapse
    // Event listener for row selection in the sell plan
    const ewSellBody = $('#ewSellBody');
    if (ewSellBody) {
      ewSellBody.addEventListener('change', (e) => {
        if (e.target.matches('.ew-sell-checkbox')) {
          const tr = e.target.closest('tr');
          if (tr) {
            tr.classList.toggle('row-sell-selected', e.target.checked);
          }
          updateSellTotal();
        }
      });
    }

    // Event listener for "select all" in the sell plan
    const ewSellSelectAll = $('#ewSellSelectAll');
    if (ewSellSelectAll) {
      ewSellSelectAll.addEventListener('change', (e) => {
        const isChecked = e.target.checked;
        ewSellBody.querySelectorAll('.ew-sell-checkbox').forEach(chk => {
          chk.checked = isChecked;
          const tr = chk.closest('tr');
          if (tr) tr.classList.toggle('row-sell-selected', isChecked);
        });
        updateSellTotal();
      });
    }
  
    function updateSellTotal() {
      const ewSellBody = $('#ewSellBody');
      if (!ewSellBody) return;

      const totalValueCell = $('#ewSellTotalValue');
      if (!totalValueCell) return;

      const allCheckboxes = ewSellBody.querySelectorAll('.ew-sell-checkbox');
      const selectedCheckboxes = ewSellBody.querySelectorAll('.ew-sell-checkbox:checked');

      let rowsToSum;
      if (selectedCheckboxes.length > 0) {
        rowsToSum = Array.from(selectedCheckboxes).map(chk => chk.closest('tr'));
      } else {
        rowsToSum = Array.from(allCheckboxes).map(chk => chk.closest('tr'));
      }

      let newTotal = 0;
      rowsToSum.forEach(tr => {
        if (!tr) return;
        const valueCell = tr.cells[3];
        if (valueCell) {
          const value = parseMoneyBR(valueCell.textContent);
          if (Number.isFinite(value)) newTotal += value;
        }
      });
      totalValueCell.textContent = fmtBRL(newTotal);
    }

    if (ewExportCsv) {
      ewExportCsv.addEventListener('click', () => {
        const planTable = ewBody ? ewBody.closest('table') : null;
        if (!planTable) {
          alert('Tabela do plano nao encontrada.');
          return;
        }
        const planRows = ewBody ? Array.from(ewBody.querySelectorAll('tr')).filter((tr) => tr.querySelectorAll('td').length >= 11) : [];
        if (planRows.length === 0) {
          alert('Nenhum dado disponivel para exportar. Atualize suas acoes.');
          return;
        }
        const csv = serializeTableToCsv(planTable);
        if (!csv) {
          alert('Nao foi possivel gerar o arquivo CSV.');
          return;
        }
        downloadCsv(csv, 'plano-equal-weight-' + timestampSuffix() + '.csv');
      });
    }

    if (ewSellExportCsv) {
      ewSellExportCsv.addEventListener('click', () => {
        const sellTable = ewSellBody ? ewSellBody.closest('table') : null;
        if (!sellTable) {
          alert('Tabela de vendas nao encontrada.');
          return;
        }
        const sellRows = ewSellBody ? Array.from(ewSellBody.querySelectorAll('tr')).filter((tr) => tr.querySelectorAll('td').length >= 5) : [];
        if (sellRows.length === 0) {
          alert('Nenhum ativo fora do Top N para exportar.');
          return;
        }
        const csv = serializeTableToCsv(sellTable);
        if (!csv) {
          alert('Nao foi possivel gerar o arquivo CSV.');
          return;
        }
        downloadCsv(csv, 'plano-venda-' + timestampSuffix() + '.csv');
      });
    }

    // Prefill total with detected portfolio total
    const first = detectFirstSensitiveTotal();
    const detected = Number.isFinite(first) && first > 0 ? first : detectPortfolioTotal();
    if (Number.isFinite(detected) && detected > 0) ewTotal.value = detected.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
    else ewTotal.value = '';
  
    // Events
    ewN.addEventListener('change', recompute);
    ewSource.addEventListener('change', async () => {
      ewSourceValue = ewSource.value;
      await saveSource(ewSourceValue);
      recompute();
    });
    ewTotal.addEventListener('change', () => { // keep as BR currency if user typed raw number
      const n = parseMoneyBR(ewTotal.value);
      if (Number.isFinite(n)) ewTotal.value = n.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
      recompute();
    });
    ewUpdateMyStocks.addEventListener('click', async () => {
      ewUpdateMyStocks.disabled = true;
      const originalText = ewUpdateMyStocks.textContent;
      ewUpdateMyStocks.textContent = 'Atualizando...';
  
      try {
        await setShowAllOnPagination();
      } catch (e) {
        console.error('[StatusInvest Ext] Erro ao tentar exibir todos os ativos:', e);
        ewUpdateMyStocks.disabled = false;
        ewUpdateMyStocks.textContent = originalText;
        return;
      }
  
      // Aguarda a página atualizar a lista de ativos
      setTimeout(() => {
        try {
          // Collect portfolio totals by asset class first
          console.log('[Portfolio Totals] Starting collection...');
          const portfolioTotals = collectPortfolioTotals();
          
          // Save totals to cache
          savePortfolioTotalsToCache(portfolioTotals);

          // Log example of how to access the consolidated totals
          setTimeout(() => {
            getPortfolioTotalsFromCache((cachedTotals) => {
              if (cachedTotals) {
                console.log('[Portfolio Totals] Example usage - Cached totals:');
                console.log(`- Ações: ${formatCurrency(cachedTotals.acoes)}`);
                console.log(`- FIIs: ${formatCurrency(cachedTotals.fiis)}`);
                console.log(`- ETFs: ${formatCurrency(cachedTotals.etfs)}`);
                console.log(`- Exterior: ${formatCurrency(cachedTotals.exterior)}`);
                console.log(`- Total Geral: ${formatCurrency(cachedTotals.acoes + cachedTotals.fiis + cachedTotals.etfs + cachedTotals.exterior)}`);
              }
            });
          }, 500);

          // Find the "AÇÕES" group to use as a context for reading holdings
          let acoesGroup = null;
          const groups = document.querySelectorAll('li.group');
          for (const group of groups) {
            const h3 = group.querySelector('h3');
            if (h3 && (h3.textContent || '').trim().toUpperCase() === 'AÇÕES') {
              acoesGroup = group;
              break;
            }
          }

          const holdings = readHoldingsFromPage(acoesGroup); // Pass only the 'Ações' group context
          chrome.storage.local.set({ my_portfolio_holdings: holdings }, () => {
            if (chrome.runtime.lastError) {
              console.error('[StatusInvest Ext] Erro ao salvar no cache (contexto invalidado?):', chrome.runtime.lastError.message);
              ewUpdateMyStocks.disabled = false;
              ewUpdateMyStocks.textContent = originalText;
              return;
            }
            const tickers = Object.keys(holdings);
            console.log('[StatusInvest Ext] Ações da carteira salvas:', tickers);
            ewUpdateMyStocks.textContent = `Carteira salva (${tickers.length} ativos)!`;
            setTimeout(() => {
              ewUpdateMyStocks.disabled = false;
              ewUpdateMyStocks.textContent = originalText;
              recompute(); // Recalcula o plano com os novos dados
            }, 3000);
          });
        } catch (e) { console.error('[StatusInvest Ext] Erro ao ler/salvar ações:', e); ewUpdateMyStocks.disabled = false; ewUpdateMyStocks.textContent = originalText; }
      }, 3000); // 3s de espera para a página renderizar
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
  
    ewToggle.addEventListener('click', async () => { // Corrigido
      const nowCollapsed = ewBodyWrap.style.display !== 'none' ? true : false;
      applyCollapseState(nowCollapsed);
      await saveCollapsed(nowCollapsed);
    });
  
    // Load all initial states for panels
    Promise.all([loadCollapsed(), loadSellCollapsed(), loadSellCurrency()]).then(([planCollapsed, sellCollapsed, showCurrency]) => {
      applyCollapseState(planCollapsed);
      applySellCollapseState(sellCollapsed);
      ewSellShowCurrency.checked = showCurrency;
      handleAutoRefresh();
    });

    // Load initial mode and source
    Promise.all([loadMode(), loadSource()]).then(([m, s]) => {
      ewMode = m === 'rebalancear' ? 'rebalancear' : 'investir';
      ewModeInputs.forEach((inp) => { inp.checked = (inp.value === ewMode); });
  
      const validSources = ['fm', 'fm_inv10', 'magic_inv10+sum'];
      ewSourceValue = validSources.includes(s) ? s : 'fm';
      if (ewSource) ewSource.value = ewSourceValue;
  
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
      try { initPortfolioDistributionPanel(); } catch {}
      try { initRebalancePanel(); } catch {}
      try { initEqualWeightPlanPanel(); } catch {}
    } else if (tries >= MAX_TRIES) {
      clearInterval(iv);
      fetchRanksAndThen(() => {
        enhanceOnce();
        setupObserver();
      });
      try { initPortfolioDistributionPanel(); } catch {}
      try { initRebalancePanel(); } catch {}
      try { initEqualWeightPlanPanel(); } catch {}
    }
  }, 500);

  // Overlay menu handled by a lightweight global content script (overlay.js).
})();
