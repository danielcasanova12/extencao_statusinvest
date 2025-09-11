// Vercel Serverless Function: GET /api/fm-ranks
// Retorna o ranking da tabela tb_formulamagica

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

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });

  try {
    const db = await getPool();
    const sql = `
      SELECT
        ticker as code,
        mf_rank_final as final_rank
      FROM tb_formulamagica
      WHERE liquidez >= 1000000 AND market_cap >= 90000000
      ORDER BY mf_rank_final ASC;
    `;
    const { rows } = await db.query(sql);
    return res.status(200).json({ ok: true, count: rows.length, data: rows });
  } catch (err) {
    console.error('[api/fm-ranks] error:', err);
    return res.status(500).json({ ok: false, error: String(err && (err.message || err)) });
  }
}