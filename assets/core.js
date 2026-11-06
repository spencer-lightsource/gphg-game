/* GPHG 2026 Prediction Ballot — shared core (data, ballot codes, scoring). No dependencies. */
(function () {
  'use strict';

  const SITE = 'https://spencer-lightsource.github.io/gphg-game/';
  // Ballots lock when the jury's verdicts start being announced (Geneva time).
  const LOCK_AT = Date.parse('2026-11-07T18:00:00+01:00');
  const CAT_COUNT = 14;
  const SPECIALS = ['aiguille', 'audacity', 'revelation', 'chronometry'];
  const KEYS = { draft: 'gphg26.draft', ballot: 'gphg26.ballot', extra: 'gphg26.extraBallots', name: 'gphg26.name' };

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

  function encodeBallot(b) {
    const name = String(b.name || '').replace(/[|\n\r]/g, ' ').trim().slice(0, 40);
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
      const name = parts[1].trim().slice(0, 40);
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

  // Merge ballots: one per name (case-insensitive); keep the latest that was submitted before the lock.
  function mergeBallots(lists) {
    const map = new Map();
    const late = [];
    for (const list of lists) for (const b of list || []) {
      if (!b || !b.name || !b.picks) continue;
      if (b.ts > LOCK_AT) { late.push(b); continue; }
      const k = b.name.trim().toLowerCase();
      const cur = map.get(k);
      if (!cur || b.ts > cur.ts) map.set(k, b);
    }
    return { ballots: [...map.values()].sort((a, b) => a.ts - b.ts), late };
  }

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

  window.GPHG = { SITE, LOCK_AT, CAT_COUNT, SPECIALS, KEYS, loadData, loadJSON, get data() { return DATA; }, watchesInCat, catOf, thumb, full, emptyPicks, encodeBallot, decodeBallot, ballotURL, prizeList, pickFor, scoreBallot, maxPoints, rankBallots, mergeBallots, consensus, lsGet, lsSet, lsDel, esc, fmtDate, fmtLock, isLocked, watchLabel, possessive };
})();
