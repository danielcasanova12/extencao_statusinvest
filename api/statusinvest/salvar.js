// Vercel Serverless Function: POST /api/statusinvest/salvar
// - Recebe CSV (JSON { csv } ou { csv_base64 })
// - Faz parse robusto mantendo cabeçalhos originais
// - Limpa e popula a tabela `tb_statusinvest`
// - Armazena cada linha como JSONB em `data` + `ticker` (PK) quando disponível

let pool;

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
  if (!token) return true; // se não configurado, não bloqueia
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

function mapColumns(headersRaw) {
  const headers = headersRaw.map((h) => h.trim());
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  const mapByNorm = new Map();
  headers.forEach((h) => mapByNorm.set(norm(h), h));
  const pick = (...cands) => {
    for (const c of cands) { const key = norm(c); if (mapByNorm.has(key)) return mapByNorm.get(key); }
    for (const c of cands) { const ck = norm(c); const found = headers.find((h) => norm(h).includes(ck)); if (found) return found; }
    return null;
  };
  return {
    ticker: pick('ticker','code','papel','tkr','symbol','ativo'),
  };
}

function parseCSV(text) {
  const lines = (text || '').split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return { headers: [], rows: [], cols: {} };
  const delimiter = pickDelimiter(lines[0]);
  const headers = splitCSVLine(lines[0], delimiter).map((h) => h.trim());
  const cols = mapColumns(headers);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = splitCSVLine(lines[i], delimiter);
    const row = {};
    headers.forEach((h, idx) => { row[h] = vals[idx]; });
    const ticker = row[cols.ticker] || row.ticker || row.Ticker || row.Papel || row.ATIVO;
    rows.push({ ticker: ticker ? String(ticker).trim().toUpperCase() : null, data: row });
  }
  return { headers, rows, cols };
}

async function ensureTable(db) {
  const sql = [
    'CREATE TABLE IF NOT EXISTS tb_statusinvest (',
    '  ticker       text PRIMARY KEY,',
    '  data         jsonb NOT NULL,',
    '  generated_at timestamptz default now()',
    ');'
  ].join('\n');
  await db.query(sql);
}

async function truncateTable(db) {
  await db.query('TRUNCATE TABLE tb_statusinvest');
}

async function insertRows(db, rows) {
  if (!rows.length) return 0;
  // batch insert para evitar statements gigantes
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
    let body = req.body;
    const ct = String(req.headers['content-type'] || '').toLowerCase();
    if (!body || ct.includes('application/json')) {
      body = body || await new Promise((resolve) => {
        let data = '';
        try {
          req.on('data', (ch) => { data += ch; });
          req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
        } catch { resolve({}); }
      });
    }
    let csvText = body && (body.csv || null);
    if (!csvText && body && body.csv_base64) {
      try { csvText = Buffer.from(body.csv_base64, 'base64').toString('utf8'); } catch {}
    }
    if (!csvText) return res.status(400).json({ ok: false, error: 'CSV ausente' });

    const parsed = parseCSV(csvText);
    if (!parsed.rows.length) return res.status(400).json({ ok: false, error: 'CSV vazio' });

    const db = await getPool();
    await ensureTable(db);
    await truncateTable(db);
    const inserted = await insertRows(db, parsed.rows);
    return res.status(200).json({ ok: true, processed: inserted, generated_at: new Date().toISOString() });
  } catch (err) {
    console.error('[statusinvest/salvar] error:', err);
    return res.status(500).json({ ok: false, error: String(err && (err.message || err)) });
  }
}

