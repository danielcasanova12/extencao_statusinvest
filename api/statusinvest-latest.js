// Vercel Serverless Function: /api/statusinvest-latest
// - Reads DATABASE_URL
// - Queries table `statusinvest_latest`
// - Returns JSON
// - CORS for https://statusinvest.com.br and chrome extensions

let pool; // lazy init to avoid cold start overhead

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

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const pool = await getPool();

    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    // Feel free to adapt ordering/columns to your schema
    const sql = `SELECT * FROM statusinvest_latest LIMIT $1`;
    const { rows } = await pool.query(sql, [limit]);

    return res.status(200).json({ ok: true, count: rows.length, data: rows });
  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
