// Vercel Serverless Function: POST /api/inv10/scrape
// - Input JSON: { tickers: ["petr4","wege3", ...] }
// - Scrapes https://investidor10.com.br/acoes/<ticker>/
// - Extracts checklist inputs (.checklist-item input.styled-checkbox)
// - Builds JSON per ticker and persists to tb_inv10
// - Pode truncar tb_inv10 (truncate=true) ou fazer append (append=true)

let pool;
const cheerio = require('cheerio');

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
  if (!token) return true;
  const hdr = String(req.headers['authorization'] || req.headers['Authorization'] || '').trim();
  if (!hdr.toLowerCase().startsWith('bearer ')) return false;
  const provided = hdr.slice(7).trim();
  return provided && provided === token;
}

async function ensureTable(db) {
  const sql = [
    'CREATE TABLE IF NOT EXISTS tb_inv10 (',
    '  id          SERIAL PRIMARY KEY,',
    '  acao        TEXT,',
    '  ticker      TEXT,',
    '  url         TEXT,',
    '  scraped_at  TIMESTAMPTZ,',
    '  checks      JSONB,',
    '  true_count  INTEGER',
    ');'
  ].join('\n');
  await db.query(sql);
  try { await db.query('CREATE INDEX IF NOT EXISTS idx_tb_inv10_ticker ON tb_inv10 (UPPER(ticker))'); } catch {}
}

async function truncateTable(db) {
  await db.query('TRUNCATE TABLE tb_inv10');
}

async function insertRows(db, items) {
  if (!items.length) return 0;
  const batch = 500;
  let total = 0;
  for (let i = 0; i < items.length; i += batch) {
    const slice = items.slice(i, i + batch);
    const params = [];
    const values = slice.map((r, idx) => {
      const p1 = `$${idx * 6 + 1}`; // acao
      const p2 = `$${idx * 6 + 2}`; // ticker
      const p3 = `$${idx * 6 + 3}`; // url
      const p4 = `$${idx * 6 + 4}`; // scraped_at
      const p5 = `$${idx * 6 + 5}::jsonb`; // checks
      const p6 = `$${idx * 6 + 6}`; // true_count
      params.push(r.acao, r.ticker, r.url, r.scraped_at, JSON.stringify(r.checks), r.trueCount);
      return `(${p1},${p2},${p3},${p4},${p5},${p6})`;
    });
    const sql = 'INSERT INTO tb_inv10 (acao,ticker,url,scraped_at,checks,true_count) VALUES ' + values.join(',');
    await db.query(sql, params);
    total += slice.length;
  }
  return total;
}

function toTicker(s) { return (s || '').toString().trim().toUpperCase(); }

async function scrapeOne(tkr) {
  const ticker = toTicker(tkr);
  const lower = ticker.toLowerCase();
  const url = `https://investidor10.com.br/acoes/${encodeURIComponent(lower)}/`;
  const html = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Bot/1.0)' } }).then(r => r.text());
  const $ = cheerio.load(html);

  let acao = ($('h1').first().text() || '').trim();
  if (!acao) acao = ticker;

  const checks = {};
  let trueCount = 0;

  // The specific checklist items to count, configurable via env var.
const defaultChecks = [
  'Empresa nunca deu prejuízo (ano fiscal)',
  'Empresa com lucro nos últimos 20 trimestres (5 anos)',
  'Empresa possui dívida menor que patrimônio',
  'Empresa apresentou crescimento de receita nos últimos 5 anos',
  'Empresa apresentou crescimento de lucros nos últimos 5 anos',
  'Empresa com mais de 5 anos de Bolsa',
  'Empresa pagou +5% de dividendos/ano nos últimos 5 anos',
  'Empresa possui ROE acima de 10%',
  'Empresa possui liquidez diária acima de US$ 2M',
];
  const checksFromEnv = (process.env.INV10_TARGET_CHECKS || '').split('|').map(s => s.trim()).filter(Boolean);
  const TARGET_CHECKS = new Set(checksFromEnv.length > 0 ? checksFromEnv : defaultChecks);

  // Iterate over each checklist item on the page to get its text and checked status.
  $('.checklist-item').each((_, element) => {
    const item = $(element);
    const input = item.find('input.styled-checkbox');
    if (!input.length) {
      return; // Skip if no checkbox found inside
    }

    const id = input.attr('id') || input.attr('name') || '';
    const checked = input.is(':checked') || input.attr('checked') != null;
    const text = item.text().trim();

    // Store all checklist items found in the `checks` JSONB for reference.
    if (id) {
      checks[id] = { checked };
    }

    // Check if the item's text matches one of the targets.
    let isTarget = false;
    for (const targetText of TARGET_CHECKS) {
      if (text.startsWith(targetText)) {
        isTarget = true;
        break;
      }
    }

    // If it's a target item and it's checked, increment the special count.
    if (isTarget && checked) {
      trueCount += 1;
    }
  });

  const item = {
    acao,
    ticker,
    url,
    scraped_at: new Date().toISOString(),
    checks,
    trueCount,
  };
  return item;
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  try {
    // Parse body
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
    let tickers = Array.isArray(body?.tickers) ? body.tickers : [];
    const truncate = Boolean(body?.truncate);
    const append = Boolean(body?.append);
    if (!tickers.length) tickers = (String(body?.ticker || '') ? [String(body.ticker)] : []);
    // Permite chamada somente para truncar, sem tickers
    if (!tickers.length && truncate) {
      const db = await getPool();
      await ensureTable(db);
      await truncateTable(db);
      return res.status(200).json({ status: 'ok', tickers_processados: 0, inserted: 0, timestamp: new Date().toISOString(), truncated: true, append });
    }
    if (!tickers.length) return res.status(400).json({ ok: false, error: 'tickers vazios' });

    // Scrape sequencial (estável e respeita o site)
    const results = [];
    for (const t of tickers) {
      try { results.push(await scrapeOne(t)); }
      catch (e) { results.push({ ticker: toTicker(t), url: `https://investidor10.com.br/acoes/${String(t).toLowerCase()}/`, error: String(e && (e.message || e)) }); }
      const delay = Number(process.env.INV10_SCRAPE_DELAY) || 250;
      await new Promise((r) => setTimeout(r, delay)); // pequena pausa entre requisições
    }

    // Persistir
    const db = await getPool();
    await ensureTable(db);
    if (truncate) { await truncateTable(db); }
    // Apenas itens válidos (que tenham checks mapeados)
    const valid = results.filter((x) => x && x.ticker && x.checks && typeof x.trueCount === 'number');
    const inserted = await insertRows(db, valid);

    const ts = new Date().toISOString();
    return res.status(200).json({ status: 'ok', tickers_processados: results.length, inserted, timestamp: ts, truncated: truncate, append: append, data: results });
  } catch (err) {
    console.error('[inv10/scrape] error:', err);
    return res.status(500).json({ ok: false, error: String(err && (err.message || err)) });
  }
}
