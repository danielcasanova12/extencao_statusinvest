// Vercel Serverless Function: /api/checklist-inv10
// - Returns data from tb_formulamagica_inv10 joined with latest prices
// - Used by the extension for the "FM + Inv10" rebalance plan

let pool;

function setCors(_req, res) {
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

function parseNumberBR(val) {
    if (val == null) return null;
    let s = String(val).trim();
    if (!s) return null;
    s = s.replace(/\./g, '').replace(/,/g, '.');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });

  try {
    const db = await getPool();
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

    const q = `
      SELECT
        fm.ticker,
        fm.mf_rank_final AS final_rank,
        si.data->>'PRECO' AS price_str
      FROM
        tb_formulamagica_inv10 fm
      LEFT JOIN
        tb_statusinvest si ON fm.ticker = si.ticker
      ORDER BY
        fm.mf_rank_final ASC
      LIMIT $1
    `;
    const { rows } = await db.query(q, [limit]);

    const data = rows.map((r) => ({ code: r.ticker, final_rank: r.final_rank != null ? Number(r.final_rank) : null, price: parseNumberBR(r.price_str) }));
    const generatedAt = new Date().toISOString();
    return res.status(200).json({ ok: true, count: data.length, generated_at: generatedAt, data });
  } catch (err) {
    console.error('API /checklist-inv10 error:', err);
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}