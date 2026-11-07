// GPHG 2026 ballot pool: tiny public API on Cloud Run, data in Firestore.
// POST /ballots {code,name,ts,token}  -> stores one ballot (idempotent by code)
// POST /drafts  {code,name,ts,token}  -> upserts an in-progress ballot (one per device token); removed on final submit
// GET  /ballots                       -> every ballot in the pool, plus in-progress drafts
// GET  /results                       -> winners JSON (or {})
// PUT  /results  (x-key header)       -> replace winners JSON
import http from 'node:http';
import { createHash } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';

const db = new Firestore();
const KEY = process.env.COMMISSIONER_KEY || '';
const PORT = process.env.PORT || 8080;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-Key', 'Access-Control-Max-Age': '86400' };

const send = (res, status, body) => { res.writeHead(status, { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve, reject) => { let data = ''; req.on('data', c => { data += c; if (data.length > 8192) { reject(new Error('too large')); req.destroy(); } }); req.on('end', () => resolve(data)); req.on('error', reject); });
const CODE_RE = /^[A-Za-z0-9_-]{20,240}$/;

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    if (url.pathname === '/ballots' && req.method === 'GET') {
      const [snap, dsnap] = await Promise.all([db.collection('ballots').orderBy('received').limit(1000).get(), db.collection('drafts').orderBy('updated').limit(500).get()]);
      return send(res, 200, {
        ballots: snap.docs.map(d => { const x = d.data(); return { id: d.id, code: x.code, name: x.name, ts: x.ts, token: x.token || null, received: x.received }; }),
        drafts: dsnap.docs.map(d => { const x = d.data(); return { id: d.id, code: x.code, name: x.name, ts: x.ts, token: x.token || null, received: x.updated }; })
      });
    }
    if (url.pathname === '/ballots' && req.method === 'POST') {
      let b; try { b = JSON.parse(await readBody(req) || '{}'); } catch (e) { return send(res, 400, { error: 'bad json' }); }
      const code = String(b.code || '').trim(), name = String(b.name || '').trim().slice(0, 80), ts = Number(b.ts), token = String(b.token || '').slice(0, 64);
      if (!CODE_RE.test(code)) return send(res, 400, { error: 'bad code' });
      if (!name) return send(res, 400, { error: 'name required' });
      if (!Number.isFinite(ts)) return send(res, 400, { error: 'bad ts' });
      const id = createHash('sha256').update(code).digest('hex').slice(0, 40);
      const ref = db.collection('ballots').doc(id);
      const received = Date.now();
      try {
        await ref.create({ code, name, ts, token, received, ua: String(req.headers['user-agent'] || '').slice(0, 160) });
        if (token) { try { await db.collection('drafts').doc(token).delete(); } catch (e) {} }
        return send(res, 201, { ok: true, id, received });
      }
      catch (e) { if (e.code === 6) { const cur = await ref.get(); return send(res, 200, { ok: true, id, received: cur.get('received'), duplicate: true }); } throw e; }
    }
    if (url.pathname === '/drafts' && req.method === 'POST') {
      let b; try { b = JSON.parse(await readBody(req) || '{}'); } catch (e) { return send(res, 400, { error: 'bad json' }); }
      const code = String(b.code || '').trim(), name = String(b.name || '').trim().slice(0, 80), ts = Number(b.ts), token = String(b.token || '').trim();
      if (!CODE_RE.test(code)) return send(res, 400, { error: 'bad code' });
      if (!name) return send(res, 400, { error: 'name required' });
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(token)) return send(res, 400, { error: 'token required' });
      if (!Number.isFinite(ts)) return send(res, 400, { error: 'bad ts' });
      const updated = Date.now();
      await db.collection('drafts').doc(token).set({ code, name, ts, token, updated });
      return send(res, 200, { ok: true, updated });
    }
    if (/^\/drafts\/[A-Za-z0-9_-]{8,64}$/.test(url.pathname) && req.method === 'DELETE') {
      if (!KEY || req.headers['x-key'] !== KEY) return send(res, 401, { error: 'bad key' });
      await db.collection('drafts').doc(url.pathname.split('/')[2]).delete();
      return send(res, 200, { ok: true });
    }
    if (/^\/ballots\/[A-Za-z0-9_-]{6,64}$/.test(url.pathname) && req.method === 'DELETE') {
      if (!KEY || req.headers['x-key'] !== KEY) return send(res, 401, { error: 'bad key' });
      await db.collection('ballots').doc(url.pathname.split('/')[2]).delete();
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/results' && req.method === 'GET') {
      const doc = await db.collection('meta').doc('results').get();
      return send(res, 200, { results: doc.exists ? (doc.get('results') || {}) : {}, updated: doc.exists ? doc.get('updated') : null });
    }
    if (url.pathname === '/results' && req.method === 'PUT') {
      if (!KEY || req.headers['x-key'] !== KEY) return send(res, 401, { error: 'bad key' });
      let b; try { b = JSON.parse(await readBody(req) || '{}'); } catch (e) { return send(res, 400, { error: 'bad json' }); }
      const results = b && typeof b.results === 'object' && b.results ? b.results : {};
      if (JSON.stringify(results).length > 4000) return send(res, 400, { error: 'too large' });
      await db.collection('meta').doc('results').set({ results, updated: Date.now() });
      return send(res, 200, { ok: true, results });
    }
    if (url.pathname === '/' || url.pathname === '/health') return send(res, 200, { ok: true, service: 'gphg-pool' });
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: 'server error' });
  }
}).listen(PORT, () => console.log('gphg-pool listening on ' + PORT));
