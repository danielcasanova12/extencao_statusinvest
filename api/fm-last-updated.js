// Vercel Serverless Function: /api/fm-last-updated
// - Returns last updated timestamp for table `ranking_magic_checklist`
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

async function discoverTimestampColumn(client) {
  const preferred = [
    'updated_at','updated_on','last_updated','refreshed_at','refreshed_on','synced_at',
    'modified_at','created_at','created_on','timestamp','ts','dt','date','createdat','updatedat'
  ];
  const q = `
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'ranking_magic_checklist'
  `;
  const { rows } = await client.query(q);
  const candidates = rows
    .filter(r => /timestamp|date/i.test(r.data_type || ''))
    .map(r => r.column_name);
  if (!candidates.length) return null;
  // choose by preference order, otherwise pick the first
  for (const name of preferred) {
    if (candidates.includes(name)) return name;
  }
  return candidates[0];
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });

  try {
    const client = await getPool();
    const col = await discoverTimestampColumn(client);
    let last = null;
    if (col) {
      const { rows } = await client.query(`SELECT MAX(${col}) AS last FROM ranking_magic_checklist`);
      const raw = rows?.[0]?.last;
      if (raw) {
        try { last = new Date(raw).toISOString(); } catch { last = String(raw); }
      }
    }
    const generatedAt = new Date().toISOString();
    return res.status(200).json({ ok: true, table: 'ranking_magic_checklist', column: col, last_updated: last, generated_at: generatedAt });
  } catch (err) {
    console.error('API /fm-last-updated error:', err);
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
