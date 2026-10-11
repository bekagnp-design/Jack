import './styles.css';
import { supabase, api, ApiError } from './supabase.js';
import { t, getLang, setLang, onLangChange, COUNTRIES } from './i18n.js';
import { cardEl, cardLabel } from './cards.js';
import { sfx, unlock, soundEnabled, setSound } from './sound.js';
import * as E from '../supabase/functions/game/engine.js';

const app = document.getElementById('app');
const fx = document.getElementById('fx');
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- state ----------
const S = {
  session: null,
  user: null,
  profile: null,
  route: parseRoute(),
  room: null,
  seats: [],
  gameRow: null,      // { id, created_at, public }
  hand: [],
  handVersion: 0,
  pendingHands: {},   // game_id -> hand row that arrived before its game row
  sel: { card: null, take: new Set() },
  busy: false,
  channel: null,
  pollTimer: null,
  authMode: 'signin',
  authNotice: null,
  authError: null,
  rulesOpen: false,
  toast: null,
  toastTimer: null,
  copied: false,
  renderedVersion: 0,
  renderedDeal: 0,
  renderedRound: 0,
  wasMyTurn: false,
  phaseSounded: '',
};

const game = () => S.gameRow?.public ?? null;

// ---------- routing ----------
function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const [seg, arg] = h.split('/');
  if (seg === 'room' && arg) return { name: 'room', code: arg.toUpperCase() };
  return { name: 'home' };
}
function go(hash) { if (location.hash !== hash) location.hash = hash; else enterRoute(); }
window.addEventListener('hashchange', () => { S.route = parseRoute(); enterRoute(); });

// ---------- boot ----------
async function boot() {
  document.documentElement.lang = getLang();
  onLangChange(render);
  const { data: { session } } = await supabase.auth.getSession();
  applySession(session);
  supabase.auth.onAuthStateChange((event, sess) => {
    const had = !!S.session;
    applySession(sess);
    // Defer other Supabase calls out of the auth callback, as the client docs advise.
    setTimeout(async () => {
      if (event === 'SIGNED_OUT') { leaveRoomState(); render(); return; }
      if (sess && !had) { await loadProfile(); enterRoute(); } else render();
    }, 0);
  });
  if (S.session) await loadProfile();
  enterRoute();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.room) refreshRoom(); });
  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });
}

function applySession(session) {
  S.session = session;
  S.user = session?.user ?? null;
  if (!session) S.profile = null;
}

async function loadProfile() {
  if (!S.user) return;
  const { data } = await supabase.from('profiles').select('*').eq('id', S.user.id).maybeSingle();
  if (data) { S.profile = data; return; }
  // The signup trigger normally creates it; create it ourselves if it did not.
  const md = S.user.user_metadata || {};
  const row = { id: S.user.id, nickname: md.nickname || (S.user.email || 'player').split('@')[0], age: md.age || null, country: md.country || null, phone: md.phone || null, lang: getLang() };
  const { data: created } = await supabase.from('profiles').insert(row).select('*').maybeSingle();
  S.profile = created || row;
}

function enterRoute() {
  if (!S.session) { render(); return; }
  if (S.route.name === 'room') openRoom(S.route.code);
  else { leaveRoomState(); render(); }
}

// ---------- room data & realtime ----------
async function openRoom(code) {
  if (S.room && S.room.code === code) { render(); return; }
  leaveRoomState();
  render();
  try {
    S.busy = true;
    const { room } = await api('join_room', { code });
    S.room = room;
    await loadRoomData();
    subscribeRoom();
    startPolling();
  } catch (e) {
    toast(errMsg(e), 'err');
    leaveRoomState();
    go('#/');
  } finally {
    S.busy = false;
    render();
  }
}

function leaveRoomState() {
  if (S.channel) { supabase.removeChannel(S.channel); S.channel = null; }
  if (S.pollTimer) { clearInterval(S.pollTimer); S.pollTimer = null; }
  S.room = null; S.seats = []; S.gameRow = null; S.hand = []; S.handVersion = 0; S.pendingHands = {};
  S.sel = { card: null, take: new Set() };
  S.renderedVersion = 0; S.renderedDeal = 0; S.renderedRound = 0;
}

async function loadRoomData() {
  const roomId = S.room.id;
  const [{ data: room }, { data: seats }] = await Promise.all([
    supabase.from('rooms').select('*').eq('id', roomId).maybeSingle(),
    supabase.from('room_players').select('*').eq('room_id', roomId).order('seat'),
  ]);
  if (room) S.room = room;
  S.seats = seats || [];
  if (S.room.game_id) await loadGame(S.room.game_id);
}

async function loadGame(gameId) {
  const [{ data: g }, { data: h }] = await Promise.all([
    supabase.from('games').select('id, created_at, public, version').eq('id', gameId).maybeSingle(),
    supabase.from('game_hands').select('*').eq('game_id', gameId).eq('user_id', S.user.id).maybeSingle(),
  ]);
  if (g) acceptGameRow(g);
  if (h) acceptHandRow(h);
}

function acceptGameRow(row) {
  const cur = S.gameRow;
  if (cur && cur.id === row.id && row.public.version < cur.public.version) return;
  if (cur && cur.id !== row.id && row.created_at < cur.created_at) return;
  const changedGame = !cur || cur.id !== row.id;
  S.gameRow = { id: row.id, created_at: row.created_at, public: row.public };
  if (changedGame) {
    S.sel = { card: null, take: new Set() };
    S.hand = []; S.handVersion = 0;
    const pending = S.pendingHands[row.id];
    if (pending) { acceptHandRow(pending); delete S.pendingHands[row.id]; }
  }
  // Drop a selection that no longer makes sense.
  if (S.sel.card && !S.hand.includes(S.sel.card)) S.sel = { card: null, take: new Set() };
  const table = game()?.deal?.table || [];
  for (const c of [...S.sel.take]) if (!table.includes(c)) S.sel.take.delete(c);
}

function acceptHandRow(row) {
  if (!S.gameRow || S.gameRow.id !== row.game_id) { S.pendingHands[row.game_id] = row; return; }
  if (row.version < S.handVersion) return;
  S.hand = row.cards || [];
  S.handVersion = row.version;
  if (S.sel.card && !S.hand.includes(S.sel.card)) S.sel = { card: null, take: new Set() };
}

function subscribeRoom() {
  const roomId = S.room.id;
  S.channel = supabase.channel(`room:${roomId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, (p) => {
      if (p.eventType === 'DELETE') { toast(t('err.room_not_found'), 'err'); leaveRoomState(); go('#/'); return; }
      const prevGame = S.room?.game_id;
      S.room = p.new;
      if (S.room.game_id && S.room.game_id !== prevGame) loadGame(S.room.game_id).then(render);
      render();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${roomId}` }, async () => {
      const { data } = await supabase.from('room_players').select('*').eq('room_id', roomId).order('seat');
      S.seats = data || [];
      render();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `room_id=eq.${roomId}` }, (p) => {
      if (p.new) { acceptGameRow(p.new); render(); }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game_hands', filter: `user_id=eq.${S.user.id}` }, (p) => {
      if (p.new) { acceptHandRow(p.new); render(); }
    })
    .subscribe();
}

// Safety net: realtime can drop events on flaky connections.
function startPolling() {
  if (S.pollTimer) clearInterval(S.pollTimer);
  S.pollTimer = setInterval(() => { if (!document.hidden) refreshRoom(); }, 6000);
}

async function refreshRoom() {
  if (!S.room || S.busy) return;
  try {
    const before = JSON.stringify([S.room.status, S.room.game_id, S.seats.map((s) => s.user_id || s.name), game()?.version, S.handVersion]);
    await loadRoomData();
    const after = JSON.stringify([S.room.status, S.room.game_id, S.seats.map((s) => s.user_id || s.name), game()?.version, S.handVersion]);
    if (before !== after) render();
  } catch { /* next tick */ }
}

// ---------- actions ----------
async function run(fn) {
  if (S.busy) return;
  S.busy = true; render();
  try { await fn(); }
  catch (e) {
    toast(errMsg(e), 'err');
    if (e instanceof ApiError && (e.code === 'conflict' || e.code === 'not_your_turn' || e.code === 'illegal_capture')) await refreshRoom();
  } finally { S.busy = false; render(); }
}

function errMsg(e) {
  if (e instanceof ApiError) {
    const key = `err.${e.code}`;
    const s = t(key);
    return s === key ? (e.message || t('err.generic')) : s;
  }
  return e?.message || t('err.generic');
}

function toast(msg, kind = '') {
  S.toast = { msg, kind };
  clearTimeout(S.toastTimer);
  S.toastTimer = setTimeout(() => { S.toast = null; render(); }, 3200);
  render();
}

async function playSelected(take) {
  const g = game();
  const card = S.sel.card;
  if (!g || !card) return;
  const gameId = S.gameRow.id;
  const takeList = [...take];
  await run(async () => {
    await api('play', { game_id: gameId, card, take: takeList });
    // Optimistic update so the table reacts at once; the server's row replaces it shortly.
    const me = mySeat();
    const d = g.deal;
    if (d && d.current === me && game() === g) {
      S.hand = S.hand.filter((c) => c !== card);
      if (takeList.length) {
        d.table = d.table.filter((c) => !takeList.includes(c));
        d.capturedCounts[me] += 1 + takeList.length;
        d.lastCapturer = me;
      } else d.table.push(card);
      d.handCounts[me] = S.hand.length;
      d.current = (me + 1) % g.n;
      d.log = [...(d.log || []), { type: 'play', seat: me, card, take: takeList, sweep: takeList.length > 0 && d.table.length === 0 }].slice(-12);
      g.version += 1;
    }
    S.sel = { card: null, take: new Set() };
  });
}

// ---------- helpers ----------
function mySeat() {
  const g = game();
  if (g) { const p = g.players.find((p) => p.id === S.user?.id && !p.bot); if (p) return p.seat; }
  const s = S.seats.find((p) => p.user_id === S.user?.id);
  return s ? s.seat : -1;
}

function playerName(p) {
  if (!p) return '';
  if (p.bot || p.is_bot) {
    const seat = p.seat ?? 0;
    return t('room.botN', { n: seat + 1 });
  }
  return p.name;
}

function nameAt(seat) {
  const g = game();
  if (g) return playerName(g.players[seat]);
  const s = S.seats.find((p) => p.seat === seat);
  return playerName(s);
}

function initial(name) { return (name || '?').trim().charAt(0).toUpperCase(); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function roomLink(code) { return `${location.origin}${location.pathname}#/room/${code}`; }

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
  }
  S.copied = true; render();
  setTimeout(() => { S.copied = false; render(); }, 1500);
}

// ---------- rendering ----------
function render() {
  const snapshot = S.route.name === 'room' && game() ? snapshotRects() : null;
  cueSounds();
  let html = '';
  if (!S.session) html = viewAuth();
  else if (S.route.name === 'room') html = S.room ? (showGame() ? viewGame() : viewLobby()) : viewLoading();
  else html = viewHome();
  if (S.rulesOpen) html += viewRules();
  if (S.toast) html += `<div class="toast ${S.toast.kind}" role="status">${esc(S.toast.msg)}</div>`;
  app.innerHTML = html;
  bind();
  if (snapshot && showGame()) animateChanges(snapshot);
  if (showGame()) { const g = game(); S.renderedVersion = g.version; S.renderedDeal = g.dealNo; S.renderedRound = g.deal?.handRound || 0; }
}

function showGame() {
  return !!(S.room && game() && (S.room.status === 'playing' || S.room.status === 'finished') && S.room.game_id === S.gameRow?.id);
}

// Turn chime and end-of-deal sounds come from state transitions, not from renders.
function cueSounds() {
  const g = game();
  if (!g || !showGame()) { S.wasMyTurn = false; S.phaseSounded = ''; return; }
  const me = mySeat();
  const myTurn = g.phase === 'deal' && g.deal?.current === me;
  if (myTurn && !S.wasMyTurn && S.renderedVersion > 0) sfx.turn();
  S.wasMyTurn = myTurn;
  const key = `${S.gameRow.id}:${g.dealNo}:${g.phase}`;
  if ((g.phase === 'deal_over' || g.phase === 'game_over') && S.phaseSounded !== key) {
    if (S.renderedVersion > 0) {
      const r = g.dealResults[g.dealResults.length - 1];
      if (g.phase === 'game_over') sfx.gameOver(g.winner === me);
      else if (r) sfx.dealOver(me >= 0 && r.points[me] >= Math.max(...r.points));
    }
    S.phaseSounded = key;
  }
}

function soundButton() {
  const on = soundEnabled();
  const icon = on
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/></svg>';
  return `<button class="btn small ghost icon" data-act="sound" aria-label="${esc(on ? t('sound.on') : t('sound.off'))}" title="${esc(on ? t('sound.on') : t('sound.off'))}">${icon}</button>`;
}

function viewTopbar(extra = '') {
  return `
  <header class="topbar">
    <button class="brand" data-act="home" aria-label="${esc(t('app.title'))}">
      <span class="logo">11</span><span class="logo">${esc(t('app.title'))}</span>
    </button>
    <div class="right">
      ${extra}
      ${S.profile ? `<span class="who">${esc(S.profile.nickname)}</span>` : ''}
      ${soundButton()}
      <button class="btn small ghost" data-act="lang">${esc(t('lang.switch'))}</button>
      <button class="btn small ghost" data-act="rules">${esc(t('nav.rules'))}</button>
      ${S.session ? `<button class="btn small ghost" data-act="signout">${esc(t('nav.signout'))}</button>` : ''}
    </div>
  </header>`;
}

function viewLoading() {
  return viewTopbar() + `<main class="page"><p class="muted">…</p></main>`;
}

function viewAuth() {
  const up = S.authMode === 'signup';
  const countries = COUNTRIES.map((c) => `<option value="${c[0]}">${esc(getLang() === 'ka' ? c[2] : c[1])}</option>`).join('');
  return viewTopbar() + `
  <main class="page">
    <section class="hero">
      <h1>${esc(t('app.title'))}</h1>
      <p>${esc(t('app.tagline'))}</p>
      <div class="deco" id="deco"></div>
    </section>
    <section class="panel auth">
      <div class="tabs">
        <button type="button" class="${up ? '' : 'on'}" data-act="authmode" data-mode="signin">${esc(t('auth.signin'))}</button>
        <button type="button" class="${up ? 'on' : ''}" data-act="authmode" data-mode="signup">${esc(t('auth.signup'))}</button>
      </div>
      ${S.authNotice ? `<div class="notice">${esc(S.authNotice)}</div>` : ''}
      ${S.authError ? `<div class="error">${esc(S.authError)}</div>` : ''}
      <form id="auth-form" autocomplete="on">
        ${up ? `<label>${esc(t('auth.nickname'))}<input name="nickname" id="f-nick" required minlength="2" maxlength="24" autocomplete="nickname"></label>` : ''}
        <label>${esc(t('auth.email'))}<input name="email" id="f-email" type="email" required autocomplete="email"></label>
        <label>${esc(t('auth.password'))}<input name="password" id="f-pass" type="password" required minlength="6" autocomplete="${up ? 'new-password' : 'current-password'}" placeholder="${up ? esc(t('auth.passwordHint')) : ''}"></label>
        ${up ? `
        <div class="row">
          <label>${esc(t('auth.age'))}<input name="age" id="f-age" type="number" min="5" max="120" required inputmode="numeric"></label>
          <label>${esc(t('auth.country'))}<select name="country" id="f-country" required><option value="">${esc(t('auth.pickCountry'))}</option>${countries}</select></label>
        </div>
        <label>${esc(t('auth.phone'))}<input name="phone" id="f-phone" type="tel" autocomplete="tel"></label>` : ''}
        <button class="btn primary" type="submit" ${S.busy ? 'disabled' : ''}>${esc(up ? t('auth.signup') : t('auth.signin'))}</button>
        <p class="muted">${esc(up ? t('auth.haveAccount') : t('auth.noAccount'))}
          <a href="#" data-act="authmode" data-mode="${up ? 'signin' : 'signup'}">${esc(up ? t('auth.signin') : t('auth.signup'))}</a></p>
      </form>
    </section>
  </main>`;
}

function viewHome() {
  const name = S.profile?.nickname || '';
  return viewTopbar() + `
  <main class="page">
    <section class="hero">
      <h1>${esc(t('app.title'))}</h1>
      <p>${esc(t('app.tagline'))}</p>
      <div class="deco" id="deco"></div>
      ${name ? `<p class="muted">${esc(t('home.hello', { name }))}</p>` : ''}
    </section>
    <div class="grid-2">
      <section class="panel">
        <h2>${esc(t('home.create'))}</h2>
        <form id="create-form">
          <div class="row">
            <label>${esc(t('home.players'))}
              <select name="max_players" id="f-players"><option value="2">2</option><option value="3">3</option><option value="4">4</option></select></label>
            <label>${esc(t('home.target'))}
              <select name="target_score" id="f-target">
                <option value="11">${esc(t('home.points', { n: 11 }))}</option>
                <option value="21">${esc(t('home.points', { n: 21 }))}</option>
                <option value="31">${esc(t('home.points', { n: 31 }))}</option>
                <option value="51">${esc(t('home.points', { n: 51 }))}</option>
              </select></label>
          </div>
          <p class="muted">${esc(t('home.createHint'))}</p>
          <button class="btn primary" type="submit" ${S.busy ? 'disabled' : ''}>${esc(t('home.createBtn'))}</button>
        </form>
      </section>
      <section class="panel">
        <h2>${esc(t('home.join'))}</h2>
        <form id="join-form">
          <label>${esc(t('home.code'))}<input name="code" id="f-code" required maxlength="6" autocapitalize="characters" autocomplete="off" spellcheck="false" style="letter-spacing:.2em;text-transform:uppercase;font-family:var(--font-display);font-size:22px"></label>
          <button class="btn primary" type="submit" ${S.busy ? 'disabled' : ''}>${esc(t('home.joinBtn'))}</button>
        </form>
      </section>
    </div>
  </main>`;
}

function viewLobby() {
  const r = S.room;
  const host = S.seats.find((s) => s.user_id === r.host_id);
  const isHost = r.host_id === S.user.id;
  const seats = [];
  for (let i = 0; i < r.max_players; i++) {
    const s = S.seats.find((p) => p.seat === i);
    if (!s) {
      seats.push(`<div class="seat-card empty"><div class="avatar bot">·</div><div class="name">${esc(t('room.empty'))}</div>
        ${isHost ? `<button class="btn small" data-act="addbot" ${S.busy ? 'disabled' : ''}>${esc(t('room.addBot'))}</button>` : ''}</div>`);
    } else if (s.is_bot) {
      seats.push(`<div class="seat-card"><div class="avatar bot">⚙</div><div class="name">${esc(playerName(s))}</div>
        <div class="chips"><span class="chip">${esc(t('room.bot'))}</span></div>
        ${isHost ? `<button class="btn small ghost" data-act="removeseat" data-seat="${i}" ${S.busy ? 'disabled' : ''}>${esc(t('room.remove'))}</button>` : ''}</div>`);
    } else {
      const chips = [];
      if (s.user_id === r.host_id) chips.push(`<span class="chip gold">${esc(t('room.host'))}</span>`);
      if (s.user_id === S.user.id) chips.push(`<span class="chip">${esc(t('room.you'))}</span>`);
      seats.push(`<div class="seat-card"><div class="avatar">${esc(initial(s.name))}</div><div class="name">${esc(s.name)}</div>
        <div class="chips">${chips.join('')}</div>
        ${isHost && s.user_id !== S.user.id ? `<button class="btn small ghost" data-act="removeseat" data-seat="${i}" ${S.busy ? 'disabled' : ''}>${esc(t('room.remove'))}</button>` : ''}</div>`);
    }
  }
  const finished = r.status === 'finished';
  return viewTopbar() + `
  <main class="page">
    <section class="code-hero">
      <p class="muted">${esc(t('home.code'))}</p>
      <div class="code">${esc(r.code)}</div>
      <p class="muted">${esc(t('score.target', { n: r.target_score }))} · ${r.max_players} ${esc(t('room.players')).toLowerCase()} · ${esc(t(`room.status.${r.status}`))}</p>
    </section>
    <section class="panel">
      <h2>${esc(t('room.invite'))}</h2>
      <p class="muted">${esc(t('room.inviteHint'))}</p>
      <div class="linkbox"><input id="invite-link" readonly value="${esc(roomLink(r.code))}">
        <button class="btn" data-act="copylink">${esc(S.copied ? t('room.copied') : t('room.copy'))}</button></div>
    </section>
    <section class="panel">
      <h2>${esc(t('room.seats'))}</h2>
      <div class="seats">${seats.join('')}</div>
      ${isHost ? `
      <div class="row">
        <label>${esc(t('room.players'))}
          <select id="set-players" data-act="setplayers" ${S.busy ? 'disabled' : ''}>
            ${[2, 3, 4].map((n) => `<option value="${n}" ${n === r.max_players ? 'selected' : ''}>${n}</option>`).join('')}
          </select></label>
        <label>${esc(t('room.target'))}
          <select id="set-target" data-act="settarget" ${S.busy ? 'disabled' : ''}>
            ${[11, 21, 31, 51].map((n) => `<option value="${n}" ${n === r.target_score ? 'selected' : ''}>${esc(t('home.points', { n }))}</option>`).join('')}
          </select></label>
      </div>
      <p class="muted">${esc(t('room.startHint'))}</p>
      <div class="row">
        <button class="btn primary" data-act="start" ${S.busy ? 'disabled' : ''}>${esc(finished ? t('score.playAgain') : t('room.start'))}</button>
        <button class="btn ghost danger" data-act="leave" ${S.busy ? 'disabled' : ''}>${esc(t('room.leave'))}</button>
      </div>` : `
      <p class="muted">${esc(t('room.waitingHost', { name: host?.name || t('room.host') }))}</p>
      <div class="row"><button class="btn ghost danger" data-act="leave" ${S.busy ? 'disabled' : ''}>${esc(t('room.leave'))}</button></div>`}
    </section>
  </main>`;
}

function seatPositions(n) {
  if (n === 2) return ['pos-top'];
  if (n === 3) return ['pos-topleft', 'pos-topright'];
  return ['pos-left', 'pos-top', 'pos-right'];
}

function viewGame() {
  const g = game();
  const d = g.deal;
  const me = mySeat();
  const anchor = me >= 0 ? me : 0;
  const myTurn = g.phase === 'deal' && d.current === me;
  const positions = seatPositions(g.n);
  const others = [];
  for (let i = 1; i < g.n; i++) others.push((anchor + i) % g.n);

  const seatsHtml = others.map((seat, i) => {
    const p = g.players[seat];
    const name = playerName(p);
    const backs = Array.from({ length: d?.handCounts[seat] || 0 }, () => '<div class="card card-back"></div>').join('');
    return `<div class="seat ${positions[i]} ${d?.current === seat ? 'current' : ''}" data-seat="${seat}">
      <div class="avatar ${p.bot ? 'bot' : ''}">${p.bot ? '⚙' : esc(initial(name))}</div>
      <div class="name">${esc(name)}</div>
      <div class="meta">
        <span class="chip">${esc(t('game.score', { n: g.totals[seat] }))}</span>
        <span class="chip pile" title="${esc(t('game.taken'))}"><i class="pile-ico"></i>${d ? d.capturedCounts[seat] : 0}</span>
        ${g.dealer === seat ? `<span class="chip gold" title="${esc(t('game.dealer'))}">D</span>` : ''}
      </div>
      <div class="mini-hand">${backs}</div>
    </div>`;
  }).join('');

  // Cards are DOM-built in mountGameCards() so they get real pips; this is their mount point.
  const table = d?.table || [];
  const tableHtml = `<div class="table-cards" id="table-cards" data-empty="${esc(t('game.table'))}"></div>`;

  const last = lastMoveText(g);
  const deckHtml = d && d.deckCount > 0
    ? `<div class="deck" title="${esc(t('game.deck', { n: d.deckCount }))}"><div class="stack"><div class="card card-back"></div>${d.deckCount > 8 ? '<div class="card card-back"></div>' : ''}${d.deckCount > 20 ? '<div class="card card-back"></div>' : ''}</div><span class="count">${d.deckCount}</span></div>`
    : '';

  // Status & actions.
  let status = '';
  let sumHtml = '';
  let takeBtn = '';
  let layBtn = '';
  if (g.phase === 'deal') {
    if (me < 0) status = t('game.waitingFor', { name: nameAt(d.current) });
    else if (!myTurn) status = t('game.waitingFor', { name: nameAt(d.current) });
    else if (!S.sel.card) status = t('game.selectCard');
    else {
      const r = E.rankOf(S.sel.card);
      const groups = E.legalCaptures(S.sel.card, table);
      if (!groups.length) status = t('game.noCapture');
      else if (r === 'J') status = t('game.furtiTakes');
      else if (r === 'Q' || r === 'K') status = t('game.pictureTakes');
      else status = t('game.pickCards');
    }
    if (myTurn && S.sel.card) {
      const take = [...S.sel.take];
      const legal = take.length > 0 && E.isLegalCapture(S.sel.card, table, take);
      if (E.isNumber(S.sel.card)) {
        const sum = E.valueOf(S.sel.card) + take.reduce((a, c) => a + E.valueOf(c), 0);
        sumHtml = `<span class="sum ${sum === 11 && legal ? 'ok' : ''}">${sum}</span>`;
      }
      takeBtn = `<button class="btn primary" data-act="take" ${legal && !S.busy ? '' : 'disabled'}>${esc(t('game.take', { n: take.length + 1 }))}</button>`;
      layBtn = `<button class="btn" data-act="lay" ${S.busy ? 'disabled' : ''}>${esc(t('game.layDown'))}</button>`;
    }
  }

  const overlay = (g.phase === 'deal_over' || g.phase === 'game_over') ? viewScore(g, me) : '';

  return `
  <div class="game ${myTurn ? 'my-turn' : ''}">
    <div class="game-top">
      <div class="l"><span class="code">${esc(S.room.code)}</span><span>${esc(t('game.deal', { n: g.dealNo }))}</span><span class="only-wide">·</span><span class="only-wide">${esc(t('score.target', { n: g.targetScore }))}</span>${d ? `<span class="only-wide">·</span><span class="only-wide">${esc(t('game.deck', { n: d.deckCount }))}</span>` : ''}</div>
      <div class="r">
        ${soundButton()}
        <button class="btn small ghost" data-act="lang" aria-label="${esc(t('lang.switch'))}"><span class="only-wide">${esc(t('lang.switch'))}</span><span class="only-narrow">${esc(t('lang.short'))}</span></button>
        <button class="btn small ghost" data-act="rules" aria-label="${esc(t('nav.rules'))}"><span class="only-wide">${esc(t('nav.rules'))}</span><span class="only-narrow">?</span></button>
        <button class="btn small ghost danger" data-act="leave" aria-label="${esc(t('room.leave'))}"><span class="only-wide">${esc(t('room.leave'))}</span><span class="only-narrow">✕</span></button>
      </div>
    </div>
    <div class="arena">
      ${seatsHtml}
      <div class="felt n${g.n}">
        ${tableHtml}
        <div class="last-move">${esc(last)}</div>
        ${deckHtml}
      </div>
    </div>
    <div class="me ${myTurn ? 'current' : ''}" data-seat="${me}">
      <div class="me-info">
        ${me >= 0 ? `<div class="avatar">${esc(initial(S.profile?.nickname || nameAt(me)))}</div><span class="name">${esc(S.profile?.nickname || nameAt(me))}</span>
        <span class="chip">${esc(t('game.score', { n: g.totals[me] }))}</span>
        <span class="chip pile" title="${esc(t('game.taken'))}"><i class="pile-ico"></i>${d ? d.capturedCounts[me] : 0}</span>
        ${g.dealer === me ? `<span class="chip gold" title="${esc(t('game.dealer'))}">D</span>` : ''}` : ''}
      </div>
      <div class="hand" id="hand"></div>
    </div>
    <div class="actions">
      <div class="status-line ${myTurn ? 'turn' : ''}">${esc(myTurn && !S.sel.card ? t('game.yourTurn') + ' · ' + status : status)}</div>
      <div class="buttons">${sumHtml}${takeBtn}${layBtn}</div>
    </div>
    ${overlay}
  </div>`;
}

function mountGameCards() {
  const g = game();
  if (!g) return;
  const d = g.deal;
  const me = mySeat();
  const myTurn = g.phase === 'deal' && d?.current === me;
  const table = d?.table || [];
  const hints = S.sel.card ? new Set(E.captureHints(S.sel.card, table)) : new Set();

  const tc = document.getElementById('table-cards');
  if (tc) {
    for (const c of table) {
      const el = cardEl(c, { interactive: myTurn });
      if (S.sel.take.has(c)) el.classList.add('selected');
      else if (hints.has(c)) el.classList.add('hint');
      if (myTurn && S.sel.card && (hints.has(c) || S.sel.take.has(c))) el.classList.add('pick');
      else if (myTurn && S.sel.card) el.classList.add('dim');
      el.addEventListener('click', () => toggleTake(c));
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTake(c); } });
      tc.appendChild(el);
    }
  }
  const hand = document.getElementById('hand');
  if (hand) {
    for (const c of S.hand) {
      const el = cardEl(c, { interactive: true });
      el.classList.add('pick');
      if (S.sel.card === c) el.classList.add('selected');
      el.addEventListener('click', () => pickHand(c));
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickHand(c); } });
      hand.appendChild(el);
    }
  }
}

function pickHand(c) {
  const g = game();
  if (!g || !S.hand.includes(c)) return;
  if (S.sel.card === c) { S.sel = { card: null, take: new Set() }; render(); return; }
  const table = g.deal?.table || [];
  const groups = E.legalCaptures(c, table);
  const take = new Set(groups.length === 1 ? groups[0] : []);
  S.sel = { card: c, take };
  render();
}

function toggleTake(c) {
  const g = game();
  if (!g || !S.sel.card) return;
  const table = g.deal?.table || [];
  const hints = new Set(E.captureHints(S.sel.card, table));
  if (S.sel.take.has(c)) S.sel.take.delete(c);
  else if (hints.has(c)) {
    // Pictures take exactly one card; a jack takes the whole group; numbers build a group.
    const r = E.rankOf(S.sel.card);
    if (r === 'Q' || r === 'K') S.sel.take = new Set([c]);
    else if (r === 'J') S.sel.take = new Set(E.legalCaptures(S.sel.card, table)[0]);
    else S.sel.take.add(c);
  } else return;
  render();
}

function lastMoveText(g) {
  const d = g.deal;
  if (!d || !d.log?.length) return '';
  const ev = d.log[d.log.length - 1];
  const me = mySeat();
  const who = (seat) => (seat === me ? t('log.you') : nameAt(seat));
  if (ev.type === 'play') {
    const card = cardLabel(ev.card);
    if (!ev.take?.length) return t('log.laid', { name: who(ev.seat), card });
    if (ev.sweep) return t('log.sweep', { name: who(ev.seat), card });
    return t('log.took', { name: who(ev.seat), n: ev.take.length + 1, card });
  }
  if (ev.type === 'deal') return t('log.dealt');
  return '';
}

function viewScore(g, me) {
  const r = g.dealResults[g.dealResults.length - 1];
  if (!r) return '';
  const over = g.phase === 'game_over';
  const isHost = S.room.host_id === S.user.id;
  const rows = g.players.map((p, i) => `
    <tr class="${i === me ? 'is-me' : ''}">
      <td>${esc(playerName(p))}</td>
      <td class="${r.mostCards === i ? 'win' : ''}">${r.cards[i]}</td>
      <td class="${r.mostClubs === i ? 'win' : ''}">${r.clubs[i]}</td>
      <td class="${r.tenD === i ? 'win' : ''}">${r.tenD === i ? '✓' : ''}</td>
      <td class="${r.twoC === i ? 'win' : ''}">${r.twoC === i ? '✓' : ''}</td>
      <td>+${r.points[i]}</td>
      <td class="total">${r.totals[i]}</td>
    </tr>`).join('');
  const winnerName = over ? (g.winner === me ? t('score.youWin') : t('score.winner', { name: playerName(g.players[g.winner]) })) : '';
  let buttons = '';
  if (!over) buttons = me >= 0 ? `<button class="btn primary" data-act="nextdeal" ${S.busy ? 'disabled' : ''}>${esc(t('score.next'))}</button>` : '';
  else buttons = (isHost
    ? `<button class="btn primary" data-act="start" ${S.busy ? 'disabled' : ''}>${esc(t('score.playAgain'))}</button>
       <button class="btn" data-act="tolobby" ${S.busy ? 'disabled' : ''}>${esc(t('room.toLobby'))}</button>`
    : `<span class="muted">${esc(t('score.waitingHost', { name: nameAt(S.seats.find((s) => s.user_id === S.room.host_id)?.seat ?? 0) }))}</span>`)
    + `<button class="btn ghost" data-act="leave" ${S.busy ? 'disabled' : ''}>${esc(t('room.leave'))}</button>`;
  return `
  <div class="overlay">
    <div class="sheet">
      ${over ? `<div class="winner">${esc(winnerName)}</div><h2 style="text-align:center">${esc(t('score.gameOver'))}</h2>` : `<h2>${esc(t('score.title', { n: r.dealNo }))}</h2>`}
      <p class="muted">${esc(t('score.mostCards'))} · ${esc(t('score.mostClubs'))} · ${esc(t('score.tenDPt'))} · ${esc(t('score.twoCPt'))} · ${esc(t('score.target', { n: g.targetScore }))}</p>
      <div style="overflow-x:auto"><table class="score">
        <thead><tr><th>${esc(t('score.player'))}</th><th>${esc(t('score.cards'))}</th><th>${esc(t('score.clubs'))}</th><th>${esc(t('score.tenD'))}</th><th>${esc(t('score.twoC'))}</th><th>${esc(t('score.points'))}</th><th>${esc(t('score.total'))}</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      ${r.leftover?.length && r.leftoverTo != null ? `<p class="muted">${esc(t('score.leftover', { name: playerName(g.players[r.leftoverTo]) }))}</p>` : ''}
      <div class="actions-row">${buttons}</div>
    </div>
  </div>`;
}

function viewRules() {
  const items = [1, 2, 3, 4, 5, 6, 7].map((i) => `<li>${esc(t(`rules.${i}`))}</li>`).join('');
  return `<div class="overlay" data-act="closerules"><div class="sheet rules" data-stop="1">
    <h2>${esc(t('rules.title'))}</h2><ol>${items}</ol>
    <div class="actions-row"><button class="btn" data-act="closerules">${esc(t('nav.back'))}</button></div></div></div>`;
}

// ---------- binding ----------
function bind() {
  mountGameCards();
  const deco = document.getElementById('deco');
  if (deco) for (const c of ['AS', '10D', 'JC']) deco.appendChild(cardEl(c));
  for (const el of document.querySelectorAll('.ribbon')) el.textContent = t('game.furti');

  app.querySelectorAll('[data-act]').forEach((el) => {
    const act = el.dataset.act;
    const handler = (e) => {
      if (el.tagName === 'A') e.preventDefault();
      if (act === 'closerules' && e.target !== el && el.classList.contains('overlay')) return;
      doAction(act, el, e);
    };
    if (el.tagName === 'SELECT') el.addEventListener('change', handler);
    else el.addEventListener('click', handler);
  });

  const authForm = document.getElementById('auth-form');
  if (authForm) authForm.addEventListener('submit', onAuthSubmit);
  const createForm = document.getElementById('create-form');
  if (createForm) createForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(createForm);
    run(async () => {
      const { room } = await api('create_room', { max_players: fd.get('max_players'), target_score: fd.get('target_score') });
      go(`#/room/${room.code}`);
    });
  });
  const joinForm = document.getElementById('join-form');
  if (joinForm) joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = String(new FormData(joinForm).get('code') || '').trim().toUpperCase();
    if (code) go(`#/room/${code}`);
  });
}

function doAction(act, el) {
  switch (act) {
    case 'home': go('#/'); break;
    case 'lang': setLang(getLang() === 'ka' ? 'en' : 'ka'); if (S.user) supabase.from('profiles').update({ lang: getLang() }).eq('id', S.user.id).then(() => {}); break;
    case 'rules': S.rulesOpen = true; render(); break;
    case 'sound': setSound(!soundEnabled()); if (soundEnabled()) sfx.tick(); render(); break;
    case 'closerules': S.rulesOpen = false; render(); break;
    case 'signout': run(async () => { await supabase.auth.signOut(); go('#/'); }); break;
    case 'authmode': S.authMode = el.dataset.mode; S.authError = null; S.authNotice = null; render(); break;
    case 'copylink': copyText(roomLink(S.room.code)); break;
    case 'addbot': run(() => api('add_bot', { room_id: S.room.id })); break;
    case 'removeseat': run(() => api('remove_seat', { room_id: S.room.id, seat: Number(el.dataset.seat) })); break;
    case 'setplayers': run(() => api('update_room', { room_id: S.room.id, max_players: Number(el.value) })); break;
    case 'settarget': run(() => api('update_room', { room_id: S.room.id, target_score: Number(el.value) })); break;
    case 'start': run(() => api('start_game', { room_id: S.room.id })); break;
    case 'leave': run(async () => { await api('leave_room', { room_id: S.room.id }); leaveRoomState(); go('#/'); }); break;
    case 'take': playSelected(S.sel.take); break;
    case 'lay': playSelected(new Set()); break;
    case 'nextdeal': run(() => api('next_deal', { game_id: S.gameRow.id })); break;
    case 'tolobby': run(() => api('back_to_lobby', { room_id: S.room.id })); break;
    default: break;
  }
}

async function onAuthSubmit(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const email = String(fd.get('email') || '').trim();
  const password = String(fd.get('password') || '');
  S.authError = null; S.authNotice = null;
  await run(async () => {
    if (S.authMode === 'signup') {
      const data = {
        nickname: String(fd.get('nickname') || '').trim(),
        age: Number(fd.get('age')) || null,
        country: String(fd.get('country') || ''),
        phone: String(fd.get('phone') || '').trim(),
        lang: getLang(),
      };
      const { data: res, error } = await supabase.auth.signUp({ email, password, options: { data, emailRedirectTo: location.origin + location.pathname } });
      if (error) { S.authError = t('err.signup', { msg: error.message }); return; }
      if (!res.session) { S.authNotice = t('auth.checkEmail', { email }); S.authMode = 'signin'; }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { S.authError = t('err.signin'); return; }
      await loadProfile();
    }
  });
}

// ---------- animation ----------
function snapshotRects() {
  const rects = {};
  for (const el of app.querySelectorAll('[data-card]')) rects[el.dataset.card] = el.getBoundingClientRect();
  const seats = {};
  for (const el of app.querySelectorAll('.seat[data-seat]')) seats[el.dataset.seat] = el.getBoundingClientRect();
  const me = app.querySelector('.me .me-info');
  const deck = app.querySelector('.deck .stack');
  return { rects, seats, me: me?.getBoundingClientRect(), deck: deck?.getBoundingClientRect(), version: S.renderedVersion, dealNo: S.renderedDeal, round: S.renderedRound };
}

function seatRect(seat) {
  const me = mySeat();
  if (seat === me) return app.querySelector('.me .me-info')?.getBoundingClientRect();
  return app.querySelector(`.seat[data-seat="${seat}"]`)?.getBoundingClientRect();
}

function animateChanges(prev) {
  const g = game();
  const d = g.deal;
  if (!d) return;
  const me = mySeat();
  const handled = new Set();
  const newDeal = g.dealNo !== prev.dealNo || prev.version === 0;
  const newRound = newDeal || d.handRound !== prev.round;
  const oneStep = g.version === prev.version + 1 && d.log?.length;

  // 1. The latest move, when exactly one step happened since the last render.
  if (oneStep) {
    const ev = d.log[d.log.length - 1];
    if (ev.type === 'play') {
      const from = ev.seat === me ? prev.rects[ev.card] : prev.seats[ev.seat];
      if (ev.take?.length) {
        if (ev.sweep) sfx.sweep(); else sfx.take(ev.take.length + 1);
        const dest = seatRect(ev.seat);
        if (from && dest && !REDUCED_MOTION) [ev.card, ...ev.take].forEach((c, i) => {
          const start = c === ev.card ? from : prev.rects[c];
          if (start) flyGhost(c, start, dest, i * 60);
        });
      } else {
        sfx.lay();
        const el = app.querySelector(`#table-cards [data-card="${ev.card}"]`);
        if (el && from && !REDUCED_MOTION) { slideIn(el, from, ev.seat === me ? 1 : 0.4); handled.add(ev.card); }
      }
    }
  }

  if (REDUCED_MOTION) return;
  const deckEl = app.querySelector('.deck');
  const deckRect = app.querySelector('.deck .stack')?.getBoundingClientRect() || app.querySelector('.felt')?.getBoundingClientRect();
  if (!deckRect) return;

  // 2. A new deal starts with a shuffle at the deck.
  let base = 0;
  if (newDeal && deckEl) {
    deckEl.classList.add('shuffling');
    setTimeout(() => deckEl.classList.remove('shuffling'), 900);
    sfx.shuffle();
    base = 780;
  }

  // 3. Dealing: one card at a time around the table, starting left of the dealer, then the table.
  let i = 0;
  if (newRound) {
    for (let k = 0; k < E.HAND_SIZE; k++) {
      for (let s = 0; s < g.n; s++) {
        const seat = (g.dealer + 1 + s) % g.n;
        let el = null;
        if (seat === me) {
          el = app.querySelectorAll('#hand [data-card]')[k];
          if (el && prev.rects[el.dataset.card]) el = null;
        } else {
          el = app.querySelectorAll(`.seat[data-seat="${seat}"] .mini-hand .card`)[k];
        }
        if (el) { slideIn(el, deckRect, 0.5, base + i * 70); if (el.dataset.card) handled.add(el.dataset.card); i++; }
      }
    }
  }
  // 4. Anything else that was not on screen before (a new deal's table, a reload) also comes from the deck.
  for (const el of app.querySelectorAll('#hand [data-card], #table-cards [data-card]')) {
    const c = el.dataset.card;
    if (prev.rects[c] || handled.has(c)) continue;
    slideIn(el, deckRect, 0.5, base + i++ * 70);
  }
  if (i > 0) sfx.deal(i, base / 1000);
}

function slideIn(el, from, scale, delay = 0) {
  const to = el.getBoundingClientRect();
  el.animate(
    [{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${scale})`, opacity: .2 }, { transform: 'none', opacity: 1 }],
    { duration: 420, delay, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' },
  );
}

function flyGhost(card, from, to, delay) {
  const ghost = cardEl(card);
  ghost.classList.add('fly-ghost');
  ghost.style.left = `${from.left}px`;
  ghost.style.top = `${from.top}px`;
  ghost.style.width = `${from.width}px`;
  ghost.style.height = `${from.height}px`;
  fx.appendChild(ghost);
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const anim = ghost.animate(
    [{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(.35) rotate(8deg)`, opacity: .15 }],
    { duration: 560, delay, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' },
  );
  anim.onfinish = () => ghost.remove();
  setTimeout(() => ghost.remove(), delay + 800);
}

boot();
