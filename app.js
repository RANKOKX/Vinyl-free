'use strict';
/* Colle ici ton Client ID Spotify (ou laisse vide : l'app te le demandera au premier lancement). */
const SPOTIFY_CLIENT_ID = '';

const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing user-library-read playlist-read-private';
const REDIRECT = location.origin + location.pathname;
const LS = localStorage, $ = s => document.querySelector(s);
const A0 = 9, A1 = 31, REST = -6; // angles du bras : début de disque, fin de disque, repos
let CID = SPOTIFY_CLIENT_ID || LS.cid || '', S = null, seeking = false, curCover = null, toastT, retried = false;
const scene = $('#scene');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmt = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const toast = m => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2800); };

/* ---------- Connexion Spotify (PKCE, sans serveur) ---------- */
const rnd = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/[+/=]/g, '').slice(0, n); };
async function login() {
  CID = SPOTIFY_CLIENT_ID || $('#cid').value.trim() || LS.cid || '';
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
function logout() { ['at', 'rt', 'exp', 'last', 'sc', 'likes', 'pl', 'al', 'me'].forEach(k => LS.removeItem(k)); S = null; showLogin(); }
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
        dur: it.duration_ms, pos: j.progress_ms, playing: j.is_playing, t: Date.now()
      };
      LS.last = JSON.stringify({ ...S, playing: false });
      $('#msg').innerHTML = '';
    } else {
      if (S) S.playing = false;
      $('#msg').innerHTML = 'Aucune lecture en cours. <a href="spotify:">Ouvrir Spotify</a>';
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
  $('#ppl').textContent = S.playing ? 'PAUSE' : 'PLAY';
  tick();
}
function tick() {
  if (!S || seeking) return;
  const p = pos(), f = S.dur ? p / S.dur : 0;
  $('#fill').style.width = f * 100 + '%'; $('#cu').textContent = fmt(p); $('#du').textContent = fmt(S.dur);
  scene.style.setProperty('--arm', (S.playing ? A0 + (A1 - A0) * f : REST) + 'deg');
}
function tint(url) { // couleurs du fond et du vinyle d'après la pochette
  const im = new Image(); im.crossOrigin = 'anonymous';
  im.onload = () => { try {
    const c = document.createElement('canvas'); c.width = c.height = 8; const x = c.getContext('2d'); x.drawImage(im, 0, 0, 8, 8);
    const d = x.getImageData(0, 0, 8, 8).data; let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4; r /= n; g /= n; b /= n;
    const s = Math.min(3, 205 / Math.max(r, g, b, 1)), R = document.documentElement.style;
    R.setProperty('--c1', `rgb(${Math.round(r * .5)},${Math.round(g * .5)},${Math.round(b * .5)})`);
    R.setProperty('--c2', `rgb(${Math.round(Math.min(255, r * s))},${Math.round(Math.min(255, g * s))},${Math.round(Math.min(255, b * s))})`);
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
const sk = $('#seek');
const frac = e => { const r = $('#track').getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1); };
const drag = e => { const f = frac(e); $('#fill').style.width = f * 100 + '%'; $('#cu').textContent = fmt(f * S.dur); scene.style.setProperty('--arm', A0 + (A1 - A0) * f + 'deg'); return f; };
sk.onpointerdown = e => { if (!S) return; seeking = true; sk.setPointerCapture(e.pointerId); drag(e); };
sk.onpointermove = e => { if (seeking) drag(e); };
sk.onpointerup = e => { if (!seeking) return; const f = drag(e); seeking = false; S.pos = f * S.dur; S.t = Date.now(); cmd('/me/player/seek?position_ms=' + Math.round(S.pos)); };
sk.onpointercancel = () => { seeking = false; };

/* ---------- Platine : épaisseur en bois, 3 dispositions, inclinaison ---------- */
const plinth = $('#plinth');
for (let i = 1; i <= 12; i++) { const d = document.createElement('div'); d.className = 'layer'; d.style.transform = `translateZ(${-i * 1.7}px)`; d.style.filter = `brightness(${1 - i * .02})`; plinth.prepend(d); }
let view = LS.view; if (!['cur', '3d', 'sleeve'].includes(view)) view = 'cur';
let tx = 0, ty = 0, b0 = null, g0 = null, gyro = false;
const orb = { rx: 48, rz: -28 }, cur = { rx: 20, ry: 0, rz: 0, sc: .97 };
function startGyro() {
  const go = () => addEventListener('deviceorientation', e => {
    if (e.beta == null) return; gyro = true;
    if (b0 === null) { b0 = e.beta; g0 = e.gamma; }
    b0 += (e.beta - b0) * .02; g0 += (e.gamma - g0) * .02; // le "zéro" suit lentement : seul le mouvement incline
    tx = clamp((e.beta - b0) * .9, -18, 18); ty = clamp((e.gamma - g0) * .9, -18, 18);
  });
  const D = window.DeviceOrientationEvent;
  if (D && typeof D.requestPermission === 'function') D.requestPermission().then(r => { if (r === 'granted') go(); }).catch(() => {}); else go();
}
document.addEventListener('click', startGyro, { once: true }); // iOS demande l'autorisation après un toucher
document.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && !gyro) { tx = (e.clientY / innerHeight - .5) * -22; ty = (e.clientX / innerWidth - .5) * 22; } });
const goal = () => view === '3d' ? { rx: orb.rx, ry: 0, rz: orb.rz, sc: .72 }
  : view === 'sleeve' ? { rx: 10 + tx * .7, ry: ty * .7, rz: 0, sc: 1 }
  : { rx: 20 + tx, ry: ty, rz: 0, sc: .97 };
(function loop() {
  if (!$('#deck').hidden) {
    const t = goal(); for (const k in cur) cur[k] += (t[k] - cur[k]) * .14;
    scene.style.setProperty('--rx', cur.rx.toFixed(2) + 'deg'); scene.style.setProperty('--ry', cur.ry.toFixed(2) + 'deg');
    scene.style.setProperty('--rz', cur.rz.toFixed(2) + 'deg'); scene.style.setProperty('--sc', cur.sc.toFixed(3));
  }
  requestAnimationFrame(loop);
})();
['gesturestart', 'gesturechange', 'gestureend'].forEach(n => document.addEventListener(n, e => e.preventDefault())); // pas de zoom

/* choix de la disposition (bouton en bas à droite) */
function setView(v) {
  view = v; LS.view = v; scene.dataset.mode = v;
  document.querySelectorAll('#vpop button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v));
  $('#vpop').hidden = true;
  if (v === '3d') { orb.rx = 48; orb.rz = -28; }
}
$('#vbtn').onclick = () => { $('#vpop').hidden = !$('#vpop').hidden; };
document.querySelectorAll('#vpop button').forEach(b => b.onclick = () => setView(b.dataset.v));
document.addEventListener('pointerdown', e => { if (!e.target.closest('#vpop,#vbtn')) $('#vpop').hidden = true; });

/* gestes sur la platine : glisser = tourner (3D libre), toucher le disque = lecture/pause */
const stage = $('#stage'); let pd = null;
stage.addEventListener('pointerdown', e => { pd = { lx: e.clientX, ly: e.clientY, sx: e.clientX, sy: e.clientY, m: 0, t: e.target }; stage.setPointerCapture(e.pointerId); });
stage.addEventListener('pointermove', e => {
  if (!pd) return;
  pd.m = Math.max(pd.m, Math.abs(e.clientX - pd.sx) + Math.abs(e.clientY - pd.sy));
  if (view === '3d' && pd.m > 6) { orb.rz += (e.clientX - pd.lx) * .55; orb.rx = clamp(orb.rx - (e.clientY - pd.ly) * .4, 0, 80); }
  pd.lx = e.clientX; pd.ly = e.clientY;
});
stage.addEventListener('pointerup', () => { const p = pd; pd = null; if (p && p.m < 8 && p.t.closest && p.t.closest('#rw,#sleeve')) playpause(); });
stage.addEventListener('pointercancel', () => { pd = null; });

/* ---------- Bibliothèque : piles d'enveloppes de vinyles ---------- */
const stackEl = $('#stack');
const hasLib = () => (LS.sc || '').includes('user-library-read');
const LIKED_COVER = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#4a2cf0"/><stop offset="1" stop-color="#9a92ff"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><path d="M50 74C29 59 23 49 23 40a14 14 0 0 1 27-4 14 14 0 0 1 27 4c0 9-6 19-27 34z" fill="#fff"/></svg>');
const likesItem = () => ({ kind: 'likes', id: 'likes', title: 'Titres likés', sub: LS.me || '', cover: LIKED_COVER, thumb: LIKED_COVER });
const N = { seg: LS.seg || 'pl', pl: [likesItem()], al: [], src: [], trail: [], title: '', ctx: null, item: null, loaded: false, searching: false };
const ST = { items: [], nodes: [], so: 0, vel: 0, raf: 0, sw: 360, h0: 180 };
const img = (a, k) => ((a && (a[k] || a[0])) || {}).url || '';
const names = a => (a || []).map(x => x.name).join(', ');

function setTab(t) {
  $('#app').dataset.tab = t; $('#deck').hidden = t !== 'deck'; $('#lib').hidden = t !== 'lib';
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-pressed', b.dataset.t === t));
  if (t === 'lib') { stSize(); stLayout(); if (!N.loaded) { N.loaded = true; loadLib(); } }
}
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => setTab(b.dataset.t));
function needAuth() { $('#libmsg').innerHTML = 'Autorise l\u2019accès à ta bibliothèque Spotify.<br><button id="reauth" class="big">Autoriser</button>'; $('#reauth').onclick = login; }

async function pages(path, max) {
  let out = [], o = 0;
  for (let p = 0; p < max; p++) {
    const j = await api(path + (path.includes('?') ? '&' : '?') + 'limit=50&offset=' + o, 'GET', null, true);
    if (!j) return p ? out : null;
    out.push(...(j.items || [])); if (!j.next) break; o += 50;
  }
  return out;
}
const tr = t => {
  if (!t || !t.uri || t.is_local || t.type === 'episode') return null;
  const im = (t.album && t.album.images) || [];
  return { uri: t.uri, title: t.name, sub: names(t.artists), cover: img(im, 0), thumb: img(im, 1), dur: t.duration_ms };
};
async function loadLib() {
  if (!hasLib()) return needAuth();
  $('#libmsg').innerHTML = '';
  try { const a = JSON.parse(LS.pl || 'null'), b = JSON.parse(LS.al || 'null'); if (a && a.length) N.pl = a; if (b) N.al = b; } catch (e) {}
  showTop();
  if (!LS.me) api('/me', 'GET', null, true).then(j => { if (j && j.display_name) { LS.me = j.display_name; N.pl[0] = likesItem(); if (!N.trail.length && N.seg === 'pl') showTop(); } });
  const [p, a] = await Promise.all([pages('/me/playlists', 4), pages('/me/albums', 4)]);
  if (p) { N.pl = [likesItem(), ...p.filter(Boolean).map(x => ({ kind: 'pl', id: x.id, title: x.name, sub: (x.owner && x.owner.display_name) || '', cover: img(x.images, 0), thumb: img(x.images, 1), uri: x.uri }))]; LS.pl = JSON.stringify(N.pl); }
  if (a) { N.al = a.map(x => x && x.album).filter(Boolean).map(al => ({ kind: 'al', id: al.id, title: al.name, sub: names(al.artists), cover: img(al.images, 0), thumb: img(al.images, 1) })); LS.al = JSON.stringify(N.al); }
  if (!p && !a) $('#libmsg').textContent = 'Impossible de charger ta bibliothèque. Réessaie via le menu.';
  if (!N.trail.length) showTop();
}
function showTop() { N.src = N.seg === 'pl' ? N.pl : N.al; topbar(); applyFilter(); }
function applyFilter() {
  const q = $('#sq').value.trim().toLowerCase();
  stSet(q ? N.src.filter(x => (x.title + ' ' + (x.sub || '')).toLowerCase().includes(q)) : N.src, 0);
}
function topbar() {
  const lv = N.trail.length > 0, s = N.searching;
  $('#menu').hidden = lv; $('#back').hidden = !lv;
  $('#seg').hidden = lv || s; $('#lt').hidden = !lv || s; $('#sq').hidden = !s;
  $('#lt').textContent = N.title;
  document.querySelectorAll('#seg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.s === N.seg));
}
document.querySelectorAll('#seg button').forEach(b => b.onclick = () => { N.seg = b.dataset.s; LS.seg = N.seg; showTop(); });
$('#sbtn').onclick = () => { N.searching = !N.searching; if (!N.searching) { $('#sq').value = ''; applyFilter(); } topbar(); if (N.searching) $('#sq').focus(); };
$('#sq').oninput = applyFilter;
$('#menu').onclick = () => { $('#menupop').hidden = !$('#menupop').hidden; };
$('#refresh').onclick = () => { $('#menupop').hidden = true; N.trail = []; N.item = null; loadLib(); };
$('#out').onclick = () => { $('#menupop').hidden = true; logout(); };
$('#back').onclick = () => {
  const t = N.trail.pop(); if (!t) return;
  N.item = null; N.ctx = null; $('#libmsg').innerHTML = ''; N.searching = false; $('#sq').value = '';
  N.src = N.seg === 'pl' ? N.pl : N.al; topbar(); stSet(t.items, t.so);
};

async function openItem(it) {
  N.trail.push({ so: ST.so, items: ST.items }); N.item = it; N.title = it.title; N.searching = false; $('#sq').value = '';
  topbar(); stSet([], 0); $('#libmsg').textContent = 'Chargement…';
  let r = null;
  if (it.kind === 'likes') { r = await pages('/me/tracks', 6); r = r && r.map(x => x && tr(x.track)); }
  else if (it.kind === 'pl') { r = await pages(`/playlists/${it.id}/items`, 6); r = r && r.map(x => x && tr(x.item || x.track)); }
  else { r = await pages(`/albums/${it.id}/tracks`, 6); r = r && r.map(t => t && t.uri ? { uri: t.uri, title: t.name, sub: names(t.artists), cover: it.cover, thumb: it.thumb || it.cover, dur: t.duration_ms } : null); }
  if (N.item !== it) return;
  const tracks = r && r.filter(Boolean);
  if (!tracks || !tracks.length) {
    const ctx = it.kind === 'pl' ? 'spotify:playlist:' + it.id : null;
    $('#libmsg').innerHTML = (tracks ? 'Aucun titre.' : 'Spotify ne donne pas accès aux titres de cette liste.') + (ctx ? '<br><button id="playall" class="big">Lire la playlist</button>' : '');
    if (ctx) $('#playall').onclick = async () => { if ((await api('/me/player/play', 'PUT', { context_uri: ctx })) !== false) { setTab('deck'); setTimeout(poll, 700); } };
    return;
  }
  $('#libmsg').textContent = '';
  N.ctx = it.kind === 'likes' ? null : it.kind === 'pl' ? 'spotify:playlist:' + it.id : 'spotify:album:' + it.id;
  N.src = tracks; applyFilter();
}
async function playTrack(it, i) {
  const body = N.ctx ? { context_uri: N.ctx, offset: { uri: it.uri } } : { uris: ST.items.slice(i, i + 50).map(x => x.uri) };
  if ((await api('/me/player/play', 'PUT', body)) === false) return;
  S = { title: it.title, artist: it.sub, cover: it.cover, dur: it.dur || 1, pos: 0, playing: true, t: Date.now() };
  paint(); setTab('deck'); setTimeout(poll, 700);
}
const tapItem = i => { const it = ST.items[i]; if (!it) return; N.trail.length ? playTrack(it, i) : openItem(it); };

/* pile 3D : chaque enveloppe montre sa tranche (nom) et sa pochette inclinée */
const BAND = 28, MINV = 22;
function stSize() { const w = stackEl.clientWidth || 360; ST.sw = Math.min(w * .9, 470); ST.h0 = ST.sw * .52; stackEl.style.setProperty('--sw', ST.sw + 'px'); stackEl.style.setProperty('--h0', ST.h0 + 'px'); }
addEventListener('resize', () => { stSize(); stLayout(); });
function stSet(items, so) { cancelAnimationFrame(ST.raf); ST.items = items; ST.so = so || 0; ST.vel = 0; stackEl.innerHTML = ''; ST.nodes = []; stSize(); stLayout(); }
function node(i) {
  if (ST.nodes[i]) return ST.nodes[i];
  const it = ST.items[i], d = document.createElement('div'); d.className = 'sl'; d.dataset.i = i;
  d.innerHTML = '<div class="face"></div><div class="spine"><b></b><span></span></div>';
  d.querySelector('b').textContent = it.title; d.querySelector('span').textContent = it.sub || '';
  stackEl.appendChild(d); return (ST.nodes[i] = d);
}
const visF = d => Math.max(MINV, ST.h0 * .74 * Math.pow(.5, Math.max(0, d)));
const rowH = d => d <= -1 ? 0 : d < 0 ? (BAND + visF(0)) * (1 + d) : BAND + visF(d);
function stLayout() {
  const n = ST.items.length, so = ST.so;
  const lo = Math.max(0, Math.floor(so) - 1), hi = Math.min(n - 1, Math.ceil(so) + 16);
  ST.nodes.forEach((el, i) => { if (el && (i < lo || i > hi)) el.style.display = 'none'; });
  let y = 4;
  for (let i = lo; i <= hi; i++) {
    const d = i - so, el = node(i), rh = rowH(d), vis = d < 0 ? Math.max(0, rh - BAND) : visF(d);
    const th = Math.acos(Math.min(1, vis / ST.h0)) * 57.2958, f = el.firstChild;
    el.style.display = 'block'; el.style.transform = `translateY(${y}px)`; el.style.zIndex = i; el.style.opacity = d < 0 ? Math.max(0, 1 + d) : 1;
    f.style.transform = `perspective(700px) rotateX(${-th}deg)`;
    if (!el.dataset.l && d < 12) { const u = ST.items[i].thumb || ST.items[i].cover; if (u) f.style.backgroundImage = `url("${u}")`; el.dataset.l = 1; }
    y += rh;
  }
}
const clampSo = x => clamp(x, 0, Math.max(0, ST.items.length - 1));
let sd = null;
stackEl.onpointerdown = e => {
  if (!ST.items.length) return; cancelAnimationFrame(ST.raf);
  sd = { y: e.clientY, so: ST.so, m: 0, ly: e.clientY, lt: performance.now(), v: 0, tgt: e.target.closest('.sl') };
  stackEl.setPointerCapture(e.pointerId);
};
stackEl.onpointermove = e => {
  if (!sd) return;
  const dy = e.clientY - sd.y, now = performance.now(); sd.m = Math.max(sd.m, Math.abs(dy));
  ST.so = clampSo(sd.so - dy / 85);
  sd.v = (sd.ly - e.clientY) / 85 / Math.max(1, now - sd.lt) * 600 + sd.v * .4; sd.ly = e.clientY; sd.lt = now; stLayout();
};
stackEl.onpointerup = () => {
  if (!sd) return; const s = sd; sd = null;
  if (s.m < 8) { if (s.tgt) tapItem(+s.tgt.dataset.i); return; }
  ST.vel = performance.now() - s.lt > 90 ? 0 : s.v; glide();
};
stackEl.onpointercancel = () => { sd = null; };
function glide() {
  let last = performance.now();
  const step = t => {
    const dt = Math.min(40, t - last) / 1000; last = t;
    ST.so = clampSo(ST.so + ST.vel * dt); ST.vel *= Math.pow(.04, dt); stLayout();
    if (Math.abs(ST.vel) > .05 && ST.so > 0 && ST.so < ST.items.length - 1) ST.raf = requestAnimationFrame(step);
  };
  ST.raf = requestAnimationFrame(step);
}
stackEl.onwheel = e => { e.preventDefault(); ST.so = clampSo(ST.so + e.deltaY / 90); stLayout(); };

/* ---------- Démarrage rapide ---------- */
function showLogin() { $('#app').hidden = true; $('#login').hidden = false; $('#cfg').hidden = !!SPOTIFY_CLIENT_ID; $('#cid').value = LS.cid || ''; $('#ruri').value = REDIRECT; }
function start() {
  $('#login').hidden = true; $('#app').hidden = false; setView(view); setTab('deck');
  try { const l = JSON.parse(LS.last || 'null'); if (l) { S = l; paint(); } } catch (e) {}
  poll(); setInterval(poll, 4000); setInterval(tick, 250);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
}
$('#go').onclick = login;
$('#ruri').onclick = e => e.target.select();
(async function init() {
  const q = new URLSearchParams(location.search);
  if (q.get('code')) {
    try { await tokenReq({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: REDIRECT, code_verifier: LS.ver }); }
    catch (e) { toast('Connexion échouée, réessaie'); }
    history.replaceState(null, '', location.pathname);
  } else if (q.get('error')) { toast('Connexion refusée'); history.replaceState(null, '', location.pathname); }
  LS.rt ? start() : showLogin();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
