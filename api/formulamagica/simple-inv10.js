// Vercel Serverless Function: POST /api/formulamagica/simple-inv10
// Versão refatorada que combina Fórmula Mágica + Investidor 10

let pool;

function setCors(_req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
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

// Tabela de conversão true_count -> rank_inv10
function getTrueCountToRankInv10(trueCount) {
  const conversionTable = {
    1: 139.00,
    2: 121.75,
    3: 104.50,
    4: 87.25,
    5: 70.00,
    6: 52.75,
    7: 35.50,
    8: 18.25,
    9: 1.00
  };
  return conversionTable[trueCount] || 139.00; // 0 ou não mapeados = pior
}

async function ensureTable(db) {
  const sql = [
    'CREATE TABLE IF NOT EXISTS tb_formulamagica_inv10_simple (',
    '  ticker                text PRIMARY KEY,',
    '  empresa               text,',
    '  setor                 text,',
    '  market_cap            numeric,',
    '  liquidez              numeric,',
    '  margem_ebit           numeric,',
    '  roic                  numeric,',
    '  i10_score             numeric,',
    '  ebit                  numeric,',
    '  ev                    numeric,',
    '  ey                    numeric,',
    '  rank_ey               int,',
    '  rank_roic             int,',
    '  mf_rank               int,',
    '  mf_rank_final         int,',
    '  true_count            int,',
    '  rank_inv10            numeric,',
    '  combined_index        numeric,',
    '  final_rank_combined   int,',
    '  preco                 numeric,',
    '  generated_at          timestamptz default now()',
    ');'
  ].join('\n');
  await db.query(sql);
  
  // Garantir que as novas colunas existam (caso a tabela já existisse)
  const alterStatements = [
    'ALTER TABLE tb_formulamagica_inv10_simple ADD COLUMN IF NOT EXISTS rank_inv10 numeric',
    'ALTER TABLE tb_formulamagica_inv10_simple ADD COLUMN IF NOT EXISTS combined_index numeric',
    'ALTER TABLE tb_formulamagica_inv10_simple ADD COLUMN IF NOT EXISTS preco numeric',
    // Alterar tipo da coluna caso já exista como integer
    'ALTER TABLE tb_formulamagica_inv10_simple ALTER COLUMN rank_inv10 TYPE numeric USING rank_inv10::numeric'
  ];
  
  for (const alter of alterStatements) {
    try {
      await db.query(alter);
    } catch (err) {
      console.warn('[ensureTable] ALTER skip:', alter, err?.message || err);
    }
  }
}

async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  try {
    const db = await getPool();

    // 1) Buscar dados
    const sql = `
      SELECT 
        fm.ticker,
        fm.empresa,
        fm.setor,
        fm.market_cap,
        fm.liquidez,
        fm.margem_ebit,
        fm.roic,
        fm.ebit,
        fm.ev,
        fm.ey,
        fm.rank_ey,
        fm.rank_roic,
        fm.mf_rank,
        fm.mf_rank_final,
        fm.preco,
        COALESCE(i10.true_count, 0) as true_count
      FROM tb_formulamagica fm
      LEFT JOIN tb_inv10 i10 ON UPPER(fm.ticker) = UPPER(i10.ticker)
      WHERE fm.mf_rank_final IS NOT NULL
        AND fm.liquidez >= 1000000 
        AND fm.market_cap >= 90000000
      ORDER BY fm.mf_rank_final ASC
    `;

    const { rows } = await db.query(sql);
    if (!rows.length) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Nenhum dado encontrado. Execute /formulamagica/calcular primeiro.' 
      });
    }

    // 2) Calcular rank_inv10 e índice combinado
    const processedRows = rows.map(row => {
      const trueCount = Number(row.true_count) || 0;
      const rankEy = Number(row.rank_ey) || 0;
      const rankRoic = Number(row.rank_roic) || 0;
      const rankInv10 = getTrueCountToRankInv10(trueCount);
      const combinedIndex = rankRoic + rankEy + rankInv10;
      return { ...row, true_count: trueCount, rank_inv10: rankInv10, combined_index: combinedIndex };
    });

    // 3) Ordenar e rankear
    processedRows.sort((a, b) => {
      if (a.combined_index !== b.combined_index) return a.combined_index - b.combined_index;
      if (a.true_count !== b.true_count) return b.true_count - a.true_count;
      return a.ticker.localeCompare(b.ticker);
    });
    processedRows.forEach((row, i) => { row.final_rank_combined = i + 1; });

    // 4) Persistir
    await ensureTable(db);
    await db.query('TRUNCATE TABLE tb_formulamagica_inv10_simple');

    if (processedRows.length > 0) {
      const cols = [
        'ticker','empresa','setor','market_cap','liquidez','margem_ebit',
        'roic','i10_score','ebit','ev','ey','rank_ey','rank_roic',
        'mf_rank','mf_rank_final','true_count','rank_inv10','combined_index','final_rank_combined','preco'
      ];

      const params = [];
      const values = processedRows.map((row, idx) => {
        cols.forEach(col => params.push(row[col] != null ? row[col] : null));
        const base = idx * cols.length;
        const placeholders = cols.map((_, i) => `$${base + i + 1}`).join(',');
        return `(${placeholders})`;
      }).join(',');

      const insertSql = `INSERT INTO tb_formulamagica_inv10_simple (${cols.join(',')}) VALUES ${values}`;
      await db.query(insertSql, params);
    }

    return res.status(200).json({
      ok: true,
      processed: processedRows.length,
      generated_at: new Date().toISOString(),
      message: 'Ranking Formula Mágica + Investidor 10 criado com sucesso!'
    });

  } catch (err) {
    console.error('[formulamagica/simple-inv10] error:', err);
    return res.status(500).json({ ok: false, error: String(err && (err.message || err)) });
  }
}

// CommonJS export:
module.exports = handler;
