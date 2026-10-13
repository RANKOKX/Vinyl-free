'use strict';
/* 1) Colle ici ton Client ID Spotify (ou laisse vide : l'app te le demandera au premier lancement). */
const SPOTIFY_CLIENT_ID = '';

const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing user-library-read playlist-read-private';
const REDIRECT = location.origin + location.pathname;
const LS = localStorage, $ = s => document.querySelector(s);
const PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>';
let CID = SPOTIFY_CLIENT_ID || LS.cid || '', S = null, seeking = false, curCover = null, toastT, retried = false;
const scene = $('#scene');
const fmt = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const toast = m => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2800); };

/* ---------- Connexion Spotify (PKCE, sans serveur) ---------- */
const rnd = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/[+/=]/g, '').slice(0, n); };
async function login() {
  CID = SPOTIFY_CLIENT_ID || $('#cid').value.trim();
  if (!CID) { $('#cfg').open = true; return toast('Entre ton Client ID Spotify'); }
  LS.cid = CID; const v = rnd(64); LS.ver = v;
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
  const ch = btoa(String.fromCharCode(...new Uint8Array(h))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  location.href = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({ client_id: CID, response_type: 'code', redirect_uri: REDIRECT, scope: SCOPES, code_challenge_method: 'S256', code_challenge: ch });
}
async function tokenReq(body) {
  const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: CID, ...body }) });
  if (!r.ok) throw new Error('token');
  const j = await r.json();
  LS.at = j.access_token; LS.exp = Date.now() + j.expires_in * 1000 - 60000;
  if (j.refresh_token) LS.rt = j.refresh_token;
  if (j.scope) LS.sc = j.scope;
}
async function token() {
  if (Date.now() > +LS.exp) { try { await tokenReq({ grant_type: 'refresh_token', refresh_token: LS.rt }); } catch (e) { logout(); throw e; } }
  return LS.at;
}
function logout() { ['at', 'rt', 'exp', 'last', 'sc', 'likes'].forEach(k => LS.removeItem(k)); S = null; showLogin(); }

async function api(path, method = 'GET', body, quiet) {
  const h = { Authorization: 'Bearer ' + await token() }; if (body) h['Content-Type'] = 'application/json';
  const r = await fetch('https://api.spotify.com/v1' + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 204) return null;
  if (r.status === 401 && !retried) { retried = true; LS.exp = 0; try { return await api(path, method, body, quiet); } finally { retried = false; } }
  if (!quiet) { if (r.status === 403) toast('Les commandes demandent Spotify Premium'); else if (r.status === 404) toast('Ouvre Spotify sur un appareil'); }
  if (!r.ok) return false;
  const t = await r.text(); return t ? JSON.parse(t) : null;
}

/* ---------- État de lecture ---------- */
async function poll() {
  if (document.hidden) return;
  try {
    const j = await api('/me/player');
    if (j === false) return;
    const it = j && j.item;
    if (it) {
      S = {
        title: it.name,
        artist: it.artists ? it.artists.map(a => a.name).join(', ') : (it.show ? it.show.name : ''),
        cover: ((it.album && it.album.images) || it.images || [])[0]?.url || '',
        dur: it.duration_ms, pos: j.progress_ms, playing: j.is_playing,
        shuf: j.shuffle_state, rep: j.repeat_state, t: Date.now()
      };
      LS.last = JSON.stringify({ ...S, playing: false });
      $('#msg').innerHTML = '';
    } else {
      if (S) S.playing = false;
      $('#msg').innerHTML = 'Aucune lecture en cours. <a href="spotify:">Ouvrir Spotify</a> ·';
    }
    paint();
  } catch (e) { /* hors-ligne ou déconnecté */ }
}
const pos = () => S ? Math.min(S.dur, S.pos + (S.playing ? Date.now() - S.t : 0)) : 0;
function paint() {
  if (!S) return;
  $('#ti').textContent = S.title; $('#ar').textContent = S.artist;
  if (S.cover !== curCover) { curCover = S.cover; scene.style.setProperty('--cover', S.cover ? `url("${S.cover}")` : 'none'); if (S.cover) tint(S.cover); }
  $('#rec').classList.toggle('on', S.playing);
  $('#pp').innerHTML = S.playing ? PAUSE : PLAY;
  $('#sf').classList.toggle('act', !!S.shuf);
  $('#rp').classList.toggle('act', S.rep && S.rep !== 'off'); $('#rp').dataset.t = S.rep === 'track' ? '1' : '';
  tick();
}
function tick() {
  if (!S || seeking) return;
  const p = pos(), f = S.dur ? p / S.dur : 0;
  $('#fill').style.width = f * 100 + '%'; $('#cu').textContent = fmt(p); $('#du').textContent = fmt(S.dur);
  scene.style.setProperty('--arm', (S.playing ? 11 + 18 * f : -8) + 'deg');
}
function tint(url) {
  const im = new Image(); im.crossOrigin = 'anonymous';
  im.onload = () => { try {
    const c = document.createElement('canvas'); c.width = c.height = 8; const x = c.getContext('2d'); x.drawImage(im, 0, 0, 8, 8);
    const d = x.getImageData(0, 0, 8, 8).data; let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4, f = v => Math.round(v / n * .62);
    document.documentElement.style.setProperty('--c1', `rgb(${f(r)},${f(g)},${f(b)})`);
  } catch (e) {} };
  im.src = url;
}

/* ---------- Commandes ---------- */
const cmd = async (p, m = 'PUT') => { await api(p, m); setTimeout(poll, 400); };
function playpause() {
  if (!S) return toast('Lance un titre dans Spotify');
  S.pos = pos(); S.t = Date.now(); S.playing = !S.playing; paint();
  cmd(S.playing ? '/me/player/play' : '/me/player/pause');
}
$('#pp').onclick = playpause;
$('#nx').onclick = () => cmd('/me/player/next', 'POST');
$('#pv').onclick = () => cmd('/me/player/previous', 'POST');
$('#sf').onclick = () => { if (!S) return; S.shuf = !S.shuf; paint(); cmd('/me/player/shuffle?state=' + S.shuf); };
$('#rp').onclick = () => { if (!S) return; S.rep = { off: 'context', context: 'track', track: 'off' }[S.rep || 'off']; paint(); cmd('/me/player/repeat?state=' + S.rep); };

const sk = $('#seek');
const frac = e => { const r = $('#track').getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
const drag = e => { const f = frac(e); $('#fill').style.width = f * 100 + '%'; $('#cu').textContent = fmt(f * S.dur); scene.style.setProperty('--arm', 11 + 18 * f + 'deg'); return f; };
sk.onpointerdown = e => { if (!S) return; seeking = true; sk.setPointerCapture(e.pointerId); drag(e); };
sk.onpointermove = e => { if (seeking) drag(e); };
sk.onpointerup = e => { if (!seeking) return; const f = drag(e); seeking = false; S.pos = f * S.dur; S.t = Date.now(); cmd('/me/player/seek?position_ms=' + Math.round(S.pos)); };
sk.onpointercancel = () => { seeking = false; };

/* ---------- Scène : modes, rotation 3D, toucher le disque ---------- */
const plinth = $('#plinth');
for (let i = 1; i <= 10; i++) { const d = document.createElement('div'); d.className = 'layer'; d.style.transform = `translateZ(${-i * 1.3}px)`; plinth.prepend(d); }
function setMode(m) {
  scene.dataset.mode = m; LS.mode = m;
  document.querySelectorAll('#modes button').forEach(b => b.setAttribute('aria-pressed', b.dataset.m === m));
}
document.querySelectorAll('#modes button').forEach(b => b.onclick = () => setMode(b.dataset.m));
let x0 = null, moved = 0, rz = -30;
scene.onpointerdown = e => { x0 = e.clientX; moved = 0; };
scene.onpointermove = e => {
  if (x0 == null) return;
  const d = e.clientX - x0; x0 = e.clientX; moved += Math.abs(d);
  if (scene.dataset.mode === '3d' && moved > 6) { scene.classList.add('drag'); rz += d * .5; scene.style.setProperty('--rz', rz + 'deg'); }
};
const endDrag = e => { const tap = moved < 6 && e.target.closest && e.target.closest('#rw,#sleeve'); x0 = null; scene.classList.remove('drag'); if (tap) playpause(); };
scene.onpointerup = endDrag; scene.onpointercancel = () => { x0 = null; scene.classList.remove('drag'); };

/* ---------- Bibliothèque : pile de vinyles 3D ---------- */
const pile = $('#pile'), wrap = $('#pilewrap');
const hasLib = () => (LS.sc || '').includes('user-library-read');
let L = { tracks: [], ctx: null, next: false, id: 'likes' }, sid = 'likes', posf = 0, chipsBuilt = false, rid = 0, busy = false;
let chipsData = [{ id: 'likes', name: 'Titres likés' }];
function setTab(t) {
  $('#app').dataset.tab = t; $('#deck').hidden = t !== 'deck'; $('#lib').hidden = t !== 'lib';
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-pressed', b.dataset.t === t));
  if (t === 'lib') openLib();
}
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => setTab(b.dataset.t));
function needAuth() { $('#libmsg').innerHTML = 'Autorise l\u2019accès à ta bibliothèque Spotify.<br><button id="reauth" class="big">Autoriser</button>'; $('#reauth').onclick = login; $('#pti').textContent = ''; }
const tr = t => {
  if (!t || !t.uri || t.is_local || t.type === 'episode') return null;
  const im = (t.album && t.album.images) || [];
  return { uri: t.uri, title: t.name, artist: (t.artists || []).map(a => a.name).join(', '), cover: (im[0] || {}).url || '', thumb: (im[1] || im[0] || {}).url || '', dur: t.duration_ms };
};
function renderChips() {
  const c = $('#chips'); c.innerHTML = '';
  chipsData.forEach(p => { const b = document.createElement('button'); b.textContent = p.name; b.setAttribute('aria-pressed', p.id === sid); b.onclick = () => { sid = p.id; renderChips(); loadList(p.id); }; c.appendChild(b); });
}
async function openLib() {
  if (!hasLib()) return needAuth();
  $('#libmsg').innerHTML = '';
  if (chipsBuilt) return; chipsBuilt = true;
  try { const c = JSON.parse(LS.likes || 'null'); if (c && c.length) { L = { tracks: c, ctx: null, next: false, id: 'likes' }; build(); layout(); } } catch (e) {}
  renderChips(); loadList('likes');
  const j = await api('/me/playlists?limit=50', 'GET', null, true);
  if (j && j.items) { chipsData = [chipsData[0], ...j.items.filter(Boolean).map(p => ({ id: p.id, name: p.name }))]; renderChips(); }
}
async function loadList(id, more) {
  if (more) { if (busy) return; busy = true; }
  const my = ++rid, o = more ? L.tracks.length : 0;
  const j = await api(id === 'likes' ? `/me/tracks?limit=50&offset=${o}` : `/playlists/${id}/items?limit=50&offset=${o}`, 'GET', null, true);
  if (more) busy = false;
  if (my !== rid) return;
  if (!j) { if (id === 'likes') { if (!L.tracks.length) needAuth(); } else { $('#pti').textContent = 'Liste indisponible'; $('#par').textContent = 'Spotify ne donne pas accès à cette playlist'; } return; }
  const items = (j.items || []).map(x => x && tr(x.track || x.item)).filter(Boolean);
  if (!more) { L = { tracks: [], ctx: id === 'likes' ? null : 'spotify:playlist:' + id, next: false, id }; posf = 0; pile.innerHTML = ''; }
  L.tracks.push(...items); L.next = !!j.next;
  if (id === 'likes' && !more) LS.likes = JSON.stringify(items);
  build(); layout();
}
function build() {
  for (let i = pile.children.length; i < L.tracks.length; i++) { const d = document.createElement('div'); d.className = 'disc'; d.innerHTML = '<i></i>'; pile.appendChild(d); }
  while (pile.children.length > L.tracks.length) pile.lastChild.remove();
}
function layout() {
  const n = L.tracks.length;
  [...pile.children].forEach((el, i) => {
    const d = i - posf; let tf, op;
    if (d >= 0) { tf = `translateZ(${-d * 14}px)`; op = d > 6 ? 0 : 1 - Math.max(0, d - 4) * .5; }
    else { tf = `translateZ(${-d * 110}px) translateY(${d * 45}%)`; op = Math.max(0, 1 + d * 1.4); }
    el.style.transform = tf; el.style.opacity = op; el.style.visibility = op <= .01 ? 'hidden' : 'visible';
    if (!el.dataset.l && d > -2 && d < 12) { el.firstChild.style.backgroundImage = `url("${L.tracks[i].thumb}")`; el.dataset.l = 1; }
  });
  const k = Math.round(posf), t = L.tracks[k];
  if (t) { $('#pti').textContent = t.title; $('#par').textContent = t.artist; $('#pcount').textContent = `${k + 1} / ${n}${L.next ? '+' : ''}`; }
  else if (!n) { $('#pcount').textContent = ''; }
}
const more = () => { if (L.next && L.tracks.length - posf < 10) loadList(L.id, true); };
let pd = null, wt = 0;
wrap.onpointerdown = e => { if (!L.tracks.length) return; pd = { x: e.clientX, y: e.clientY, p: posf, m: 0 }; wrap.setPointerCapture(e.pointerId); pile.classList.add('nt'); };
wrap.onpointermove = e => {
  if (!pd) return;
  pd.m = Math.max(pd.m, Math.abs(pd.x - e.clientX) + Math.abs(pd.y - e.clientY));
  posf = Math.min(L.tracks.length - 1, Math.max(0, pd.p + ((pd.x - e.clientX) + (pd.y - e.clientY)) / 80)); layout();
};
wrap.onpointerup = () => { if (!pd) return; const tap = pd.m < 8; pd = null; pile.classList.remove('nt'); posf = Math.round(posf); layout(); more(); if (tap) playIdx(posf); };
wrap.onpointercancel = () => { pd = null; pile.classList.remove('nt'); };
wrap.onwheel = e => { e.preventDefault(); if (Date.now() - wt < 150 || !L.tracks.length) return; wt = Date.now(); posf = Math.min(L.tracks.length - 1, Math.max(0, Math.round(posf) + (e.deltaY + e.deltaX > 0 ? 1 : -1))); layout(); more(); };
async function playIdx(i) {
  const t = L.tracks[i]; if (!t) return;
  const body = L.ctx ? { context_uri: L.ctx, offset: { uri: t.uri } } : { uris: L.tracks.slice(i, i + 50).map(x => x.uri) };
  const r = await api('/me/player/play', 'PUT', body);
  if (r === false) return;
  S = { title: t.title, artist: t.artist, cover: t.cover, dur: t.dur || 1, pos: 0, playing: true, shuf: S && S.shuf, rep: S && S.rep, t: Date.now() };
  paint(); setTab('deck'); setTimeout(poll, 700);
}

/* ---------- Démarrage rapide ---------- */
function showLogin() { $('#app').hidden = true; $('#login').hidden = false; $('#cfg').hidden = !!SPOTIFY_CLIENT_ID; $('#cid').value = LS.cid || ''; $('#ruri').value = REDIRECT; }
function start() {
  $('#login').hidden = true; $('#app').hidden = false; setTab('deck');
  $('#out').onclick = logout;
  try { const l = JSON.parse(LS.last || 'null'); if (l) { S = l; paint(); } } catch (e) {}
  poll(); setInterval(poll, 4000); setInterval(tick, 250);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
}
$('#go').onclick = login;
$('#ruri').onclick = e => e.target.select();
(async function init() {
  setMode(LS.mode || 'top');
  const q = new URLSearchParams(location.search);
  if (q.get('code')) {
    try { await tokenReq({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: REDIRECT, code_verifier: LS.ver }); }
    catch (e) { toast('Connexion échouée, réessaie'); }
    history.replaceState(null, '', location.pathname);
  } else if (q.get('error')) { toast('Connexion refusée'); history.replaceState(null, '', location.pathname); }
  LS.rt ? start() : showLogin();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
