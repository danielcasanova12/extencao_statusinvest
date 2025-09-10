// Vercel Serverless Function: POST /api/si-download
// - Faz download do CSV da página de "Busca Avançada" do StatusInvest
// - Sem navegador headless: baixa a página, encontra o link de download e faz requisição direta
// - Retorna o CSV e salva em /tmp

function setCors(_req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function isAuthorized(req) {
  const token = process.env.API_TOKEN || process.env.FM_API_TOKEN || process.env.SECRET_TOKEN;
  if (!token) return true;
  const hdr = String(req.headers['authorization'] || req.headers['Authorization'] || '').trim();
  if (!hdr.toLowerCase().startsWith('bearer ')) return false;
  const provided = hdr.slice(7).trim();
  return provided && provided === token;
}
const cheerio = require('cheerio');

function fileNameForToday() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  return `last_downloaddia${dd}.csv`;
}

function withTimeout(promise, ms, label) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  const p = (async () => {
    try {
      const r = await promise(ac.signal);
      return r;
    } finally { clearTimeout(t); }
  })();
  p.catch(() => {});
  return { promise: p, signal: ac.signal };
}

async function fetchText(url, headers = {}, timeoutMs = 45000) {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.text();
  } finally { clearTimeout(to); }
}

async function fetchBuffer(url, headers = {}, timeoutMs = 60000) {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const arr = await resp.arrayBuffer();
    return Buffer.from(arr);
  } finally { clearTimeout(to); }
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  const targetUrl = 'https://statusinvest.com.br/acoes/busca-avancada';

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
    };
    const html = await fetchText(targetUrl, headers, 45000);
    if (/cloudflare|attention required|captcha/i.test(html)) {
      return res.status(503).json({ ok: false, error: 'Bloqueado (Cloudflare/403?)' });
    }
    const $ = cheerio.load(html);
    let href = null;
    const byClass = $('a.btn-download').first();
    if (byClass && byClass.attr) href = byClass.attr('href') || href;
    if (!href) {
      $('a').each((_, el) => {
        const t = ($(el).text() || '').trim();
        const h = ($(el).attr('href') || '').trim();
        if (/download|exportar/i.test(t) || /download|export|csv/i.test(h)) { href = h; return false; }
      });
    }
    if (!href) return res.status(404).json({ ok: false, error: 'Link de download não encontrado' });
    const abs = href.startsWith('http') ? href : new URL(href, 'https://statusinvest.com.br').toString();
    const csvBuf = await fetchBuffer(abs, { ...headers, 'Accept': 'text/csv,*/*' }, 60000);

    const fs = require('fs');
    const path = require('path');
    const outName = fileNameForToday();
    const outPath = path.join('/tmp', outName);
    try { fs.writeFileSync(outPath, csvBuf); } catch {}

    return res.status(200).json({ ok: true, file: outName, size: csvBuf.length, content_type: 'text/csv', csv: csvBuf.toString('utf8') });
  } catch (err) {
    const msg = String(err && (err.message || err));
    if (/403|cloudflare|captcha/i.test(msg)) {
      return res.status(503).json({ ok: false, error: 'Bloqueado (Cloudflare/403?)', detail: msg });
    }
    console.error('[si-download] error:', err);
    return res.status(500).json({ ok: false, error: msg });
  }
}
