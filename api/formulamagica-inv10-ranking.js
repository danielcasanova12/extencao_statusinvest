// Vercel Serverless Function: GET /api/formulamagica-inv10-ranking
// Retorna o ranking combinado da tb_formulamagica_inv10_simple

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
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 1000);

    const sql = `
      SELECT
        ticker as code,
        empresa,
        setor,
        market_cap,
        liquidez,
        roic,
        ey,
        rank_ey,
        rank_roic,
        mf_rank_final as original_mf_rank,
        true_count as inv10_count,
        rank_inv10,
        combined_index,
        final_rank_combined as final_rank,
        preco as price,
        generated_at
      FROM tb_formulamagica_inv10_simple
      ORDER BY final_rank_combined ASC
      LIMIT $1;
    `;
    
    const { rows } = await db.query(sql, [limit]);
    
    if (!rows.length) {
      return res.status(404).json({ 
        ok: false, 
        error: 'Nenhum dado encontrado. Execute /formulamagica/simple-inv10 primeiro.' 
      });
    }

    return res.status(200).json({ 
      ok: true, 
      count: rows.length, 
      data: rows 
    });
    
  } catch (err) {
    console.error('[api/formulamagica-inv10-ranking] error:', err);
    return res.status(500).json({ 
      ok: false, 
      error: String(err && (err.message || err)) 
    });
  }
}