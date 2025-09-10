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

  // CSV upload UI (no-op handlers for now)
  const csvInput = $('#csvInput');
  const btnUpload = $('#btnUpload');
  const btnExecutar = $('#btnExecutar');
  const fileName = $('#fileName');
  const statusArea = $('#statusArea');

  function setStatus(text) { if (statusArea) statusArea.textContent = text; }
  function setFileName(text) { if (fileName) fileName.textContent = text; }
  function setUploadEnabled(enabled) { if (btnUpload) btnUpload.disabled = !enabled; }

  if (csvInput) {
    csvInput.addEventListener('change', () => {
      const file = csvInput.files && csvInput.files[0];
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

  if (btnUpload) {
    btnUpload.addEventListener('click', () => {
      const file = csvInput && csvInput.files && csvInput.files[0];
      console.log('[popup] Upload clicado.', file ? `Arquivo: ${file.name}` : 'Nenhum arquivo.');
      setStatus(file ? `Upload clicado: ${file.name}` : 'Nenhum arquivo selecionado');
    });
  }

  if (btnExecutar) {
    btnExecutar.addEventListener('click', () => {
      console.log('[popup] Executar clicado.');
      setStatus('Executar clicado');
    });
  }

  // Persistência e lista de itens salvos
  const STORAGE_KEY = 'csv_items';
  const SELECTED_KEY = 'csv_selected_id';
  const savedList = $('#savedList');

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
  if (btnUpload) {
    btnUpload.addEventListener('click', async () => {
      const file = csvInput && csvInput.files && csvInput.files[0];
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
        if (csvInput) csvInput.value = '';
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
  if (btnExecutar) {
    btnExecutar.addEventListener('click', async () => {
      const { items, selectedId } = await loadItems();
      const sel = items.find((x) => String(x.id) === String(selectedId));
      if (!sel) { setStatus('Selecione um item salvo para executar.'); return; }
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

  // Primeira renderização
  renderList();
})();
