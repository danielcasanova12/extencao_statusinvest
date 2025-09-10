// Vercel Serverless Function: /api/checklist
// Merges ranking_magic_checklist (base) with statusinvest_latest (prices/extra)
// - Includes ONLY tickers present in ranking_magic_checklist
// - Orders output by final_rank ASC
// - Optional query: ?limit=200 (default 500, max 1000)

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
    const limit = Math.min(parseInt(req.query.limit, 10) || 500, 1000);

    const sql = `
      SELECT
        r.ticker::text                AS ticker,
        r.final_rank::int             AS final_rank,
        r.i10_score                   AS i10_score,
        r.earning_yield               AS earning_yield,
        r.roic_pct                    AS roic_pct,
        r.liquidity                   AS liquidity,
        r.market_cap                  AS market_cap,
        s.ts_utc                      AS ts_utc,
        CAST(NULLIF(REPLACE(REPLACE(s.data->>'PRECO', '.', ''), ',', '.'), '') AS numeric) AS price
      FROM ranking_magic_checklist r
      LEFT JOIN statusinvest_latest s
        ON UPPER(s.ticker) = UPPER(r.ticker)
      ORDER BY r.final_rank ASC
      LIMIT $1
    `;

    const { rows } = await db.query(sql, [limit]);

    // Normalize output minimally and add a code alias
    const data = rows.map((r) => ({
      code: (r.ticker || '').toString().trim().toUpperCase(),
      ticker: r.ticker,
      final_rank: typeof r.final_rank === 'number' ? r.final_rank : parseInt(r.final_rank, 10),
      i10_score: r.i10_score,
      price: r.price != null ? Number(r.price) : null,
      // pass-through extras from ranking
      earning_yield: r.earning_yield,
      roic_pct: r.roic_pct,
      liquidity: r.liquidity,
      market_cap: r.market_cap,
      ts_utc: r.ts_utc,
    }));

    return res.status(200).json({ ok: true, count: data.length, data });
  } catch (err) {
    console.error('API /checklist error:', err);
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
