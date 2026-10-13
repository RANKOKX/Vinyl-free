'use strict';
/* 1) Colle ici ton Client ID Spotify (ou laisse vide : l'app te le demandera au premier lancement). */
const SPOTIFY_CLIENT_ID = '';

const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing';
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
}
async function token() {
  if (Date.now() > +LS.exp) { try { await tokenReq({ grant_type: 'refresh_token', refresh_token: LS.rt }); } catch (e) { logout(); throw e; } }
  return LS.at;
}
function logout() { ['at', 'rt', 'exp', 'last'].forEach(k => LS.removeItem(k)); S = null; showLogin(); }

async function api(path, method = 'GET') {
  const r = await fetch('https://api.spotify.com/v1' + path, { method, headers: { Authorization: 'Bearer ' + await token() } });
  if (r.status === 204) return null;
  if (r.status === 401 && !retried) { retried = true; LS.exp = 0; try { return await api(path, method); } finally { retried = false; } }
  if (r.status === 403) toast('Les commandes demandent Spotify Premium');
  else if (r.status === 404) toast('Ouvre Spotify sur un appareil');
  if (!r.ok) return null;
  const t = await r.text(); return t ? JSON.parse(t) : null;
}

/* ---------- État de lecture ---------- */
async function poll() {
  if (document.hidden) return;
  try {
    const j = await api('/me/player');
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

/* ---------- Démarrage rapide ---------- */
function showLogin() { $('#app').hidden = true; $('#login').hidden = false; $('#cfg').hidden = !!SPOTIFY_CLIENT_ID; $('#cid').value = LS.cid || ''; $('#ruri').value = REDIRECT; }
function start() {
  $('#login').hidden = true; $('#app').hidden = false;
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
