/* GPHG 2026 Prediction Ballot — shared core (data, ballot codes, scoring). No dependencies. */
(function () {
  'use strict';

  const SITE = 'https://spencer-lightsource.github.io/gphg-game/';
  // Ballots lock when the jury's verdicts start being announced (Geneva time).
  const LOCK_AT = Date.parse('2026-11-07T18:00:00+01:00');
  const CAT_COUNT = 14;
  const SPECIALS = ['aiguille', 'audacity', 'revelation', 'chronometry'];
  const KEYS = { draft: 'gphg26.draft', ballot: 'gphg26.ballot', extra: 'gphg26.extraBallots', name: 'gphg26.name', token: 'gphg26.token', pooled: 'gphg26.pooled', poolkey: 'gphg26.poolkey' };

  let DATA = null;

  async function loadData() {
    if (DATA) return DATA;
    const res = await fetch('data/watches.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('Could not load data/watches.json (' + res.status + ')');
    DATA = await res.json();
    DATA.byId = DATA.watches;
    DATA.catIndex = Object.fromEntries(DATA.categories.map((c, i) => [c.id, i]));
    return DATA;
  }

  async function loadJSON(path, fallback) {
    try {
      const res = await fetch(path, { cache: 'no-cache' });
      if (!res.ok) return fallback;
      return await res.json();
    } catch (e) { return fallback; }
  }

  function watchesInCat(i) { return DATA.watches.slice(i * 6, i * 6 + 6); }
  function catOf(id) { return Math.floor(id / 6); }
  function thumb(id, i) { return 'assets/thumbs/' + String(id).padStart(2, '0') + '-' + (i || 0) + '.webp'; }
  function full(id, i) { return 'assets/watches/' + String(id).padStart(2, '0') + '-' + (i || 0) + '.webp'; }

  function emptyPicks() {
    return { cats: Array(CAT_COUNT).fill(null), aiguille: null, audacity: null, revelation: null, chronometry: null };
  }

  /* ---------- ballot code: v1|name|cccccccccccccc|aa|bb|rr|hh|ts|ck  → base64url ---------- */
  const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';
  function enc2(n) { return n == null ? '--' : B36[Math.floor(n / 36)] + B36[n % 36]; }
  function dec2(s) { if (s === '--') return null; const a = B36.indexOf(s[0]), b = B36.indexOf(s[1]); if (a < 0 || b < 0) return undefined; const n = a * 36 + b; return n < 84 ? n : undefined; }
  function checksum(s) { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1296; return enc2(h); }
  function b64u(str) { const bytes = new TextEncoder().encode(str); let bin = ''; bytes.forEach(b => bin += String.fromCharCode(b)); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64u(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s); const bytes = Uint8Array.from(bin, c => c.charCodeAt(0)); return new TextDecoder().decode(bytes); }

  function cleanName(s) { return Array.from(String(s || '').replace(/[|\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 40).join('').trim(); }
  function nameKey(s) { return String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function encodeBallot(b) {
    const name = cleanName(b.name);
    const cats = b.picks.cats.map((id, i) => id == null ? '-' : String(id - i * 6 + 1)).join('');
    const body = ['1', name, cats, enc2(b.picks.aiguille), enc2(b.picks.audacity), enc2(b.picks.revelation), enc2(b.picks.chronometry), Math.floor(b.ts / 1000).toString(36)].join('|');
    return b64u(body + '|' + checksum(body));
  }

  function decodeBallot(code) {
    try {
      code = String(code || '').trim();
      const m = code.match(/[#&?]b=([A-Za-z0-9_-]+)/); if (m) code = m[1];
      code = code.replace(/[^A-Za-z0-9_-]/g, '');
      if (!code) return null;
      const raw = unb64u(code);
      const parts = raw.split('|');
      if (parts.length !== 9 || parts[0] !== '1') return null;
      if (checksum(parts.slice(0, 8).join('|')) !== parts[8]) return null;
      const name = cleanName(parts[1]);
      if (!name) return null;
      const cs = parts[2];
      if (!/^[1-6-]{14}$/.test(cs)) return null;
      const picks = emptyPicks();
      for (let i = 0; i < CAT_COUNT; i++) picks.cats[i] = cs[i] === '-' ? null : i * 6 + (+cs[i] - 1);
      const sp = [parts[3], parts[4], parts[5], parts[6]].map(dec2);
      if (sp.some(v => v === undefined)) return null;
      [picks.aiguille, picks.audacity, picks.revelation, picks.chronometry] = sp;
      const ts = parseInt(parts[7], 36) * 1000;
      if (!isFinite(ts) || ts < Date.parse('2026-01-01') || ts > Date.parse('2027-12-31')) return null;
      return { name, picks, ts, code };
    } catch (e) { return null; }
  }

  function ballotURL(code) { return SITE + '?b=' + code; }

  /* ---------- scoring ---------- */
  // results: { 'time-only': id, ..., aiguille: id, audacity: id | null (not awarded) }  — a missing key = not announced yet.
  function prizeList() {
    const out = DATA.categories.map((c, i) => ({ key: c.id, kind: 'cat', idx: i, name: c.name, pts: c.pts }));
    DATA.specials.forEach(s => out.push({ key: s.id, kind: 'special', name: s.short, pts: s.pts, optional: s.optional }));
    return out;
  }
  function pickFor(picks, prize) { return prize.kind === 'cat' ? picks.cats[prize.idx] : picks[prize.key]; }
  function scoreBallot(picks, results) {
    let pts = 0, correct = 0, announced = 0, possible = 0;
    const detail = [];
    for (const p of prizeList()) {
      const pick = pickFor(picks, p);
      const has = results && Object.prototype.hasOwnProperty.call(results, p.key);
      const win = has ? results[p.key] : undefined;
      let state = 'pending';
      if (has) {
        announced++;
        if (win === null) state = 'none';            // prize not awarded
        else if (pick != null && pick === win) { state = 'hit'; pts += p.pts; correct++; }
        else state = 'miss';
      }
      if (!has || win !== null) possible += p.pts;
      detail.push({ prize: p, pick, win, state });
    }
    return { pts, correct, announced, possible, detail };
  }
  function maxPoints() { return prizeList().reduce((a, p) => a + p.pts, 0); }

  function rankBallots(ballots, results) {
    const rows = ballots.map(b => Object.assign({ ballot: b }, scoreBallot(b.picks, results)));
    rows.sort((a, b) => b.pts - a.pts || b.correct - a.correct || a.ballot.ts - b.ballot.ts || a.ballot.name.localeCompare(b.ballot.name));
    let rank = 0, prev = null;
    rows.forEach((r, i) => { const k = r.pts + ':' + r.correct; if (k !== prev) { rank = i + 1; prev = k; } r.rank = rank; });
    return rows;
  }

  // Merge ballots: one per name (case/whitespace/Unicode-insensitive); keep the latest that arrived before the lock.
  // A ballot is late if either its own timestamp or the pool's receipt time (b.received, when known) is at/after the lock.
  // Impersonation guard: the first submission carrying a device token claims the name; later submissions under that
  // name count only if they carry the same token (or no token at all, i.e. added by the commissioner).
  function mergeBallots(lists) {
    const groups = new Map();
    const late = [];
    const seen = new Set();
    for (const list of lists) for (const b of list || []) {
      if (!b || !b.name || !b.picks) continue;
      const dk = b.code || (nameKey(b.name) + '|' + b.ts);
      if (seen.has(dk)) continue; seen.add(dk);
      if (Math.max(b.ts || 0, b.received || 0) >= LOCK_AT) { late.push(b); continue; }
      const k = nameKey(b.name);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(b);
    }
    const ballots = [];
    for (const g of groups.values()) {
      g.sort((a, b) => (a.received || a.ts) - (b.received || b.ts) || a.ts - b.ts);
      const finals = g.filter(b => !b.draft);
      const pool = finals.length ? finals : g;          // a finished ballot always beats drafts under the same name
      const owner = (pool.find(b => b.token) || {}).token || null;
      const ok = pool.filter(b => !b.token || !owner || b.token === owner);
      ok.sort((a, b) => b.ts - a.ts || (b.received || 0) - (a.received || 0));
      if (ok.length) ballots.push(ok[0]);
    }
    return { ballots: ballots.sort((a, b) => a.ts - b.ts), late };
  }

  /* ---------- the live pool (Cloud Run + Firestore) ---------- */
  const POOL = 'https://gphg-pool-947634975635.us-central1.run.app';
  function deviceToken() {
    let t = lsGet(KEYS.token, '');
    if (!t) { const a = new Uint8Array(12); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => a[i] = Math.floor(Math.random() * 256)); t = Array.from(a, x => x.toString(16).padStart(2, '0')).join(''); lsSet(KEYS.token, t); }
    return t;
  }
  async function poolSubmit(ballot, token) {
    const res = await fetch(POOL + '/ballots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: ballot.code, name: ballot.name, ts: ballot.ts, token: token === undefined ? deviceToken() : token }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || ('pool ' + res.status));
    return j;
  }
  async function poolList() {
    const res = await fetch(POOL + '/ballots', { cache: 'no-store' });
    if (!res.ok) throw new Error('pool ' + res.status);
    const j = await res.json();
    const conv = (x, draft) => { const d = decodeBallot(x.code); if (!d) return null; d.received = Number(x.received) || d.ts; d.token = x.token || null; d.poolId = x.id || null; d.draft = !!draft; return d; };
    const list = (j.ballots || []).map(x => conv(x, false)).filter(Boolean);
    (j.drafts || []).forEach(x => { const d = conv(x, true); if (d) list.push(d); });
    return list;
  }
  // In-progress ballot: one per device, overwritten on every change. Sent as text/plain so the browser needs no preflight and can use keepalive on page hide.
  async function poolDraft(draft) {
    const res = await fetch(POOL + '/drafts', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ code: draft.code, name: draft.name, ts: draft.ts, token: deviceToken() }) });
    if (!res.ok) throw new Error('pool ' + res.status);
    return res.json();
  }
  function filled(picks) { return picks.cats.filter(x => x != null).length + (picks.aiguille != null ? 1 : 0); }
  async function poolResults() {
    const res = await fetch(POOL + '/results', { cache: 'no-store' });
    if (!res.ok) throw new Error('pool ' + res.status);
    return res.json();
  }
  async function poolDelete(poolId, key) {
    const res = await fetch(POOL + '/ballots/' + encodeURIComponent(poolId), { method: 'DELETE', headers: { 'X-Key': key } });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || ('pool ' + res.status));
    return j;
  }
  async function poolSetResults(results, key) {
    const res = await fetch(POOL + '/results', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Key': key }, body: JSON.stringify({ results }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || ('pool ' + res.status));
    return j;
  }

  // How alike two ballots are: per-prize agreement.
  function compareBallots(a, b) {
    const rows = prizeList().map(p => { const x = pickFor(a.picks, p), y = pickFor(b.picks, p); return { prize: p, a: x, b: y, same: x != null && x === y, both: x != null && y != null }; });
    const n = rows.filter(r => r.both).length, same = rows.filter(r => r.same).length;
    return { rows, same, n, pct: n ? Math.round(same / n * 100) : 0 };
  }

  // results.json hygiene: keep only known prize keys with null or a valid watch id (category prizes must point into their own category).
  function sanitizeResults(raw) {
    const clean = {}, dropped = [];
    if (!raw || typeof raw !== 'object') return { clean, dropped };
    const prizes = prizeList();
    for (const k of Object.keys(raw)) {
      const p = prizes.find(x => x.key === k);
      if (!p) { dropped.push(k + ' (unknown prize)'); continue; }
      let v = raw[k];
      if (v === null) { if (p.kind === 'special' && p.optional) { clean[k] = null; } else { dropped.push(k + ' (cannot be unawarded)'); } continue; }
      if (typeof v === 'string' && v.trim() !== '' && isFinite(+v)) v = +v;
      if (!Number.isInteger(v) || v < 0 || v >= DATA.watches.length) { dropped.push(k + ' (bad id ' + JSON.stringify(raw[k]) + ')'); continue; }
      if (p.kind === 'cat' && catOf(v) !== p.idx) { dropped.push(k + ' (id ' + v + ' is not in that category)'); continue; }
      clean[k] = v;
    }
    return { clean, dropped };
  }

  // A playful rating for a finished pool (out of 20 points).
  function rating(pts, announced) {
    if (!announced) return null;
    if (pts >= 14) return 'Oracle';
    if (pts >= 10) return 'Jury whisperer';
    if (pts >= 7) return 'Sharp eye';
    if (pts >= 4) return 'Enthusiast';
    return 'Wildcard';
  }
  // Everyone sharing the top rank.
  function leaders(rows) { return rows.filter(r => r.rank === 1); }

  function consensus(ballots) {
    const out = {};
    for (const p of prizeList()) {
      const counts = {};
      let n = 0;
      for (const b of ballots) { const id = pickFor(b.picks, p); if (id == null) continue; counts[id] = (counts[id] || 0) + 1; n++; }
      out[p.key] = { n, counts };
    }
    return out;
  }

  /* ---------- storage ---------- */
  function lsGet(k, fb) { try { const v = localStorage.getItem(k); return v == null ? fb : JSON.parse(v); } catch (e) { return fb; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  /* ---------- misc ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function fmtDate(ts) { try { return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } }
  function fmtLock() { try { return new Date(LOCK_AT).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }); } catch (e) { return 'Sat 7 Nov'; } }
  function isLocked(now) { return (now || Date.now()) >= LOCK_AT; }
  function watchLabel(id) { const w = DATA.watches[id]; return w ? w.brand + ' ' + w.name : '—'; }
  function possessive(name) { name = String(name || '').trim(); return /s$/i.test(name) ? name + '’' : name + '’s'; }

  window.GPHG = { SITE, POOL, LOCK_AT, CAT_COUNT, SPECIALS, KEYS, loadData, loadJSON, get data() { return DATA; }, watchesInCat, catOf, thumb, full, emptyPicks, cleanName, nameKey, encodeBallot, decodeBallot, ballotURL, prizeList, pickFor, scoreBallot, maxPoints, rankBallots, mergeBallots, sanitizeResults, leaders, rating, consensus, compareBallots, deviceToken, poolSubmit, poolList, poolDraft, filled, poolResults, poolSetResults, poolDelete, lsGet, lsSet, lsDel, esc, fmtDate, fmtLock, isLocked, watchLabel, possessive };
})();
