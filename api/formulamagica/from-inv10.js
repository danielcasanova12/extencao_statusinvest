// Vercel Serverless Function: POST /api/formulamagica/from-inv10
// Recalcula a Fórmula Mágica apenas para tickers presentes em tb_inv10
// com true_count >= min (default 6), reordenando os ranks entre o subconjunto

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
  if (!token) return true;
  const hdr = String(req.headers['authorization'] || req.headers['Authorization'] || '').trim();
  if (!hdr.toLowerCase().startsWith('bearer ')) return false;
  const provided = hdr.slice(7).trim();
  return provided && provided === token;
}

function denseRankDesc(values) {
  const uniq = Array.from(new Set(values.filter((v) => v != null && Number.isFinite(v)))).sort((a,b)=>b-a);
  const map = new Map();
  uniq.forEach((v, i) => map.set(v, i + 1));
  return (v) => map.get(v) || null;
}

async function ensureTable(db) {
  const sql = [
    'CREATE TABLE IF NOT EXISTS tb_formulamagica_inv10 (',
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
    "  source           text DEFAULT 'inv10',",
    '  generated_at     timestamptz default now()',
    ');'
  ].join('\n');
  await db.query(sql);
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
        try { req.on('data', (ch) => { data += ch; }); req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } }); }
        catch { resolve({}); }
      });
    }
    const minTrue = Number(body?.min_true || process.env.FM_INV10_TRUE_MIN || 6);

    const db = await getPool();
    // 1) Tickers com true_count >= min
    const qTickers = 'SELECT UPPER(ticker) AS ticker, true_count FROM tb_inv10 WHERE true_count >= $1';
    const { rows: invRows } = await db.query(qTickers, [minTrue]);
    // mapa com true_count do Investidor10 por ticker
    const inv10Map = new Map();
    invRows.forEach((r) => {
      const t = String(r.ticker || '').trim().toUpperCase();
      const c = r.true_count != null ? Number(r.true_count) : null;
      if (t) inv10Map.set(t, c);
    });
    const tickers = Array.from(inv10Map.keys());
    if (!tickers.length) return res.status(200).json({ ok: true, processed: 0, reason: 'no_tickers', min_true: minTrue });

    // 2) Busca dados já calculados em tb_formulamagica para esses tickers
    const { rows: fmRows } = await db.query('SELECT * FROM tb_formulamagica WHERE UPPER(ticker) = ANY($1::text[])', [tickers]);
    if (!fmRows.length) return res.status(400).json({ ok: false, error: 'tb_formulamagica vazia ou não contém esses tickers. Execute /formulamagica/calcular antes.' });

    // 3) Recalcula ranks para o subconjunto
    const byTicker = new Map();
    fmRows.forEach((r) => { byTicker.set(String(r.ticker || '').trim().toUpperCase(), r); });
    const subset = tickers.map((t) => byTicker.get(t)).filter(Boolean);
    if (!subset.length) return res.status(200).json({ ok: true, processed: 0, reason: 'no_overlap' });

    const eyVals = subset.map((x) => (x.ey != null ? Number(x.ey) : null));
    const roicVals = subset.map((x) => (x.roic != null ? Number(x.roic) : null));
    const rankEY = denseRankDesc(eyVals);
    const rankROIC = denseRankDesc(roicVals);

    const rowsOut = subset.map((x) => {
      const ey = x.ey != null ? Number(x.ey) : null;
      const roic = x.roic != null ? Number(x.roic) : null;
      const rEY = rankEY(ey);
      const rROIC = rankROIC(roic);
      const mf = (rEY || 0) + (rROIC || 0);
      const tkr = String(x.ticker || '').trim().toUpperCase();
      // i10_score: usar true_count do Investidor10 se disponível; caso contrário, manter o existente
      const i10FromInv = inv10Map.has(tkr) ? inv10Map.get(tkr) : null;
      const i10Score = i10FromInv != null ? Number(i10FromInv) : (x.i10_score != null ? Number(x.i10_score) : null);
      return {
        ticker: tkr,
        empresa: x.empresa || null,
        setor: x.setor || null,
        market_cap: x.market_cap != null ? Number(x.market_cap) : null,
        liquidez: x.liquidez != null ? Number(x.liquidez) : null,
        margem_ebit: x.margem_ebit != null ? Number(x.margem_ebit) : null,
        roic: roic,
        i10_score: i10Score,
        ebit: x.ebit != null ? Number(x.ebit) : null,
        ev: x.ev != null ? Number(x.ev) : null,
        ey: ey,
        rank_ey: rEY || null,
        rank_roic: rROIC || null,
        mf_rank: mf,
      };
    });

    // Ordena e define mf_rank_final
    rowsOut.sort((a,b)=> (a.mf_rank - b.mf_rank) || (b.ey - a.ey) || (b.roic - a.roic) || ((b.i10_score||0)-(a.i10_score||0)) || a.ticker.localeCompare(b.ticker));
    rowsOut.forEach((x,i)=> x.mf_rank_final = i+1);

    // 4) Persiste em tb_formulamagica_inv10
    await ensureTable(db);
    await db.query('TRUNCATE TABLE tb_formulamagica_inv10');
    if (rowsOut.length) {
      const cols = ['ticker','empresa','setor','market_cap','liquidez','margem_ebit','roic','i10_score','ebit','ev','ey','rank_ey','rank_roic','mf_rank','mf_rank_final'];
      const params = [];
      const values = rowsOut.map((r, idx) => {
        cols.forEach((c)=> params.push(r[c] != null ? r[c] : null));
        const base = idx*cols.length;
        const ph = cols.map((_,i)=>'$'+(base+i+1)).join(',');
        return '('+ph+')';
      }).join(',');
      const sql = 'INSERT INTO tb_formulamagica_inv10 ('+cols.join(',')+') VALUES '+values;
      await db.query(sql, params);
    }

    return res.status(200).json({ ok: true, processed: rowsOut.length, min_true: minTrue });
  } catch (err) {
    console.error('[formulamagica/from-inv10] error:', err);
    return res.status(500).json({ ok: false, error: String(err && (err.message || err)) });
  }
}
