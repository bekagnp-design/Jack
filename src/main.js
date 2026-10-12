import './styles.css';
import { supabase, api, accountApi, ApiError } from './supabase.js';
import { t, getLang, setLang, onLangChange, COUNTRIES } from './i18n.js';
import { cardEl, cardLabel } from './cards.js';
import { sfx, unlock, soundEnabled, setSound } from './sound.js';
import { inTelegram, prepareTelegram, telegramSignIn, startParam, roomLinkFor, shareInTelegram, haptic, showBackButton, hideBackButton, telegramLang } from './telegram.js';
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
  clockOffset: 0,     // client clock minus server clock, from the latest game row
  timerInterval: null,
  autoPlayedFor: 0,   // game version we already asked the server to move for
  bubbles: {},        // seat -> { id, until }: emotes currently shown
  emoteCool: 0,       // time before which we may not send another emote
  picker: false,
  spam: {},           // seat -> recent emote timestamps
  autoMuted: new Set(),
};

// ---------- table style ----------
const THEMES = ['ambani', 'wood', 'linen', 'slate'];
const THEME_KEY = 'eleven.table';
function tableTheme() { try { const v = localStorage.getItem(THEME_KEY); return THEMES.includes(v) ? v : 'ambani'; } catch { return 'wood'; } }
function nextTheme() { const n = THEMES[(THEMES.indexOf(tableTheme()) + 1) % THEMES.length]; try { localStorage.setItem(THEME_KEY, n); } catch { /* ignore */ } }

// ---------- emotes ----------
// Quick reactions instead of free text: no insults, no walls of chat.
// Each opponent can be muted separately; the choice is kept in this browser.
const EMOTES = [
  { id: 'gg', icon: '👍' }, { id: 'haha', icon: '😄' }, { id: 'wow', icon: '😮' }, { id: 'furti', icon: '🔥' },
  { id: 'cheers', icon: '🥂' }, { id: 'thanks', icon: '🙏' }, { id: 'hurry', icon: '⏳' }, { id: 'oops', icon: '😢' },
];
const EMOTE_COOLDOWN_MS = 3000;
const EMOTE_SHOW_MS = 2500;
const MUTED_KEY = 'eleven.muted';
const EMOTES_OFF_KEY = 'eleven.emotesOff';
function loadMuted() { try { return new Set(JSON.parse(localStorage.getItem(MUTED_KEY) || '[]')); } catch { return new Set(); } }
function saveMuted() { try { localStorage.setItem(MUTED_KEY, JSON.stringify([...S.muted])); } catch { /* ignore */ } }
function emotesOff() { try { return localStorage.getItem(EMOTES_OFF_KEY) === '1'; } catch { return false; } }
S.muted = loadMuted();
function isMuted(playerId) { return emotesOff() || (playerId && (S.muted.has(playerId) || S.autoMuted.has(playerId))); }

const LAST_ROOM_KEY = 'eleven.lastRoom';
function rememberRoom(code) { try { if (code) localStorage.setItem(LAST_ROOM_KEY, code); else localStorage.removeItem(LAST_ROOM_KEY); } catch { /* ignore */ } }
function lastRoom() { try { return localStorage.getItem(LAST_ROOM_KEY) || ''; } catch { return ''; } }

const game = () => (S.local ? S.local.pub : S.gameRow?.public ?? null);

// ---------- offline play ----------
// The same table, with the engine running in the browser. Nothing leaves the device.
const LOCAL_ID = 'local-you';
const OFFLINE_KEY = 'eleven.offline';
S.local = null; // { state, level, pub, botTimer }

function isLocal() { return !!S.local; }
function uid() { return isLocal() ? LOCAL_ID : S.user?.id; }
function hasSavedLocal() { try { return !!localStorage.getItem(OFFLINE_KEY); } catch { return false; } }

function syncLocal() {
  const st = S.local.state;
  S.local.pub = E.publicView(st);
  S.hand = E.handOf(st, 0);
  S.handVersion = st.version;
  S.gameRow = { id: 'local', created_at: '', public: S.local.pub };
  S.room = { id: 'local', code: '', status: st.phase === 'game_over' ? 'finished' : 'playing', host_id: LOCAL_ID, game_id: 'local', target_score: st.targetScore, max_players: st.n, bot_level: S.local.level };
}

function saveLocal() {
  if (!S.local || S.local.tut) return; // the tutorial never overwrites a saved game
  try { localStorage.setItem(OFFLINE_KEY, JSON.stringify({ state: S.local.state, level: S.local.level })); } catch { /* ignore */ }
}

function startLocal({ players, level, target, dealer }) {
  leaveRoomState();
  const n = Math.min(4, Math.max(2, Number(players) || 2));
  const name = S.profile?.nickname || t('log.you');
  const ps = [{ id: LOCAL_ID, name, bot: false }];
  for (let i = 1; i < n; i++) ps.push({ id: null, name: `Bot ${i + 1}`, bot: true });
  const state = E.newGame({ players: ps, targetScore: Number(target) || 11, dealer: dealer ?? Math.floor(Math.random() * n) });
  state.botLevel = E.BOT_LEVELS.includes(level) ? level : 'normal';
  S.local = { state, level: state.botLevel, pub: null, botTimer: null };
  syncLocal();
  saveLocal();
  go('#/offline');
  scheduleLocalBots();
}

function resumeLocal() {
  try {
    const raw = localStorage.getItem(OFFLINE_KEY);
    if (!raw) return false;
    const { state, level } = JSON.parse(raw);
    if (!state?.players || !state.deal) return false;
    leaveRoomState();
    S.local = { state, level: level || 'normal', pub: null, botTimer: null };
    syncLocal();
    scheduleLocalBots();
    return true;
  } catch { return false; }
}

function localPlay(card, take) {
  const ev = E.play(S.local.state, 0, card, take);
  if (ev.sweep || (ev.take && ev.take.length >= 3)) botReact('bigTake');
  S.sel = { card: null, take: new Set() };
  syncLocal(); saveLocal(); render();
  scheduleLocalBots();
}

function scheduleLocalBots() {
  if (!S.local || S.local.tut || S.local.botTimer || !E.isComputerTurn(S.local.state)) return;
  // Right after a deal the player first needs to see the table and their hand.
  const log = S.local.state.deal.log;
  const afterDeal = log.length && log[log.length - 1].type === 'deal';
  S.local.botTimer = setTimeout(() => {
    if (!S.local) return;
    S.local.botTimer = null;
    const st = S.local.state;
    if (!E.isComputerTurn(st)) return;
    const seat = st.deal.current;
    const m = E.botMove(st, seat, S.local.level);
    const ev = E.play(st, seat, m.card, m.take);
    if (ev.sweep || (ev.take && ev.take.length >= 3)) botReact('bigTake', true);
    syncLocal(); saveLocal(); render();
    scheduleLocalBots();
  }, afterDeal ? 3200 : 2000);
}

function localNextDeal() {
  if (S.local.state.phase !== 'deal_over') return;
  E.nextDeal(S.local.state);
  S.sel = { card: null, take: new Set() };
  syncLocal(); saveLocal(); render();
  scheduleLocalBots();
}

function localNewGame() {
  const st = S.local.state;
  startLocal({ players: st.n, level: S.local.level, target: st.targetScore, dealer: (st.dealer + 1) % st.n });
}

function pauseLocal() {
  pauseLocalState();
  go('#/');
}

// ---------- routing ----------
function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const [seg, arg] = h.split('/');
  if (seg === 'room' && arg) return { name: 'room', code: arg.toUpperCase() };
  if (seg === 'offline') return { name: 'offline' };
  return { name: 'home' };
}
function go(hash) { if (location.hash !== hash) location.hash = hash; else enterRoute(); }
window.addEventListener('hashchange', () => { S.route = parseRoute(); enterRoute(); });

// ---------- boot ----------
async function boot() {
  prepareTelegram();
  if (inTelegram() && telegramLang() && !localStorage.getItem('eleven.lang')) setLang('ka');
  document.documentElement.lang = getLang();
  onLangChange(render);
  const { data: { session } } = await supabase.auth.getSession();
  applySession(session);
  if (inTelegram() && !S.session) await signInWithTelegram();
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

// Inside Telegram there is no sign-in form: the app proves who the user is.
async function signInWithTelegram() {
  S.tgSigningIn = true;
  render();
  try {
    const res = await telegramSignIn(supabase, getLang());
    const { data: { session } } = await supabase.auth.getSession();
    applySession(session);
    await loadProfile();
    if (res.needs_profile || !S.profile?.age || !S.profile?.country) S.profileNeeded = true;
    const code = startParam();
    if (code && S.route.name !== 'room') S.route = { name: 'room', code };
    if (code) location.hash = `#/room/${code}`;
  } catch (e) {
    S.tgError = e?.message || String(e);
  } finally {
    S.tgSigningIn = false;
  }
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
  if (S.route.name === 'offline') {
    if (!S.local && !resumeLocal()) { go('#/'); return; }
    render();
    return;
  }
  if (S.local) pauseLocalState();
  if (!S.session) { render(); return; }
  if (S.route.name === 'room') openRoom(S.route.code);
  else { leaveRoomState(); render(); }
}

function pauseLocalState() {
  if (S.local?.botTimer) clearTimeout(S.local.botTimer);
  S.local = null;
  S.room = null; S.gameRow = null; S.hand = []; S.sel = { card: null, take: new Set() };
  S.renderedVersion = 0;
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
    rememberRoom(code);
    await loadRoomData();
    subscribeRoom();
    startPolling();
  } catch (e) {
    toast(errMsg(e), 'err');
    if (e instanceof ApiError && e.code === 'room_not_found' && lastRoom() === code) rememberRoom('');
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
  if (S.timerInterval) { clearInterval(S.timerInterval); S.timerInterval = null; }
  if (S.local?.botTimer) clearTimeout(S.local.botTimer);
  S.local = null;
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
    supabase.from('games').select('id, created_at, updated_at, public, version').eq('id', gameId).maybeSingle(),
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
  // A fresh row tells us how far our clock is from the server's; the turn timer uses it.
  if (row.updated_at && (changedGame || row.public.version > cur.public.version)) {
    S.clockOffset = Date.now() - Date.parse(row.updated_at);
  }
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
  S.channel = supabase.channel(`room:${roomId}`, { config: { broadcast: { self: false } } })
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
    .on('broadcast', { event: 'emote' }, ({ payload }) => onEmote(payload))
    .subscribe();
}

function onEmote(payload) {
  const g = game();
  if (!g || !payload || !EMOTES.some((e) => e.id === payload.id)) return;
  const seat = Number(payload.seat);
  const p = g.players[seat];
  if (!p || p.bot || seat === mySeat()) return;
  // Too many in a short time: mute that player for the rest of the session.
  const now = Date.now();
  const recent = (S.spam[seat] = (S.spam[seat] || []).filter((t0) => now - t0 < 12000).concat(now));
  if (recent.length > 5) S.autoMuted.add(p.id);
  if (isMuted(p.id)) return;
  showBubble(seat, payload.id);
}

function sendEmote(id) {
  const now = Date.now();
  if (now < S.emoteCool || !EMOTES.some((e) => e.id === id)) return;
  S.emoteCool = now + EMOTE_COOLDOWN_MS;
  S.picker = false;
  const seat = mySeat();
  if (seat < 0) { render(); return; }
  showBubble(seat, id);
  if (isLocal()) botReact('emote');
  else if (S.channel) S.channel.send({ type: 'broadcast', event: 'emote', payload: { seat, id } });
  haptic('light');
  render();
}

function showBubble(seat, id) {
  S.bubbles[seat] = { id, until: Date.now() + EMOTE_SHOW_MS };
  sfx.pop();
  applyBubbles();
  setTimeout(applyBubbles, EMOTE_SHOW_MS + 60);
}

// Bubbles live in state and are re-attached after every render.
function applyBubbles() {
  const now = Date.now();
  for (const el of document.querySelectorAll('.bubble')) el.remove();
  const me = mySeat();
  for (const [seat, b] of Object.entries(S.bubbles)) {
    if (b.until <= now) { delete S.bubbles[seat]; continue; }
    const host = Number(seat) === me ? document.querySelector('.me') : document.querySelector(`.seat[data-seat="${seat}"]`);
    const e = EMOTES.find((x) => x.id === b.id);
    if (!host || !e) continue;
    const div = document.createElement('div');
    div.className = 'bubble';
    div.innerHTML = `<span class="e">${e.icon}</span><span class="t">${esc(t(`emote.${e.id}`))}</span>`;
    host.appendChild(div);
  }
}

// Offline: the computer reacts now and then, so the table feels alive.
function botReact(kind, byBot = false) {
  if (!S.local) return;
  const bots = S.local.state.players.filter((p) => p.bot).map((p) => p.seat);
  if (!bots.length) return;
  const seat = bots[Math.floor(Math.random() * bots.length)];
  const pick = { emote: ['haha', 'gg', 'cheers'], bigTake: ['wow', 'oops'], bigTakeByBot: ['cheers', 'furti'] }[byBot ? 'bigTakeByBot' : kind];
  const chance = kind === 'emote' ? 0.55 : 0.5;
  if (!pick || Math.random() > chance) return;
  setTimeout(() => { if (S.local && !isMuted(null)) showBubble(seat, pick[Math.floor(Math.random() * pick.length)]); }, 900);
}

// Safety net: realtime can drop events on flaky connections.
function startPolling() {
  if (S.pollTimer) clearInterval(S.pollTimer);
  S.pollTimer = setInterval(() => { if (!document.hidden) refreshRoom(); }, 6000);
}

async function refreshRoom() {
  if (!S.room || S.busy || isLocal()) return;
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
  const takeList = [...take];
  haptic(takeList.length ? 'medium' : 'light');
  if (isLocal()) {
    if (S.local.tut) { tutAttempt(card, takeList); return; }
    try { localPlay(card, takeList); } catch (e) { toast(errMsg(e), 'err'); }
    return;
  }
  const gameId = S.gameRow.id;
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
  const me = uid();
  if (g) { const p = g.players.find((p) => p.id === me && !p.bot); if (p) return p.seat; }
  const s = S.seats.find((p) => p.user_id === me);
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
function inviteLink(code) { return inTelegram() ? roomLinkFor(code, roomLink(code)) : roomLink(code); }

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
  const snapshot = (S.route.name === 'room' || isLocal()) && game() ? snapshotRects() : null;
  cueSounds();
  let html = '';
  if (isLocal()) html = viewGame();
  else if (S.tgSigningIn) html = viewLoading();
  else if (!S.session) html = viewAuth();
  else if (S.route.name === 'room') html = S.room ? (showGame() ? viewGame() : viewLobby()) : viewLoading();
  else html = viewHome();
  if (S.rulesOpen) html += viewRules();
  if (S.profileNeeded && S.session) html += viewProfileForm();
  if (inTelegram()) { if (S.route.name === 'home' && !isLocal()) hideBackButton(); else showBackButton(() => { if (isLocal()) pauseLocal(); else go('#/'); }); }
  if (S.toast) html += `<div class="toast ${S.toast.kind}" role="status">${esc(S.toast.msg)}</div>`;
  app.innerHTML = html;
  bind();
  applyBubbles();
  if (snapshot && showGame()) animateChanges(snapshot);
  if (showGame()) {
    const g = game();
    S.renderedVersion = g.version; S.renderedDeal = g.dealNo; S.renderedRound = g.deal?.handRound || 0;
    warmDancer();
    if (!S.timerInterval) S.timerInterval = setInterval(tickTimer, 500);
    tickTimer();
  } else if (S.timerInterval) { clearInterval(S.timerInterval); S.timerInterval = null; }
}

// Turn clock: fills the ring around the player on turn and, when it runs out,
// asks the server to move for them. Updates the DOM directly, no re-render.
function tickTimer() {
  if (isLocal()) return;
  const g = game();
  const d = g?.deal;
  const ring = app.querySelector('.ring');
  const label = app.querySelector('.timer');
  if (!g || g.phase !== 'deal' || !d || d.turnStartedAt == null) { if (ring) ring.style.setProperty('--p', '0%'); return; }
  const total = E.TURN_SECONDS * 1000;
  const elapsed = Date.now() - S.clockOffset - d.turnStartedAt;
  const left = Math.max(0, total - elapsed);
  if (ring) {
    ring.style.setProperty('--p', `${(left / total) * 100}%`);
    ring.classList.toggle('low', left < 12000);
  }
  if (label) label.textContent = t('game.seconds', { s: Math.ceil(left / 1000) });
  const p = g.players[d.current];
  const humanOnTurn = p && !p.bot && !p.away;
  if (left <= 0 && humanOnTurn && S.autoPlayedFor !== g.version && mySeat() >= 0 && !S.busy) {
    S.autoPlayedFor = g.version;
    api('auto_play', { game_id: S.gameRow.id }).then((res) => {
      // Our clock was ahead of the server's: try again when it says the time is up.
      if (res && res.ok === false && res.remainingMs > 0) setTimeout(() => { if (game()?.version === g.version) S.autoPlayedFor = 0; }, res.remainingMs + 300);
    }).catch(() => {});
  }
}

function showGame() {
  if (isLocal()) return true;
  return !!(S.room && game() && (S.room.status === 'playing' || S.room.status === 'finished') && S.room.game_id === S.gameRow?.id);
}

function viewOfflinePanel() {
  return `
      <section class="panel">
        <h2>${esc(t('offline.panel'))}</h2>
        <p class="muted">${esc(t('offline.hint'))}</p>
        <div><button class="btn" data-act="tutorial">${esc(t('tut.start'))}</button></div>
        ${hasSavedLocal() ? `<div><button class="btn" data-act="resume">${esc(t('offline.resume'))}</button></div>` : ''}
        <form id="offline-form">
          <div class="row">
            <label>${esc(t('home.players'))}
              <select name="players" id="o-players"><option value="2">2</option><option value="3">3</option><option value="4">4</option></select></label>
            <label>${esc(t('home.botLevel'))}
              <select name="level" id="o-level">${botLevelOptions('normal')}</select></label>
            <label>${esc(t('home.target'))}
              <select name="target" id="o-target">
                <option value="11">${esc(t('home.points', { n: 11 }))}</option>
                <option value="21">${esc(t('home.points', { n: 21 }))}</option>
                <option value="31">${esc(t('home.points', { n: 31 }))}</option>
              </select></label>
          </div>
          <button class="btn primary" type="submit">${esc(t('offline.play'))}</button>
        </form>
      </section>`;
}

// Turn chime and end-of-deal sounds come from state transitions, not from renders.
function cueSounds() {
  const g = game();
  if (!g || !showGame()) { S.wasMyTurn = false; S.phaseSounded = ''; return; }
  const me = mySeat();
  const myTurn = g.phase === 'deal' && g.deal?.current === me;
  if (myTurn && !S.wasMyTurn && S.renderedVersion > 0) { sfx.turn(); haptic('light'); }
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
  return viewTopbar() + `<main class="page"><p class="muted">${S.tgError ? esc(S.tgError) : '…'}</p></main>`;
}

// First launch from Telegram: the two details Telegram does not give us.
function viewProfileForm() {
  const countries = COUNTRIES.map((c) => `<option value="${c[0]}" ${S.profile?.country === c[0] ? 'selected' : ''}>${esc(getLang() === 'ka' ? c[2] : c[1])}</option>`).join('');
  return `<div class="overlay"><div class="sheet" data-stop="1">
    <h2>${esc(t('home.hello', { name: S.profile?.nickname || '' }))}</h2>
    <p class="muted">${esc(t('profile.hint'))}</p>
    <form id="profile-form">
      <div class="row">
        <label>${esc(t('auth.age'))}<input name="age" id="p-age" type="number" min="5" max="120" required inputmode="numeric" value="${S.profile?.age ?? ''}"></label>
        <label>${esc(t('auth.country'))}<select name="country" id="p-country" required><option value="">${esc(t('auth.pickCountry'))}</option>${countries}</select></label>
      </div>
      <label>${esc(t('auth.nickname'))}<input name="nickname" id="p-nick" minlength="2" maxlength="24" value="${esc(S.profile?.nickname || '')}"></label>
      <div class="actions-row"><button class="btn primary" type="submit" ${S.busy ? 'disabled' : ''}>${esc(t('profile.save'))}</button></div>
    </form>
  </div></div>`;
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
    ${S.route.name === 'room' ? `<div class="notice auth">${esc(t('room.invited', { code: S.route.code }))}</div>` : ''}
    <section class="panel auth">
      <h2>${esc(t('auth.guestTitle'))}</h2>
      <p class="muted">${esc(t('auth.guestHint'))}</p>
      <div class="row">
        <label>${esc(t('auth.guestName'))}<input id="f-guest" maxlength="24" autocomplete="nickname"></label>
        <button class="btn primary" type="button" data-act="guest" ${S.busy ? 'disabled' : ''}>${esc(t('auth.guest'))}</button>
      </div>
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
    <div class="auth">${viewOfflinePanel()}</div>
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
      ${lastRoom() ? `<div><button class="btn" data-act="backto" data-code="${esc(lastRoom())}">${esc(t('home.backTo', { code: lastRoom() }))}</button></div>` : ''}
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
            <label>${esc(t('home.botLevel'))}
              <select name="bot_level" id="f-level">${botLevelOptions('normal')}</select></label>
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
    ${viewOfflinePanel()}
  </main>`;
}

function botLevelOptions(current) {
  return E.BOT_LEVELS.map((l) => `<option value="${l}" ${l === current ? 'selected' : ''}>${esc(t(`bot.${l}`))}</option>`).join('');
}

function viewLobby() {
  const r = S.room;
  const host = S.seats.find((s) => s.user_id === r.host_id);
  const isHost = r.host_id === uid();
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
      if (s.user_id === uid()) chips.push(`<span class="chip">${esc(t('room.you'))}</span>`);
      if (s.away) chips.push(`<span class="chip">${esc(t('game.away'))}</span>`);
      seats.push(`<div class="seat-card"><div class="avatar">${esc(initial(s.name))}</div><div class="name">${esc(s.name)}</div>
        <div class="chips">${chips.join('')}</div>
        ${isHost && s.user_id !== uid() ? `<button class="btn small ghost" data-act="removeseat" data-seat="${i}" ${S.busy ? 'disabled' : ''}>${esc(t('room.remove'))}</button>` : ''}</div>`);
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
      <div class="linkbox"><input id="invite-link" readonly value="${esc(inviteLink(r.code))}">
        <button class="btn" data-act="copylink">${esc(S.copied ? t('room.copied') : t('room.copy'))}</button>
        ${inTelegram() ? `<button class="btn primary" data-act="share">${esc(t('room.share'))}</button>` : ''}</div>
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
        <label>${esc(t('home.botLevel'))}
          <select id="set-level" data-act="setlevel" ${S.busy ? 'disabled' : ''}>${botLevelOptions(r.bot_level || 'normal')}</select></label>
      </div>
      <p class="muted">${esc(t('room.startHint'))}</p>
      <div class="row">
        <button class="btn primary" data-act="start" ${S.busy ? 'disabled' : ''}>${esc(finished ? t('score.playAgain') : t('room.start'))}</button>
        <button class="btn ghost danger" data-act="leave" ${S.busy ? 'disabled' : ''}>${esc(t('room.leave'))}</button>
      </div>` : `
      <p class="muted">${esc(t('score.target', { n: r.target_score }))} · ${esc(t('home.botLevel'))}: ${esc(t(`bot.${r.bot_level || 'normal'}`))}</p>
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

  const ring = '<span class="ring" style="--p:100%"></span>';
  const timed = !isLocal() && g.phase === 'deal' && d?.turnStartedAt != null && !g.players[d.current]?.bot && !g.players[d.current]?.away;
  const seatsHtml = others.map((seat, i) => {
    const p = g.players[seat];
    const name = playerName(p);
    const backs = Array.from({ length: d?.handCounts[seat] || 0 }, () => '<div class="card card-back"></div>').join('');
    const current = g.phase === 'deal' && d?.current === seat;
    return `<div class="seat ${positions[i]} ${current ? 'current' : ''} ${p.away ? 'away' : ''}" data-seat="${seat}">
      <div class="avatar ${p.bot ? 'bot' : ''}">${p.bot ? '⚙' : esc(initial(name))}${current && timed ? ring : ''}</div>
      <div class="name">${esc(name)}${p.bot || !p.id ? '' : ` <button class="mute-btn ${isMuted(p.id) ? 'on' : ''}" data-act="mute" data-seat="${seat}" aria-label="${esc(isMuted(p.id) ? t('emote.unmute') : t('emote.mute'))}" title="${esc(isMuted(p.id) ? t('emote.unmute') : t('emote.mute'))}">${isMuted(p.id) ? '🔇' : '🔈'}</button>`}</div>
      <div class="meta">
        ${p.away ? `<span class="chip">${esc(t('game.away'))}</span>` : ''}
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
  const leaveLabel = S.local?.tut ? t('tut.exit') : isLocal() ? t('offline.leave') : t('room.leave');

  return `
  <div class="game ${myTurn ? 'my-turn' : ''}">
    <div class="game-top">
      <div class="l"><span class="code">${esc(S.local?.tut ? t('tut.title') : isLocal() ? t('offline.title') : S.room.code)}</span><span class="only-wide">${esc(t('game.deal', { n: g.dealNo }))}</span><span class="only-wide">·</span><span class="only-wide">${esc(t('score.target', { n: g.targetScore }))}</span>${d ? `<span class="only-wide">·</span><span class="only-wide">${esc(t('game.deck', { n: d.deckCount }))}</span>` : ''}</div>
      <div class="r">
        <button class="btn small ghost icon" data-act="theme" aria-label="${esc(t('table.theme'))}" title="${esc(t('table.theme'))}">🎨</button>
        <button class="btn small ghost icon emote-btn" data-act="emotes" aria-label="${esc(t('emote.title'))}" title="${esc(t('emote.title'))}">😊</button>
        ${soundButton()}
        <button class="btn small ghost" data-act="lang" aria-label="${esc(t('lang.switch'))}"><span class="only-wide">${esc(t('lang.switch'))}</span><span class="only-narrow">${esc(t('lang.short'))}</span></button>
        <button class="btn small ghost" data-act="rules" aria-label="${esc(t('nav.rules'))}"><span class="only-wide">${esc(t('nav.rules'))}</span><span class="only-narrow">?</span></button>
        <button class="btn small ghost danger" data-act="leave" aria-label="${esc(leaveLabel)}"><span class="only-wide">${esc(leaveLabel)}</span><span class="only-narrow">✕</span></button>
      </div>
    </div>
    <div class="arena">
      ${seatsHtml}
      ${S.local?.tut ? coachHtml() : ''}
      <div class="felt n${g.n} t-${tableTheme()}">
        ${tableHtml}
        <div class="last-move">${esc(last)}</div>
        ${deckHtml}
      </div>
    </div>
    <div class="me ${myTurn ? 'current' : ''}" data-seat="${me}">
      <div class="me-info">
        ${me >= 0 ? `<div class="avatar">${esc(initial(S.profile?.nickname || nameAt(me)))}${myTurn && timed ? ring : ''}</div><span class="name">${esc(S.profile?.nickname || nameAt(me))}</span>
        <span class="chip">${esc(t('game.score', { n: g.totals[me] }))}</span>
        <span class="chip pile" title="${esc(t('game.taken'))}"><i class="pile-ico"></i>${d ? d.capturedCounts[me] : 0}</span>
        ${g.dealer === me ? `<span class="chip gold" title="${esc(t('game.dealer'))}">D</span>` : ''}` : ''}
      </div>
      <div class="hand" id="hand"></div>
    </div>
    <div class="actions">
      <div class="status-line ${myTurn ? 'turn' : ''}">${esc(myTurn && !S.sel.card ? t('game.yourTurn') + ' · ' + status : status)}${timed ? ` <span class="timer"></span>` : ''}</div>
      <div class="buttons">${sumHtml}${takeBtn}${layBtn}</div>
    </div>
    ${S.picker ? emotePicker() : ''}
    ${S.local?.tut?.finished ? viewTutDone() : ''}
    ${overlay}
  </div>`;
}

function emotePicker() {
  const cool = Date.now() < S.emoteCool;
  return `<div class="emote-pop" role="dialog" aria-label="${esc(t('emote.title'))}">
    <div class="emote-grid">${EMOTES.map((e) => `<button class="emote" data-act="emote" data-id="${e.id}" ${cool ? 'disabled' : ''}><span class="e">${e.icon}</span><span class="t">${esc(t(`emote.${e.id}`))}</span></button>`).join('')}</div>
    <button class="btn small ghost" data-act="emotesoff">${esc(emotesOff() ? t('emote.on') : t('emote.off'))}</button>
    <button class="btn small ghost" data-act="dancer">${esc(dancerOff() ? t('dancer.on') : t('dancer.off'))}</button>
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
  const glow = S.local?.tut && !S.local.tut.done && !S.local.tut.finished ? new Set(LESSONS[S.local.tut.i].glow) : null;

  const tc = document.getElementById('table-cards');
  if (tc) {
    for (const c of table) {
      const el = cardEl(c, { interactive: myTurn });
      if (c === '10D' || c === '2C') el.classList.add('gem');
      if (glow?.has(c)) el.classList.add('coach-glow');
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
      if (glow?.has(c)) el.classList.add('coach-glow');
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
  const take = new Set(groups.length === 1 && !S.local?.tut ? groups[0] : []); // lessons make you pick the cards yourself
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
    const prefix = ev.auto ? t('game.autoPlayed', { name: who(ev.seat) }) + ' ' : '';
    if (!ev.take?.length) return prefix + t('log.laid', { name: who(ev.seat), card });
    if (ev.sweep) return prefix + t('log.sweep', { name: who(ev.seat), card });
    return prefix + t('log.took', { name: who(ev.seat), n: ev.take.length + 1, card });
  }
  if (ev.type === 'deal') return t('log.dealt');
  return '';
}

function viewScore(g, me) {
  const r = g.dealResults[g.dealResults.length - 1];
  if (!r) return '';
  const over = g.phase === 'game_over';
  const isHost = isLocal() || S.room.host_id === uid();
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
       ${isLocal() ? '' : `<button class="btn" data-act="tolobby" ${S.busy ? 'disabled' : ''}>${esc(t('room.toLobby'))}</button>`}`
    : `<span class="muted">${esc(t('score.waitingHost', { name: nameAt(S.seats.find((s) => s.user_id === S.room.host_id)?.seat ?? 0) }))}</span>`)
    + `<button class="btn ghost" data-act="leave" ${S.busy ? 'disabled' : ''}>${esc(isLocal() ? t('offline.leave') : t('room.leave'))}</button>`;
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

// Worked examples under the rules, drawn with real mini cards (filled in by fillExamples).
const RULE_EXAMPLES = {
  2: ['AH + 10S = 11', '2H + 2D + 7C = 11'],
  3: ['QD → QS', 'KH → KS'],
  4: ['JC → 3S 8H 5D'],
  7: ['10D 2C'],
};

function viewRules() {
  const items = [1, 2, 3, 4, 5, 6, 7].map((i) => `<li><p>${esc(t(`rules.${i}`))}</p>${(RULE_EXAMPLES[i] || []).map((ex) => `<div class="ex" data-ex="${ex}"></div>`).join('')}</li>`).join('');
  return `<div class="overlay" data-act="closerules"><div class="sheet rules" data-stop="1">
    <h2>${esc(t('rules.title'))}</h2><ol>${items}</ol>
    <div class="actions-row"><button class="btn primary" data-act="tutorial">${esc(t('tut.start'))}</button><button class="btn" data-act="closerules">${esc(t('nav.back'))}</button></div></div></div>`;
}

function fillExamples() {
  for (const el of document.querySelectorAll('[data-ex]')) {
    if (el.childElementCount) continue;
    for (const tok of el.dataset.ex.split(' ')) {
      if (/^(A|10|[2-9JQK])[SHDC]$/.test(tok)) {
        const c = cardEl(tok);
        if (tok === '10D' || tok === '2C') c.classList.add('gem');
        el.appendChild(c);
      } else { const op = document.createElement('span'); op.className = 'op'; op.textContent = tok; el.appendChild(op); }
    }
  }
}

// ---------- tutorial ----------
// Seven short lessons on a scripted table. Wrong moves are not played; right
// ones run through the normal animations, sounds and special-card effects.
const LESSONS = [
  { id: 'sum', hand: ['AH', 'KS', '3D', '9C'], table: ['10S', '5D', 'QH', '8C'], card: 'AH', take: ['10S'], glow: ['AH', '10S'] },
  { id: 'multi', hand: ['2H', 'KD', '6S', 'JC'], table: ['2D', '7C', '4S', 'QS'], card: '2H', take: ['2D', '7C'], glow: ['2H', '2D', '7C'] },
  { id: 'pic', hand: ['QD', '5H', '8S', 'AC'], table: ['QS', '3H', '6D', 'KH'], card: 'QD', take: ['QS'], glow: ['QD', 'QS'] },
  { id: 'furti', hand: ['JH', '9D', '4C', 'KC'], table: ['3S', '8H', 'QC', '5D'], card: 'JH', take: ['3S', '8H', '5D'], glow: ['JH'] },
  { id: 'lay', hand: ['9H', '8S', '10H', '3D'], table: ['QD', 'KH', '4C', '5S'], lay: true, glow: [] },
  { id: 'ten', hand: ['AC', '9H', 'KD', '5S'], table: ['10D', '3H', '6C', 'QD'], card: 'AC', take: ['10D'], glow: ['AC', '10D'] },
  { id: 'two', hand: ['9S', '7D', 'KS', 'JC'], table: ['2C', '4H', 'QC', 'KH'], card: '9S', take: ['2C'], glow: ['9S', '2C'] },
];

function startTutorial() {
  leaveRoomState();
  S.rulesOpen = false;
  S.local = { state: null, level: 'easy', pub: null, botTimer: null, tut: { i: 0, done: false, finished: false, msg: '' } };
  loadLesson(0);
  go('#/offline');
}

function loadLesson(i) {
  const L = LESSONS[i];
  const name = S.profile?.nickname || t('log.you');
  const st = E.newGame({ players: [{ id: LOCAL_ID, name, bot: false }, { id: null, name: 'Bot 2', bot: true }], targetScore: 11, dealer: 1 });
  st.deal.hands = [L.hand.slice(), ['2S', '3S', '4S', '5S']];
  st.deal.table = L.table.slice();
  st.deal.deck = [];
  st.deal.current = 0;
  st.deal.log = [];
  S.local.state = st;
  Object.assign(S.local.tut, { i, done: false, finished: false, msg: '' });
  S.sel = { card: null, take: new Set() };
  S.renderedVersion = 0;
  syncLocal();
  render();
}

function tutAttempt(card, take) {
  const tut = S.local.tut;
  const L = LESSONS[tut.i];
  if (tut.done) return;
  const ok = L.lay ? take.length === 0 : card === L.card && E.sameSet(take, L.take);
  if (!ok) { tut.msg = t('tut.wrong'); haptic('error'); render(); return; }
  tut.done = true; tut.msg = '';
  try { localPlay(card, take); } catch (e) { toast(errMsg(e), 'err'); }
}

function tutNext() {
  const tut = S.local.tut;
  if (tut.i + 1 < LESSONS.length) loadLesson(tut.i + 1);
  else { tut.finished = true; render(); }
}

function coachHtml() {
  const tut = S.local.tut;
  const L = LESSONS[tut.i];
  const last = tut.i + 1 === LESSONS.length;
  return `<div class="coach">
    <div class="coach-top"><span class="chip gold">${esc(t('tut.step', { n: tut.i + 1, total: LESSONS.length }))}</span></div>
    <p>${esc(tut.done ? t('tut.ok') : t(`tut.${L.id}`))}${tut.msg ? ` <span class="warn">${esc(tut.msg)}</span>` : ''}</p>
    ${tut.done ? `<button class="btn primary small" data-act="tutnext">${esc(last ? t('tut.last') : t('tut.next'))}</button>` : ''}
  </div>`;
}

function viewTutDone() {
  return `<div class="overlay"><div class="sheet" data-stop="1">
    <h2>${esc(t('tut.doneTitle'))}</h2>
    <p>${esc(t('tut.doneText'))}</p>
    <div class="ex" data-ex="10D 2C"></div>
    <div class="actions-row"><button class="btn primary" data-act="tutplay">${esc(t('tut.play'))}</button><button class="btn" data-act="leave">${esc(t('tut.home'))}</button></div>
  </div></div>`;
}

// ---------- binding ----------
function bind() {
  mountGameCards();
  fillExamples();
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
  const profileForm = document.getElementById('profile-form');
  if (profileForm) profileForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(profileForm);
    const patch = { age: Number(fd.get('age')) || null, country: String(fd.get('country') || '') || null };
    const nick = String(fd.get('nickname') || '').trim();
    if (nick.length >= 2) patch.nickname = nick;
    run(async () => {
      const { error } = await supabase.from('profiles').update(patch).eq('id', S.user.id);
      if (error) throw error;
      S.profile = { ...S.profile, ...patch };
      S.profileNeeded = false;
    });
  });
  const createForm = document.getElementById('create-form');
  if (createForm) createForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(createForm);
    run(async () => {
      const { room } = await api('create_room', { max_players: fd.get('max_players'), target_score: fd.get('target_score'), bot_level: fd.get('bot_level') });
      go(`#/room/${room.code}`);
    });
  });
  const joinForm = document.getElementById('join-form');
  if (joinForm) joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = String(new FormData(joinForm).get('code') || '').trim().toUpperCase();
    if (code) go(`#/room/${code}`);
  });
  const offlineForm = document.getElementById('offline-form');
  if (offlineForm) offlineForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(offlineForm);
    startLocal({ players: fd.get('players'), level: fd.get('level'), target: fd.get('target') });
  });
}

function doAction(act, el) {
  switch (act) {
    case 'home': go('#/'); break;
    case 'lang': setLang(getLang() === 'ka' ? 'en' : 'ka'); if (S.user) supabase.from('profiles').update({ lang: getLang() }).eq('id', S.user.id).then(() => {}); if (isLocal()) { S.local.state.players[0].name = S.profile?.nickname || t('log.you'); syncLocal(); render(); } break;
    case 'rules': S.rulesOpen = true; render(); break;
    case 'tutorial': startTutorial(); break;
    case 'tutnext': tutNext(); break;
    case 'tutplay': startLocal({ players: 2, level: 'easy', target: 11 }); break;
    case 'theme': nextTheme(); render(); break;
    case 'dancer': try { localStorage.setItem('eleven.dancer', dancerOff() ? '1' : '0'); } catch { /* ignore */ } S.picker = false; render(); break;
    case 'emotes': S.picker = !S.picker; render(); break;
    case 'emote': sendEmote(el.dataset.id); break;
    case 'emotesoff': try { localStorage.setItem(EMOTES_OFF_KEY, emotesOff() ? '0' : '1'); } catch { /* ignore */ } S.bubbles = {}; S.picker = false; render(); break;
    case 'mute': {
      const pid = game()?.players[Number(el.dataset.seat)]?.id;
      if (pid) { if (S.muted.has(pid) || S.autoMuted.has(pid)) { S.muted.delete(pid); S.autoMuted.delete(pid); } else S.muted.add(pid); saveMuted(); delete S.bubbles[el.dataset.seat]; }
      render(); break;
    }
    case 'sound': setSound(!soundEnabled()); if (soundEnabled()) sfx.tick(); render(); break;
    case 'closerules': S.rulesOpen = false; render(); break;
    case 'signout': run(async () => { await supabase.auth.signOut(); go('#/'); }); break;
    case 'authmode': S.authMode = el.dataset.mode; S.authError = null; S.authNotice = null; render(); break;
    case 'copylink': copyText(inviteLink(S.room.code)); break;
    case 'share': shareInTelegram(inviteLink(S.room.code), t('room.shareText', { code: S.room.code })); break;
    case 'addbot': run(() => api('add_bot', { room_id: S.room.id })); break;
    case 'removeseat': run(() => api('remove_seat', { room_id: S.room.id, seat: Number(el.dataset.seat) })); break;
    case 'setplayers': run(() => api('update_room', { room_id: S.room.id, max_players: Number(el.value) })); break;
    case 'settarget': run(() => api('update_room', { room_id: S.room.id, target_score: Number(el.value) })); break;
    case 'setlevel': run(() => api('update_room', { room_id: S.room.id, bot_level: el.value })); break;
    case 'start': if (isLocal()) { localNewGame(); break; } run(() => api('start_game', { room_id: S.room.id })); break;
    case 'backto': go(`#/room/${el.dataset.code}`); break;
    case 'resume': if (resumeLocal()) go('#/offline'); else render(); break;
    case 'guest': playAsGuest(); break;
    case 'leave': if (isLocal()) { pauseLocal(); break; } run(async () => {
      const res = await api('leave_room', { room_id: S.room.id });
      if (!res?.away) rememberRoom(''); // a seat kept mid-game can be returned to from the home screen
      leaveRoomState(); go('#/');
    }); break;
    case 'take': playSelected(S.sel.take); break;
    case 'lay': playSelected(new Set()); break;
    case 'nextdeal': if (isLocal()) { localNextDeal(); break; } run(() => api('next_deal', { game_id: S.gameRow.id })); break;
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
      try {
        await accountApi('signup', {
          email, password, lang: getLang(),
          nickname: String(fd.get('nickname') || '').trim(),
          age: Number(fd.get('age')) || null,
          country: String(fd.get('country') || ''),
          phone: String(fd.get('phone') || '').trim(),
        });
      } catch (err) {
        S.authError = err instanceof ApiError && err.code === 'email_taken' ? t('err.email_taken') : t('err.signup', { msg: err.message });
        return;
      }
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { S.authError = t('err.signin'); return; }
    await loadProfile();
  });
}

async function playAsGuest() {
  const input = document.getElementById('f-guest');
  const nickname = input ? input.value.trim() : '';
  S.authError = null;
  await run(async () => {
    try {
      const res = await accountApi('guest', { nickname, lang: getLang() });
      const { error } = await supabase.auth.setSession({ access_token: res.access_token, refresh_token: res.refresh_token });
      if (error) throw error;
      const { data: { session } } = await supabase.auth.getSession();
      applySession(session);
      await loadProfile();
      enterRoute();
    } catch (err) {
      S.authError = t('err.signup', { msg: err.message });
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
  //    The played card is shown face up on the table before anything is taken,
  //    so you can always see what the other player did.
  if (oneStep) {
    const ev = d.log[d.log.length - 1];
    if (ev.type === 'play') {
      const mine = ev.seat === me;
      const box = mine ? prev.rects[ev.card] : prev.seats[ev.seat];
      const took = ev.take?.length > 0;
      if (REDUCED_MOTION || !box) {
        if (took) { if (ev.sweep) sfx.sweep(); else sfx.take(ev.take.length + 1); } else sfx.lay();
      } else {
        const origin = { cx: box.left + box.width / 2, cy: box.top + box.height / 2 };
        if (took) animateTake(ev, origin, prev, mine);
        else animateLay(ev, origin, box, mine, handled);
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

function cardSize() {
  const r = app.querySelector('#hand .card, #table-cards .card')?.getBoundingClientRect();
  return { w: r?.width || 72, h: r?.height || 104 };
}

// A face-up copy of a card, positioned in the fixed overlay.
function ghostAt(card, x, y, w, h) {
  const g = cardEl(card);
  g.classList.add('fly-ghost');
  Object.assign(g.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
  fx.appendChild(g);
  return g;
}

const EASE = 'cubic-bezier(.2,.8,.2,1)';

// A card laid on the table flies there from its owner and lands face up.
function animateLay(ev, origin, box, mine, handled) {
  const el = app.querySelector(`#table-cards [data-card="${ev.card}"]`);
  if (!el) { sfx.lay(); return; }
  handled.add(ev.card);
  const { w, h } = cardSize();
  const to = el.getBoundingClientRect();
  const x0 = origin.cx - w / 2, y0 = origin.cy - h / 2;
  const ghost = ghostAt(ev.card, x0, y0, w, h);
  el.style.opacity = '0';
  const done = () => { el.style.opacity = ''; ghost.remove(); };
  ghost.animate(
    [{ transform: `scale(${mine ? 1 : .4})`, opacity: mine ? 1 : .6 }, { transform: `translate(${to.left - x0}px, ${to.top - y0}px) scale(1)`, opacity: 1 }],
    { duration: 650, easing: EASE, fill: 'forwards' },
  ).onfinish = () => { done(); sfx.lay(); };
  setTimeout(done, 1000);
}

// The dancing man: three.js is fetched the first time he is needed (and warmed up
// while the table is on screen), so the main page stays light.
function dancerOff() { try { return localStorage.getItem('eleven.dancer') === '0'; } catch { return false; } }
function warmDancer() { if (!S.dancerWarm && !dancerOff()) { S.dancerWarm = true; (window.requestIdleCallback || setTimeout)(() => import('./dancer.js').catch(() => {})); } }
function startDancer() {
  if (dancerOff() || REDUCED_MOTION) return;
  const felt = app.querySelector('.felt')?.getBoundingClientRect();
  if (!felt) return;
  import('./dancer.js').then((m) => m.playDancer(felt, () => sfx.folk(m.DANCER_SECONDS))).catch(() => {});
}

// A short line of big text over the table, and a puff of sparks.
function flashBanner(text, kind = '') {
  const felt = app.querySelector('.felt')?.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = `banner-fx ${kind}`;
  el.textContent = text;
  el.style.left = `${felt ? felt.left + felt.width / 2 : innerWidth / 2}px`;
  el.style.top = `${felt ? felt.top + felt.height * 0.22 : innerHeight * 0.3}px`;
  fx.appendChild(el);
  setTimeout(() => el.remove(), 1900);
}

function burst(x, y) {
  if (REDUCED_MOTION) return;
  for (let i = 0; i < 22; i++) {
    const sp = document.createElement('span');
    sp.className = 'spark';
    sp.textContent = i % 3 === 0 ? '✦' : '●';
    sp.style.left = `${x}px`; sp.style.top = `${y}px`;
    sp.style.fontSize = `${8 + Math.random() * 14}px`;
    fx.appendChild(sp);
    const a = Math.random() * Math.PI * 2, d = 50 + Math.random() * 110;
    sp.animate(
      [{ transform: 'translate(-50%, -50%) scale(1)', opacity: 1 }, { transform: `translate(${Math.cos(a) * d - 8}px, ${Math.sin(a) * d - 8}px) scale(.2)`, opacity: 0 }],
      { duration: 800 + Math.random() * 500, easing: 'cubic-bezier(.1,.8,.3,1)', fill: 'forwards' },
    ).onfinish = () => sp.remove();
  }
}

// A capture: the played card lands on the cards it takes, they light up for a
// moment, then everything slides to the taker's pile.
function animateTake(ev, origin, prev, mine) {
  const { w, h } = cardSize();
  const cards = ev.take;
  const rects = cards.map((c) => prev.rects[c]);
  const pileBox = seatRect(ev.seat);
  if (rects.some((r) => !r) || !pileBox) { if (ev.sweep) sfx.sweep(); else sfx.take(cards.length + 1); return; }

  const pile = { x: pileBox.left + pileBox.width / 2, y: pileBox.top + pileBox.height / 2 };
  const targets = cards.map((c, i) => {
    const g = ghostAt(c, rects[i].left, rects[i].top, rects[i].width, rects[i].height);
    g.classList.add('cap-glow');
    return { g, cx: rects[i].left + rects[i].width / 2, cy: rects[i].top + rects[i].height / 2 };
  });
  const gx = targets.reduce((a, t) => a + t.cx, 0) / targets.length;
  const gy = targets.reduce((a, t) => a + t.cy, 0) / targets.length;

  const x0 = origin.cx - w / 2, y0 = origin.cy - h / 2;
  const played = ghostAt(ev.card, x0, y0, w, h);
  played.style.zIndex = '2';
  const landX = gx - w / 2 + w * 0.22, landY = gy - h / 2 - h * 0.12;
  const all = [{ g: played, cx: landX + w / 2, cy: landY + h / 2 }, ...targets];

  const sweepOut = () => {
    if (ev.sweep) sfx.sweep(); else sfx.take(cards.length + 1);
    all.forEach((t, i) => {
      t.g.animate(
        [{ transform: t.g === played ? `translate(${landX - x0}px, ${landY - y0}px) scale(1.04)` : 'none', opacity: 1 },
         { transform: `translate(${pile.x - t.cx + (t.g === played ? landX - x0 : 0)}px, ${pile.y - t.cy + (t.g === played ? landY - y0 : 0)}px) scale(.3)`, opacity: .1 }],
        { duration: 540, delay: i * 55, easing: 'cubic-bezier(.5,0,.7,.4)', fill: 'forwards' },
      );
    });
  };

  played.animate(
    [{ transform: 'scale(.4)', opacity: .6 }, { transform: `translate(${landX - x0}px, ${landY - y0}px) scale(1.04)`, opacity: 1 }],
    { duration: 600, easing: EASE, fill: 'forwards' },
  ).onfinish = () => {
    // The two cards worth a point each get a moment of their own.
    const ids = [ev.card, ...cards];
    const special = ids.includes('10D') ? 'ten' : ids.includes('2C') ? 'two' : null;
    let hold = 600;
    if (special) {
      hold = 1300;
      const gem = all.find((x) => x.g.dataset.card === (special === 'ten' ? '10D' : '2C'));
      if (gem) { gem.g.classList.add('special'); burst(gem.cx, gem.cy); }
      flashBanner(t(`special.${special}`), 'gold');
      sfx.special();
      startDancer();
    } else if (ev.sweep) {
      hold = 1000; burst(gx, gy); flashBanner(t('banner.sweep')); sfx.tick();
    } else if (E.rankOf(ev.card) === 'J' && cards.length >= 2) {
      hold = 800; flashBanner(t('banner.furti')); sfx.tick();
    } else sfx.tick();
    setTimeout(sweepOut, hold);
  };
  setTimeout(() => all.forEach((t) => t.g.remove()), 3600);
}

boot();
