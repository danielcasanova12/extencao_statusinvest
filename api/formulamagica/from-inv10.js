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

const defaultExclusion = [
  'ITUB4', 'BPAC11', 'BBDC3', 'BBAS3', 'ITSA4', 'SANB11', 'B3SA3', 'BBSE3',
  'CXSE3', 'PSSA3', 'MULT3', 'ALOS3', 'BPAN4', 'BNBR3', 'BRAP4', 'ABCB4',
  'IGTA3', 'BRSR6', 'BMEB4', 'BAZA3', 'BSLI3', 'PLPL3', 'BEES3', 'BMGB4',
  'LOGG3', 'PINE4', 'WIZC3', 'BPAR3', 'SYNE3'
].join(',');
const exclusionFromEnv = (process.env.FINANCIAL_EXCLUSION_LIST || defaultExclusion).split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const FINANCIAL_EXCLUSION_LIST = new Set(exclusionFromEnv);

function isFinancial(row) {
  if (!row) return false;
  // Exclui por setor
  const sector = String(row.sector || row.setor || '').toLowerCase();
  if (/(banco|financeir|seguro|insur|financial|bank)/i.test(sector)) return true;
  // Exclui por ticker
  const t = String(row.ticker || '').trim().toUpperCase();
  return FINANCIAL_EXCLUSION_LIST.has(t);
}

async function ensureTables(db) {
  const sqlInv10 = [
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
  await db.query(sqlInv10);

  const sqlInv10Sum = [
    'CREATE TABLE IF NOT EXISTS tb_formulamagica_inv10_simple (',
    '  ticker                    text PRIMARY KEY,',
    '  empresa                   text,',
    '  setor                     text,',
    '  market_cap                numeric,',
    '  liquidez                  numeric,',
    '  margem_ebit               numeric,',
    '  roic                      numeric,',
    '  i10_score                 numeric,',
    '  ebit                      numeric,',
    '  ev                        numeric,',
    '  ey                        numeric,',
    '  rank_ey                   int,',
    '  rank_roic                 int,',
    '  mf_rank                   int,',
    '  mf_rank_final             int,',
    '  inv10_rank                int,',
    '  true_count                int,',
    '  composite_score           numeric,',
    '  mf_rank_final_inv10sum    int,',
    "  source                    text DEFAULT 'inv10_sum',",
    '  generated_at              timestamptz default now()',
    ');'
  ].join('\n');
  await db.query(sqlInv10Sum);

  const alterStatements = [
    'ALTER TABLE tb_formulamagica_inv10_simple ADD COLUMN IF NOT EXISTS mf_rank int',
    'ALTER TABLE tb_formulamagica_inv10_simple ADD COLUMN IF NOT EXISTS inv10_rank int',
    'ALTER TABLE tb_formulamagica_inv10_simple ADD COLUMN IF NOT EXISTS true_count int',
    'ALTER TABLE tb_formulamagica_inv10_simple ADD COLUMN IF NOT EXISTS composite_score numeric',
    'ALTER TABLE tb_formulamagica_inv10_simple ADD COLUMN IF NOT EXISTS mf_rank_final_inv10sum int',
    "ALTER TABLE tb_formulamagica_inv10_simple ADD COLUMN IF NOT EXISTS source text DEFAULT 'inv10_sum'",
    'ALTER TABLE tb_formulamagica_inv10_simple ADD COLUMN IF NOT EXISTS generated_at timestamptz default now()'
  ];
  for (const sql of alterStatements) {
    try { await db.query(sql); } catch (err) { console.warn('[ensureTables] alter skip:', sql, err?.message || err); }
  }

  try {
    await db.query(
      'CREATE OR REPLACE VIEW tb_formulamagica_inv10_simple AS SELECT * FROM tb_formulamagica_inv10_simple'
    );
  } catch (err) {
    const msg = String(err?.message || err);
    if (!/already exists/i.test(msg) && !/is not a view/i.test(msg)) {
      throw err;
    }
    try {
      await db.query('DROP VIEW IF EXISTS tb_formulamagica_inv10_simple');
      await db.query(
        'CREATE OR REPLACE VIEW tb_formulamagica_inv10_simple AS SELECT * FROM tb_formulamagica_inv10_simple'
      );
    } catch (err2) {
      console.warn('[ensureTables] failed to refresh view tb_formulamagica_inv10_simple:', err2?.message || err2);
    }
  }
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
    const minTrue = Number(body?.min_true || process.env.FM_INV10_TRUE_MIN || 4);

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

    const LIQ_MIN = Number(process.env.MF_LIQ_MIN || 1000000);
    const MC_MIN = Number(process.env.MF_MC_MIN || 90000000);

    const subset = tickers.map((t) => byTicker.get(t)).filter(x => 
      x &&
      x.liquidez != null && x.market_cap != null &&
      x.liquidez >= LIQ_MIN && x.market_cap >= MC_MIN &&
      !isFinancial(x)
    );
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
    await ensureTables(db);
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

    // Monta o dataset combinado (Fórmula Mágica + Investidor10)
    const rowsOutMap = new Map(rowsOut.map((row) => [row.ticker, row]));
    const sumRows = subset.map((subsetRow) => {
      const tkr = String(subsetRow.ticker || '').trim().toUpperCase();
      const baseRow = rowsOutMap.get(tkr) || { ...subsetRow, ticker: tkr };
      const original = byTicker.get(tkr) || {};
      const trueCountRaw = inv10Map.has(tkr) ? inv10Map.get(tkr) : null;
      const trueCount = trueCountRaw != null ? Number(trueCountRaw) : null;
      const mfRankOriginalRaw = original.mf_rank_final != null ? Number(original.mf_rank_final) : null;
      const hasRank = mfRankOriginalRaw != null && Number.isFinite(mfRankOriginalRaw);

      return {
        ticker: tkr,
        empresa: baseRow.empresa != null ? baseRow.empresa : (original.empresa || null),
        setor: baseRow.setor != null ? baseRow.setor : (original.setor || null),
        market_cap: baseRow.market_cap != null ? Number(baseRow.market_cap) : (original.market_cap != null ? Number(original.market_cap) : null),
        liquidez: baseRow.liquidez != null ? Number(baseRow.liquidez) : (original.liquidez != null ? Number(original.liquidez) : null),
        margem_ebit: baseRow.margem_ebit != null ? Number(baseRow.margem_ebit) : (original.margem_ebit != null ? Number(original.margem_ebit) : null),
        roic: baseRow.roic != null ? Number(baseRow.roic) : (original.roic != null ? Number(original.roic) : null),
        i10_score: baseRow.i10_score != null ? Number(baseRow.i10_score) : null,
        ebit: baseRow.ebit != null ? Number(baseRow.ebit) : (original.ebit != null ? Number(original.ebit) : null),
        ev: baseRow.ev != null ? Number(baseRow.ev) : (original.ev != null ? Number(original.ev) : null),
        ey: baseRow.ey != null ? Number(baseRow.ey) : (original.ey != null ? Number(original.ey) : null),
        rank_ey: original.rank_ey != null ? Number(original.rank_ey) : (baseRow.rank_ey != null ? Number(baseRow.rank_ey) : null),
        rank_roic: original.rank_roic != null ? Number(original.rank_roic) : (baseRow.rank_roic != null ? Number(baseRow.rank_roic) : null),
        mf_rank: baseRow.mf_rank != null ? Number(baseRow.mf_rank) : (original.mf_rank != null ? Number(original.mf_rank) : null),
        mf_rank_final: hasRank ? mfRankOriginalRaw : null,
        true_count: Number.isFinite(trueCount) ? trueCount : null,
        inv10_rank: null,
        composite_score: null,
        mf_rank_final_inv10sum: null,
        source: 'inv10_sum',
      };
    });

    const rowsWithTrueCount = sumRows
      .filter((row) => row.true_count != null)
      .sort((a, b) => (b.true_count - a.true_count) || a.ticker.localeCompare(b.ticker));
    rowsWithTrueCount.forEach((row, idx) => { row.inv10_rank = idx + 1; });

    sumRows.forEach((row) => {
      const rankEy = Number.isFinite(row.rank_ey) ? row.rank_ey : null;
      const rankRoic = Number.isFinite(row.rank_roic) ? row.rank_roic : null;
      const invRank = Number.isFinite(row.inv10_rank) ? row.inv10_rank : null;
      row.composite_score = (rankEy != null && rankRoic != null && invRank != null) ? (rankEy + rankRoic + invRank) : null;
    });

    const rowsSumOut = [...sumRows];
    rowsSumOut.sort((a, b) => {
      const compA = Number.isFinite(a.composite_score) ? a.composite_score : Number.MAX_SAFE_INTEGER;
      const compB = Number.isFinite(b.composite_score) ? b.composite_score : Number.MAX_SAFE_INTEGER;
      if (compA !== compB) return compA - compB;
      const invA = Number.isFinite(a.inv10_rank) ? a.inv10_rank : Number.MAX_SAFE_INTEGER;
      const invB = Number.isFinite(b.inv10_rank) ? b.inv10_rank : Number.MAX_SAFE_INTEGER;
      if (invA !== invB) return invA - invB;
      const mfA = Number.isFinite(a.mf_rank_final) ? a.mf_rank_final : Number.MAX_SAFE_INTEGER;
      const mfB = Number.isFinite(b.mf_rank_final) ? b.mf_rank_final : Number.MAX_SAFE_INTEGER;
      if (mfA !== mfB) return mfA - mfB;
      const trueA = Number.isFinite(a.true_count) ? a.true_count : -Number.MAX_SAFE_INTEGER;
      const trueB = Number.isFinite(b.true_count) ? b.true_count : -Number.MAX_SAFE_INTEGER;
      if (trueA !== trueB) return trueB - trueA;
      return a.ticker.localeCompare(b.ticker);
    });
    rowsSumOut.forEach((row, idx) => {
      row.mf_rank_final_inv10sum = Number.isFinite(row.composite_score) ? (idx + 1) : null;
    });

    await db.query('TRUNCATE TABLE tb_formulamagica_inv10_simple');
    if (rowsSumOut.length) {
      const sumCols = ['ticker','empresa','setor','market_cap','liquidez','margem_ebit','roic','i10_score','ebit','ev','ey','rank_ey','rank_roic','mf_rank','mf_rank_final','inv10_rank','true_count','composite_score','mf_rank_final_inv10sum','source'];
      const sumParams = [];
      const sumValues = rowsSumOut.map((row, idx) => {
        sumCols.forEach((col) => {
          const value = row[col];
          sumParams.push(value != null ? value : null);
        });
        const base = idx * sumCols.length;
        const placeholders = sumCols.map((_, i) => '$' + (base + i + 1)).join(',');
        return '(' + placeholders + ')';
      }).join(',');
      const sumSql = 'INSERT INTO tb_formulamagica_inv10_simple (' + sumCols.join(',') + ') VALUES ' + sumValues;
      await db.query(sumSql, sumParams);
    }

    return res.status(200).json({ ok: true, processed: rowsOut.length, sum_processed: rowsSumOut.length, min_true: minTrue });
  } catch (err) {
    console.error('[formulamagica/from-inv10] error:', err);
    return res.status(500).json({ ok: false, error: String(err && (err.message || err)) });
  }
}
