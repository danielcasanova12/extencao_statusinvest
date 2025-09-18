// Vercel Serverless Function: GET /api/checklist
// Retorna o ranking da tabela tb_formulamagica com preços da tb_statusinvest

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
        fm.ticker,
        fm.ticker as code,
        fm.mf_rank_final as final_rank,
        (
          CASE
            WHEN si.data->>'PRECO' IS NOT NULL AND si.data->>'PRECO' != ''
            THEN CAST(REPLACE(REPLACE(si.data->>'PRECO', '.', ''), ',', '.') AS numeric)
            ELSE NULL
          END
        ) as price
      FROM tb_formulamagica fm
      LEFT JOIN tb_statusinvest si ON fm.ticker = si.ticker
      WHERE fm.liquidez >= 1000000 AND fm.market_cap >= 90000000
      ORDER BY fm.mf_rank_final ASC;
    `;
    const { rows } = await db.query(sql);
    return res.status(200).json({ ok: true, count: rows.length, data: rows });
  } catch (err) {
    console.error('[api/checklist] error:', err);
    return res.status(500).json({ ok: false, error: String(err && (err.message || err)) });
  }
}