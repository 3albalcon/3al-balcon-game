// Minimal firebase-database.js stand-in, served in place of the real module.
const HUB = location.origin;
let tree = {}; let loaded = false; let serverOffset = 0;
const listeners = new Set();
const clone = v => v === undefined ? null : JSON.parse(JSON.stringify(v));
function at(p) { let o = tree; for (const k of p.split('/').filter(Boolean)) { if (o == null || typeof o !== 'object') return null; o = o[k]; } return o === undefined ? null : o; }
function snap(v) { return { val: () => clone(v), exists: () => v !== null && v !== undefined }; }
function valueFor(p) {
  if (p === '.info/connected') return loaded;
  if (p === '.info/serverTimeOffset') return serverOffset;
  return at(p);
}
function fire() { for (const l of listeners) { const v = valueFor(l.path); const j = JSON.stringify(v); if (j !== l.last) { l.last = j; try { l.cb(snap(v)); } catch (e) { console.error(e); } } } }
const es = new EventSource(HUB + '/events');
es.onmessage = e => { const m = JSON.parse(e.data); tree = m.tree; serverOffset = m.now - Date.now(); loaded = true; fire(); };
function resolveSv(v) { if (v && typeof v === 'object') { if (v['.sv'] === 'timestamp') return Date.now() + serverOffset; if (Array.isArray(v)) return v.map(resolveSv); const o = {}; for (const k in v) o[k] = resolveSv(v[k]); return o; } return v; }
function prune(v) { if (v === null || v === undefined) return undefined; if (Array.isArray(v)) { const a = v.map(prune).filter(x => x !== undefined); return a.length ? a : undefined; } if (typeof v === 'object') { const o = {}; for (const k in v) { const p = prune(v[k]); if (p !== undefined) o[k] = p; } return Object.keys(o).length ? o : undefined; } return v; }
function setAt(p, val) { const parts = p.split('/').filter(Boolean); let o = tree; for (let i = 0; i < parts.length - 1; i++) { if (typeof o[parts[i]] !== 'object' || o[parts[i]] === null) o[parts[i]] = {}; o = o[parts[i]]; } o[parts[parts.length - 1]] = clone(val); tree = prune(tree) || {}; }
function send(op, p, value) { return fetch(HUB + '/write', { method: 'POST', body: JSON.stringify({ op, path: p, value }) }).then(() => {}); }
export function getDatabase() { return {}; }
export function ref(db, p) { return { path: p || '' }; }
export function serverTimestamp() { return { '.sv': 'timestamp' }; }
export function onValue(r, cb) {
  const l = { path: r.path, cb, last: undefined }; listeners.add(l);
  if (loaded || r.path.startsWith('.info')) setTimeout(() => { if (listeners.has(l)) { const v = valueFor(l.path); l.last = JSON.stringify(v); cb(snap(v)); } }, 0);
  return () => listeners.delete(l);
}
export function set(r, v) { setAt(r.path, resolveSv(v)); fire(); return send('set', r.path, v); }
export function update(r, obj) { const ro = resolveSv(obj); for (const k in ro) setAt(r.path + '/' + k, ro[k]); fire(); return send('update', r.path, obj); }
export function get(r) { return Promise.resolve(snap(at(r.path))); }
export function goOnline() {} export function goOffline() {}
