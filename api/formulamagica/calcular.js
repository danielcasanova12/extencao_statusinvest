// Vercel Serverless Function: POST /api/formulamagica/calcular
// - Recebe CSV via body (JSON { csv }) ou usa cache interno (best-effort)
// - Processa conforme as regras da Fórmula Mágica
// - Limpa e grava os resultados em `tb_formulamagica`
// - Protegido por Authorization: Bearer ${API_TOKEN} (se definido)

let pool;
let lastCsvCache = null; // cache volátil

const EXCLUSION_LIST = new Set([
  'ITUB4', 'BPAC11', 'BBDC3', 'BBAS3', 'ITSA4', 'SANB11', 'B3SA3', 'BBSE3',
  'CXSE3', 'PSSA3', 'MULT3', 'ALOS3', 'BPAN4', 'BNBR3', 'BRAP4', 'ABCB4',
  'IGTA3', 'BRSR6', 'BMEB4', 'BAZA3', 'BSLI3', 'PLPL3', 'BEES3', 'BMGB4',
  'LOGG3', 'PINE4', 'WIZC3', 'BPAR3', 'SYNE3'
]);

function setCors(_req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

async function getPool() {
  if (pool) return pool;
  const { Pool } = require('pg');
  const connStr = process.env.DATABASE_URL;
  if (!connStr) throw new Error('Missing env: DATABASE_URL');
  const needsSSL = !/localhost|127\.0\.0\.1/i.test(connStr);
  pool = new Pool({ connectionString: connStr, ssl: needsSSL ? { rejectUnauthorized: false } : false });
  return pool;
}

function isAuthorized(req) {
  const token = process.env.API_TOKEN || process.env.FM_API_TOKEN || process.env.SECRET_TOKEN;
  if (!token) return true; // sem token configurado, não bloqueia
  const hdr = String(req.headers['authorization'] || req.headers['Authorization'] || '').trim();
  if (!hdr.toLowerCase().startsWith('bearer ')) return false;
  const provided = hdr.slice(7).trim();
  return provided && provided === token;
}

function pickDelimiter(headerLine) {
  const c = (headerLine || '').split(',').length;
  const s = (headerLine || '').split(';').length;
  return s > c ? ';' : ',';
}

// Split de linha CSV com suporte a aspas
function splitCSVLine(line, delimiter) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; }
      else q = !q;
    } else if (ch === delimiter && !q) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
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

function toCode(s) { return (s || '').toString().trim().toUpperCase(); }
function toLower(s) { return (s || '').toString().trim().toLowerCase(); }

function denseRankDesc(values) {
  const uniq = Array.from(new Set(values.filter((v) => v != null && Number.isFinite(v)))).sort((a,b)=>b-a);
  const map = new Map();
  uniq.forEach((v, i) => map.set(v, i + 1));
  return (v) => map.get(v) || null;
}

function tickerBase(t) {
  const s = toCode(t);
  const m = s.match(/^[A-Z]+/);
  return m ? m[0] : s;
}

function isFinancial(row) {
  const sector = toLower(row.sector || row.setor || row.segmento || row.subsetor);
  if (/(banco|financeir|seguro|insur|financial|bank)/i.test(sector)) return true;
  const t = toCode(row.ticker);
  return /^(ITUB|BBDC|SANB|BBAS|BRSR|ABCB|BPAN|SAFG|SULA|PSSA|BBSE|IRBR|BRPR|SULA|SSBR)/.test(t);
}

function computeEY(row, cols) {
  const get = (name) => parseNumberBR(row[name]);
  const PEBIT = get(cols.p_ebit);
  const EVEBIT = get(cols.ev_ebit);
  const DLEBIT = get(cols.dl_ebit);
  const MC = get(cols.market_cap);
  let EBIT = null; if (MC != null && PEBIT != null && PEBIT !== 0) EBIT = MC / PEBIT;
  let net = null; if (EBIT != null && DLEBIT != null) net = DLEBIT * EBIT;
  let EV = null; if (MC != null && net != null) EV = MC + net;
  let EY = null;
  if (EVEBIT != null && EVEBIT !== 0) EY = 1 / EVEBIT;
  if (EY == null && PEBIT != null && DLEBIT != null && (PEBIT + DLEBIT) !== 0) EY = 1 / (PEBIT + DLEBIT);
  if (EY == null && EBIT != null && EV != null && EV !== 0) EY = EBIT / EV;
  return { EY, EBIT, EV };
}

function mapColumns(headersRaw) {
  const headers = headersRaw.map((h) => h.trim());
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  const mapByNorm = new Map();
  headers.forEach((h) => mapByNorm.set(norm(h), h));
  const pick = (...cands) => {
    for (const c of cands) {
      const key = norm(c);
      if (mapByNorm.has(key)) return mapByNorm.get(key);
    }
    // fallback: contains
    for (const c of cands) {
      const ck = norm(c);
      const found = headers.find((h) => norm(h).includes(ck));
      if (found) return found;
    }
    return null;
  };
  return {
    ticker: pick('ticker','code','papel','tkr','symbol','ativo'),
    empresa: pick('empresa','company','razao_social','nome','cia','companhia'),
    market_cap: pick('market_cap','marketcap','valor_mercado','valor de mercado','market cap','vlmercado','valormercado'),
    p_ebit: pick('P/EBIT','p/ebit','p_ebit','p-ebit','pebit'),
    ev_ebit: pick('EV/EBIT','ev/ebit','ev_ebit','ev-ebit','evebit'),
    dl_ebit: pick('DL/EBIT','dl/ebit','dl_ebit','netdebt_ebit','divida_liquida/ebit','divida liquida/ebit','divida liquida ebit'),
    liquidez: pick('liquidez','liquidity','avg_liquidity','liquid','volmedio','volume medio'),
    margem_ebit: pick('margem_EBIT','margem ebit','margem_ebit','ebit_margin'),
    roic: pick('ROIC','roic','roic_pct','roic%'),
    i10_score: pick('i10_score','checklist_score','i10'),
    setor: pick('setor','sector','segmento','subsetor')
  };
}

function parseCSV(text) {
  const lines = (text || '').split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return [];
  const delimiter = pickDelimiter(lines[0]);
  const headers = splitCSVLine(lines[0], delimiter).map((h) => h.trim());
  const cols = mapColumns(headers);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = splitCSVLine(lines[i], delimiter);
    const row = {};
    headers.forEach((h, idx) => { row[h] = vals[idx]; });
    const ticker = toCode(row[cols.ticker] || row.ticker);
    if (!ticker) continue;
    out.push({ __raw: row, ticker: ticker, cols: cols });
  }
  return { rows: out, headers: headers, cols: cols };
}

function normalizeAndCompute(parsed, env) {
  const rows = [];
  const cols = parsed.cols;
  for (const r of parsed.rows) {
    const raw = r.__raw;
    const res = computeEY({
      [cols.p_ebit]: raw[cols.p_ebit],
      [cols.ev_ebit]: raw[cols.ev_ebit],
      [cols.dl_ebit]: raw[cols.dl_ebit],
      [cols.market_cap]: raw[cols.market_cap],
    }, cols);
    const EY = res.EY, EBIT = res.EBIT, EV = res.EV;
    const ROIC = parseNumberBR(raw[cols.roic]);
    if (EY == null || !Number.isFinite(EY) || ROIC == null || !Number.isFinite(ROIC)) continue;
    const marketCap = parseNumberBR(raw[cols.market_cap]);
    const liquidez = parseNumberBR(raw[cols.liquidez]);
    const margemEBIT = parseNumberBR(raw[cols.margem_ebit]);
    const i10 = parseNumberBR(raw[cols.i10_score]);
    const empresa = raw[cols.empresa] || tickerBase(r.ticker);
    const setor = raw[cols.setor] || '';

    rows.push({
      ticker: r.ticker,
      empresa: String(empresa || '').trim(),
      setor: setor,
      market_cap: marketCap,
      liquidez: liquidez,
      margem_ebit: margemEBIT,
      roic: ROIC,
      i10_score: i10,
      ebit: EBIT,
      ev: EV,
      ey: EY,
      csv_data: raw,
    });
  }

  const LIQ_MIN = Number(process.env.MF_LIQ_MIN || (env && env.MF_LIQ_MIN) || 2000000);
  const CHECK_MIN = Number(process.env.MF_CHECKLIST_MIN || (env && env.MF_CHECKLIST_MIN) || 0);

  const filtered = rows.filter((x) => {
    if (EXCLUSION_LIST.has(x.ticker)) return false;
    if (x.market_cap == null || x.market_cap < 90000000) return false;
    if (x.liquidez == null || x.liquidez < LIQ_MIN) return false;
    if (x.ebit == null || x.ebit <= 1) return false;
    if (x.margem_ebit == null || x.margem_ebit <= 1) return false;
    if (process.env.MF_EXCLUDE_FINANCIAL !== '0' && isFinancial(x)) return false;
    if (x.i10_score != null && x.i10_score < CHECK_MIN) return false;
    return true;
  });

  const byEmp = new Map();
  for (const x of filtered) {
    const key = (x.empresa && x.empresa.trim()) || tickerBase(x.ticker);
    const cur = byEmp.get(key);
    if (!cur) byEmp.set(key, x);
    else {
      const a = cur, b = x;
      if ((b.liquidez || 0) > (a.liquidez || 0)) byEmp.set(key, b);
      else if ((b.liquidez || 0) === (a.liquidez || 0) && (b.market_cap || 0) > (a.market_cap || 0)) byEmp.set(key, b);
    }
  }
  const consolidated = Array.from(byEmp.values());

  const rankEY = denseRankDesc(consolidated.map((x) => x.ey));
  const rankROIC = denseRankDesc(consolidated.map((x) => x.roic));
  consolidated.forEach((x) => { x.rank_ey = rankEY(x.ey); x.rank_roic = rankROIC(x.roic); x.mf_rank = (x.rank_ey || 0) + (x.rank_roic || 0); });

  consolidated.sort(function(a, b) {
    return (a.mf_rank - b.mf_rank) || (b.ey - a.ey) || (b.roic - a.roic) || ((b.i10_score || 0) - (a.i10_score || 0)) || a.ticker.localeCompare(b.ticker);
  });
  consolidated.forEach(function(x, i) { x.mf_rank_final = i + 1; });

  return consolidated;
}

async function ensureTable(db) {
  const sql = [
    'CREATE TABLE IF NOT EXISTS tb_formulamagica (',
    '  ticker           text PRIMARY KEY,',
    '  empresa          text,',
    '  setor            text,',
    '  market_cap       numeric,',
    '  liquidez         numeric,',
    '  margem_ebit      numeric,',
    '  roic             numeric,',
    '  i10_score        numeric,',
    '  ebit             numeric,',
    '  ev               numeric,',
    '  ey               numeric,',
    '  rank_ey          int,',
    '  rank_roic        int,',
    '  mf_rank          int,',
    '  mf_rank_final    int,',
    '  generated_at     timestamptz default now(),',
    '  csv_data         jsonb',
    ');'
  ].join('\n');
  await db.query(sql);
  // Garantir coluna csv_data mesmo se a tabela já existia
  try { await db.query('ALTER TABLE tb_formulamagica ADD COLUMN IF NOT EXISTS csv_data jsonb'); } catch {}
}

async function saveResults(db, rows) {
  await ensureTable(db);
  await db.query('TRUNCATE TABLE tb_formulamagica');
  if (!rows.length) return 0;
  const cols = ['ticker','empresa','setor','market_cap','liquidez','margem_ebit','roic','i10_score','ebit','ev','ey','rank_ey','rank_roic','mf_rank','mf_rank_final','csv_data'];
  const casts = cols.map((c) => (c === 'csv_data' ? '::jsonb' : ''));
  const values = [];
  const params = [];
  let p = 1;
  for (const r of rows) {
    const rowVals = cols.map((c) => (c === 'csv_data' ? (r[c] != null ? JSON.stringify(r[c]) : null) : (r[c] != null ? r[c] : null)));
    const placeholders = cols.map(function(_, idx){ const v = '$' + (p++); return v + casts[idx]; }).join(',');
    values.push('(' + placeholders + ')');
    params.push.apply(params, rowVals);
  }
  const insert = 'INSERT INTO tb_formulamagica (' + cols.join(',') + ') VALUES ' + values.join(',');
  await db.query(insert, params);
  return rows.length;
}

// --- tb_statusinvest helpers (save original CSV rows) ---
async function ensureStatusinvestTable(db) {
  const sql = [
    'CREATE TABLE IF NOT EXISTS tb_statusinvest (',
    '  ticker       text PRIMARY KEY,',
    '  data         jsonb NOT NULL,',
    '  generated_at timestamptz default now()',
    ');'
  ].join('\n');
  await db.query(sql);
}

function buildStatusinvestRows(parsed) {
  const rows = [];
  for (const r of parsed.rows) {
    const ticker = r.ticker && String(r.ticker).trim().toUpperCase();
    if (!ticker) continue; // evita falhas em PK nula
    rows.push({ ticker: ticker, data: r.__raw });
  }
  return rows;
}

async function insertStatusinvest(db, rows) {
  if (!rows.length) return 0;
  const batchSize = 1000;
  let total = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const slice = rows.slice(i, i + batchSize);
    const params = [];
    const values = slice.map((r, idx) => {
      const p1 = `$${idx * 2 + 1}`;
      const p2 = `$${idx * 2 + 2}::jsonb`;
      params.push(r.ticker, JSON.stringify(r.data));
      return `(${p1}, ${p2})`;
    });
    const sql = 'INSERT INTO tb_statusinvest (ticker, data) VALUES ' + values.join(',');
    await db.query(sql, params);
    total += slice.length;
  }
  return total;
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  try {
    let csvText = null;
    const ct = String(req.headers['content-type'] || '').toLowerCase();
    if (ct.includes('application/json')) {
      let body = req.body;
      if (!body) {
        // fallback: parse raw body
        body = await new Promise((resolve) => {
          try {
            let data = '';
            req.on('data', (chunk) => { data += chunk; });
            req.on('end', () => {
              try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
            });
          } catch { resolve({}); }
        });
      }
      csvText = body && (body.csv || null);
      if (!csvText && body && body.csv_base64) {
        try { csvText = Buffer.from(body.csv_base64, 'base64').toString('utf8'); } catch {}
      }
    } else if (typeof req.body === 'string') {
      csvText = req.body;
    }
    if (!csvText && lastCsvCache) csvText = lastCsvCache;
    if (!csvText) return res.status(400).json({ ok: false, error: 'CSV ausente' });

    lastCsvCache = csvText; // cache best-effort

    const parsed = parseCSV(csvText);
    if (!parsed || !parsed.rows || !parsed.rows.length) return res.status(400).json({ ok: false, error: 'CSV vazio ou inválido' });
    const finalRows = normalizeAndCompute(parsed);

    const db = await getPool();
    // 1) Salva tb_statusinvest (espelho do CSV)
    await ensureStatusinvestTable(db);
    await db.query('TRUNCATE TABLE tb_statusinvest');
    const siRows = buildStatusinvestRows(parsed);
    const savedStatusinvest = await insertStatusinvest(db, siRows);

    // 2) Salva tb_formulamagica (resultado do cálculo)
    const count = await saveResults(db, finalRows);
    const ts = new Date().toISOString();
    // Diagnóstico básico de contagens
    const diag = {
      parsed_rows: parsed.rows.length,
      after_compute: finalRows.length,
      statusinvest_rows: siRows.length,
      statusinvest_inserted: savedStatusinvest,
    };
    return res.status(200).json({ ok: true, processed: count, saved_statusinvest: savedStatusinvest, generated_at: ts, diag });
  } catch (err) {
    console.error('[formulamagica/calcular] error:', err);
    return res.status(500).json({ ok: false, error: String(err && (err.message || err)) });
  }
}
