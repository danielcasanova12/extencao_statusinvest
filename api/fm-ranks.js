// Vercel Serverless Function: /api/fm-ranks
// - Reads DATABASE_URL
// - Queries table `ranking_magic_checklist` for { code, final_rank }
// - Returns JSON
// - CORS for https://statusinvest.com.br and chrome extensions

let pool; // lazy init

function setCors(_req, res) {
  // Public CORS: allow any origin (read-only GET endpoints)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization'
  );
  res.setHeader('Access-Control-Max-Age', '86400');
}

async function getPool() {
  if (pool) return pool;
  const { Pool } = require('pg');
  const connStr = process.env.DATABASE_URL;
  if (!connStr) {
    throw new Error('Missing env: DATABASE_URL');
  }
  const needsSSL = !/localhost|127\.0\.0\.1/i.test(connStr);
  pool = new Pool({
    connectionString: connStr,
    ssl: needsSSL ? { rejectUnauthorized: false } : false,
  });
  return pool;
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });

  try {
    const pool = await getPool();

    // Minimal and explicit selection based on your schema
    const sql = `SELECT ticker, final_rank FROM ranking_magic_checklist ORDER BY final_rank ASC`;
    const { rows } = await pool.query(sql);
    const data = rows.map((r) => ({
      code: String(r.ticker || '').trim().toUpperCase(),
      final_rank: typeof r.final_rank === 'number' ? r.final_rank : parseInt(r.final_rank, 10) || null,
    }));

    // Try to discover a last-updated column and return the MAX value
    let lastUpdated = null;
    try {
      const { rows: cols } = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'ranking_magic_checklist'
           AND column_name IN ('updated_at','updatedat','updated_on','created_at','createdat','created_on','last_updated','modified_at','dt','date','timestamp','ts')
         ORDER BY CASE column_name
            WHEN 'updated_at' THEN 1
            WHEN 'updated_on' THEN 2
            WHEN 'last_updated' THEN 3
            WHEN 'modified_at' THEN 4
            WHEN 'created_at' THEN 5
            WHEN 'created_on' THEN 6
            WHEN 'timestamp' THEN 7
            WHEN 'ts' THEN 8
            WHEN 'dt' THEN 9
            WHEN 'date' THEN 10
            WHEN 'updatedat' THEN 11
            WHEN 'createdat' THEN 12
            ELSE 100 END ASC`
      );
      if (cols && cols.length) {
        const col = cols[0].column_name;
        const { rows: maxRows } = await pool.query(
          `SELECT MAX(${col}) AS last FROM ranking_magic_checklist`
        );
        const raw = maxRows?.[0]?.last;
        if (raw) lastUpdated = new Date(raw).toISOString();
      }
    } catch (e) {
      // ignore; lastUpdated remains null
    }

    const generatedAt = new Date().toISOString();
    return res.status(200).json({ ok: true, count: data.length, data, last_updated: lastUpdated, generated_at: generatedAt });
  } catch (err) {
    console.error('API /fm-ranks error:', err);
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
