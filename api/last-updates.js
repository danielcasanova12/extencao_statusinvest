// Vercel Serverless Function: /api/last-updates
// - Returns last updated timestamp for multiple tables.

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

async function discoverTimestampColumn(client, tableName) {
  const preferred = [
    'generated_at', 'updated_at', 'scraped_at', 'updated_on', 'last_updated', 'refreshed_at',
    'refreshed_on', 'synced_at', 'modified_at', 'created_at', 'created_on',
    'timestamp', 'ts', 'dt', 'date', 'createdat', 'updatedat'
  ];
  const q = `
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = $1
  `;
  try {
    const { rows } = await client.query(q, [tableName]);
    const candidates = rows
      .filter(r => /timestamp|date/i.test(r.data_type || ''))
      .map(r => r.column_name);
    if (!candidates.length) return null;
    for (const name of preferred) {
      if (candidates.includes(name)) return name;
    }
    return candidates[0];
  } catch (e) {
    if (e.code === '42P01') return null; // undefined_table
    throw e;
  }
}

async function getMaxTimestamp(client, tableName) {
    const col = await discoverTimestampColumn(client, tableName);
    if (!col) return null;
    try {
        const { rows } = await client.query(`SELECT MAX("${col}") AS last FROM "${tableName}"`);
        const raw = rows?.[0]?.last;
        if (raw) {
            try { return new Date(raw).toISOString(); } catch { return String(raw); }
        }
        return null;
    } catch (e) {
        if (e.code === '42P01') return null; // undefined_table
        throw e;
    }
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });

  const tablesToCheck = ['tb_formulamagica', 'tb_inv10', 'tb_formulamagica_inv10'];

  try {
    const client = await getPool();
    const updates = {};
    for (const table of tablesToCheck) {
        updates[table] = await getMaxTimestamp(client, table);
    }

    const generatedAt = new Date().toISOString();
    return res.status(200).json({ ok: true, updates, generated_at: generatedAt });

  } catch (err) {
    console.error('API /last-updates error:', err);
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}