// Vercel Serverless Function: /api/i10-scores
// - Returns { code, i10_score, i10_rank? } for tickers
// - Tries view `statusinvest_latest_i10_ranking` first, falls back to table `statusinvest_latest`
// - CORS for https://statusinvest.com.br and chrome extensions

let pool;

function setCors(_req, res) {
  // Public CORS: allow any origin (read-only GET endpoints)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
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

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });

  try {
    const db = await getPool();
    const limit = Math.min(parseInt(req.query.limit, 10) || 1000, 5000);

    let rows = [];
    let source = 'tb_inv10';
    try {
      // Usar a tabela tb_inv10 que realmente existe
      const q = `SELECT ticker, true_count as i10_score FROM tb_inv10 ORDER BY true_count DESC NULLS LAST, ticker LIMIT $1`;
      const r = await db.query(q, [limit]);
      rows = r.rows;
    } catch (e) {
      // Fallback caso tb_inv10 não exista ou esteja vazia
      console.error('[i10-scores] Error accessing tb_inv10:', e.message);
      source = 'empty';
      rows = [];
    }

    const data = rows.map((r) => ({
      code: String(r.ticker || '').trim().toUpperCase(),
      i10_score: r.i10_score != null ? Number(r.i10_score) : null,
      i10_rank: r.i10_rank != null ? Number(r.i10_rank) : null,
    }));

    // Provide a generated timestamp; if table has a fetched_at, expose the max as well
    let lastUpdated = null;
    try {
      // Usar scraped_at da tabela tb_inv10
      const { rows: t } = await db.query(`SELECT MAX(scraped_at) AS last FROM tb_inv10`);
      const raw = t?.[0]?.last;
      if (raw) lastUpdated = new Date(raw).toISOString();
    } catch {}

    const generatedAt = new Date().toISOString();
    return res.status(200).json({ ok: true, source, count: data.length, last_updated: lastUpdated, generated_at: generatedAt, data });
  } catch (err) {
    console.error('API /i10-scores error:', err);
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
