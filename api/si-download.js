// Vercel Serverless Function: GET/POST /api/si-download
// Agora retorna os dados persistidos em tb_formulamagica_inv10sum

let pool;

function setCors(_req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  try {
    const db = await getPool();
    const buildSql = (relation) => `
      SELECT
        fm.ticker,
        fm.empresa,
        fm.setor,
        fm.market_cap,
        fm.liquidez,
        fm.margem_ebit,
        fm.roic,
        fm.i10_score,
        fm.ebit,
        fm.ev,
        fm.ey,
        fm.rank_ey,
        fm.rank_roic,
        fm.mf_rank,
        fm.mf_rank_final,
        fm.composite_score,
        fm.mf_rank_final_inv10sum AS final_rank,
        fm.generated_at,
        (
          CASE
            WHEN si.data->>'PRECO' IS NOT NULL AND si.data->>'PRECO' != ''
            THEN CAST(REPLACE(REPLACE(si.data->>'PRECO', '.', ''), ',', '.') AS numeric)
            ELSE NULL
          END
        ) AS price
      FROM ${relation} fm
      LEFT JOIN tb_statusinvest si ON fm.ticker = si.ticker
      WHERE fm.liquidez >= 1000000 AND fm.market_cap >= 90000000
      ORDER BY
        fm.mf_rank_final_inv10sum NULLS LAST,
        fm.ticker ASC;
    `;

    let rows;
    try {
      ({ rows } = await db.query(buildSql('tb_formulamagica_inv10sum')));
    } catch (err) {
      const msg = String(err?.message || err);
      if (/tb_formulamagica_inv10sum/i.test(msg)) {
        try {
          ({ rows } = await db.query(buildSql('tb_formulamagica_inv10_sum')));
        } catch (fallbackErr) {
          const fbMsg = String(fallbackErr?.message || fallbackErr);
          if (/tb_formulamagica_inv10_sum/i.test(fbMsg)) {
            return res.status(200).json({ ok: true, count: 0, data: [], reason: 'no_data_table' });
          }
          throw fallbackErr;
        }
      } else {
        throw err;
      }
    }

    return res.status(200).json({ ok: true, count: rows.length, data: rows });
  } catch (err) {
    console.error('[api/si-download] error:', err);
    return res.status(500).json({ ok: false, error: String(err && (err.message || err)) });
  }
}
