// Local stand-in for Firebase RTDB: serves the repo + a shared JSON tree over SSE.
// Usage (from the repo root): node tests/e2e/server.js . 8765
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(process.argv[2] || '.'); const PORT = +process.argv[3] || 8765;
let tree = {}; const clients = new Set();
function resolveSv(v) {
  if (v && typeof v === 'object') {
    if (v['.sv'] === 'timestamp') return Date.now();
    if (Array.isArray(v)) return v.map(resolveSv);
    const o = {}; for (const k in v) o[k] = resolveSv(v[k]); return o;
  }
  return v;
}
function prune(v) {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) { const a = v.map(prune).filter(x => x !== undefined); return a.length ? a : undefined; }
  if (typeof v === 'object') { const o = {}; for (const k in v) { const p = prune(v[k]); if (p !== undefined) o[k] = p; } return Object.keys(o).length ? o : undefined; }
  return v;
}
function setAt(root, p, val) {
  const parts = p.split('/').filter(Boolean);
  if (!parts.length) return prune(val) || {};
  let o = root;
  for (let i = 0; i < parts.length - 1; i++) { if (typeof o[parts[i]] !== 'object' || o[parts[i]] === null) o[parts[i]] = {}; o = o[parts[i]]; }
  o[parts[parts.length - 1]] = val;
  return prune(root) || {};
}
function apply(op, p, value) {
  value = resolveSv(value);
  if (op === 'set') tree = setAt(tree, p, value);
  else for (const k in value) tree = setAt(tree, (p ? p + '/' : '') + k, value[k]);
}
function broadcast() { const msg = `data: ${JSON.stringify({ tree, now: Date.now() })}\n\n`; for (const c of clients) c.write(msg); }
http.createServer((req, res) => {
  if (req.url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ tree, now: Date.now() })}\n\n`);
    clients.add(res); req.on('close', () => clients.delete(res)); return;
  }
  if (req.method === 'POST' && req.url === '/write') {
    let b = ''; req.on('data', d => b += d); req.on('end', () => {
      const { op, path: p, value } = JSON.parse(b); apply(op, p, value); res.end('{}'); broadcast();
    }); return;
  }
  if (req.url === '/dump') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(tree)); return; }
  const fp = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(fp, (e, d) => { if (e) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', fp.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream'); res.end(d); });
}).listen(PORT, '127.0.0.1', () => console.log('listening', PORT));
