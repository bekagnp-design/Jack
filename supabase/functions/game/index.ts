// Eleven (თერთმეტი) — the only writer of rooms and games.
// Every request carries the player's JWT; the function verifies it, then acts
// with the service role so hands and the deck never leave the server.
import { createClient } from 'npm:@supabase/supabase-js@2';
import * as E from './engine.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const BOT_DELAY_MS = 1100;
const TIMEOUT_TOLERANCE_MS = 1500; // clients may call auto_play this much before the server clock says so
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

class ApiError extends Error {
  status: number;
  code: string;
  constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status; }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) throw new ApiError('unauthorized', 'Sign in first', 401);
    const { data: { user }, error } = await admin.auth.getUser(token);
    if (error || !user) throw new ApiError('unauthorized', 'Sign in first', 401);
    const body = await req.json().catch(() => ({}));
    const result = await handle(user.id, body);
    return json(result);
  } catch (e) {
    if (e instanceof ApiError) return json({ error: e.code, message: e.message }, e.status);
    if (e instanceof E.GameError) return json({ error: e.code, message: e.message }, 400);
    console.error(e);
    return json({ error: 'internal', message: String(e?.message ?? e) }, 500);
  }
});

// ---------- dispatch ----------

async function handle(uid: string, body: any) {
  switch (body.action) {
    case 'create_room': return createRoom(uid, body);
    case 'join_room': return joinRoom(uid, body);
    case 'leave_room': return leaveRoom(uid, body);
    case 'add_bot': return addBot(uid, body);
    case 'remove_seat': return removeSeat(uid, body);
    case 'update_room': return updateRoom(uid, body);
    case 'start_game': return startGame(uid, body);
    case 'play': return play(uid, body);
    case 'auto_play': return autoPlay(uid, body);
    case 'next_deal': return nextDeal(uid, body);
    case 'back_to_lobby': return backToLobby(uid, body);
    default: throw new ApiError('bad_action', `Unknown action: ${body.action}`);
  }
}

// ---------- helpers ----------

async function profileName(uid: string) {
  const { data } = await admin.from('profiles').select('nickname').eq('id', uid).maybeSingle();
  return data?.nickname ?? 'Player';
}

async function loadRoom(roomId: string) {
  const { data: room, error } = await admin.from('rooms').select('*').eq('id', roomId).maybeSingle();
  if (error) throw error;
  if (!room) throw new ApiError('room_not_found', 'Room not found', 404);
  const { data: seats } = await admin.from('room_players').select('*').eq('room_id', roomId).order('seat');
  return { room, seats: seats ?? [] };
}

function requireHost(room: any, uid: string) {
  if (room.host_id !== uid) throw new ApiError('not_host', 'Only the host can do that', 403);
}

function freeSeat(seats: any[], max: number) {
  for (let s = 0; s < max; s++) if (!seats.some((p) => p.seat === s)) return s;
  return -1;
}

function makeCode() {
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

async function touchRoom(roomId: string, patch: Record<string, unknown> = {}) {
  const { error } = await admin.from('rooms').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', roomId);
  if (error) throw error;
}

async function updateSeat(roomId: string, seat: number, patch: Record<string, unknown>) {
  const { error } = await admin.from('room_players').update(patch).eq('room_id', roomId).eq('seat', seat);
  if (error) throw error;
}

// ---------- rooms ----------

function botLevel(v: unknown, dflt = 'normal') {
  return E.BOT_LEVELS.includes(String(v)) ? String(v) : dflt;
}

async function createRoom(uid: string, body: any) {
  const max_players = clampInt(body.max_players, 2, 4, 2);
  const target_score = clampInt(body.target_score, 1, 101, 11);
  const bot_level = botLevel(body.bot_level);
  const name = await profileName(uid);
  let room: any = null;
  for (let attempt = 0; attempt < 5 && !room; attempt++) {
    const { data, error } = await admin.from('rooms')
      .insert({ code: makeCode(), host_id: uid, max_players, target_score, bot_level })
      .select('*').maybeSingle();
    if (error && error.code !== '23505') throw error;
    room = data;
  }
  if (!room) throw new ApiError('internal', 'Could not create a room', 500);
  const { error } = await admin.from('room_players').insert({ room_id: room.id, seat: 0, user_id: uid, is_bot: false, name });
  if (error) throw error;
  return { room };
}

// Join by code. Returning players get their seat back; newcomers take a free
// seat before the game, or a bot's seat at any time.
async function joinRoom(uid: string, body: any) {
  const code = String(body.code ?? '').trim().toUpperCase();
  const { data: room } = await admin.from('rooms').select('*').eq('code', code).maybeSingle();
  if (!room) throw new ApiError('room_not_found', 'No room with that code', 404);
  const { data: seatRows } = await admin.from('room_players').select('*').eq('room_id', room.id);
  const seats = seatRows ?? [];
  const mine = seats.find((p) => p.user_id === uid);
  if (mine) {
    if (mine.away) await returnToSeat(room, mine);
    return { room };
  }

  const name = await profileName(uid);
  let seat = room.status === 'playing' ? -1 : freeSeat(seats, room.max_players);
  let takeover: any = null;
  if (seat < 0) {
    takeover = seats.find((p) => p.is_bot && !p.user_id);
    if (!takeover) throw new ApiError(room.status === 'playing' ? 'room_started' : 'room_full', room.status === 'playing' ? 'That game is full' : 'That room is full');
    seat = takeover.seat;
  }

  if (takeover) {
    await updateSeat(room.id, seat, { user_id: uid, is_bot: false, name, away: false });
    if (room.status === 'playing' && room.game_id) {
      const state = await loadState(room.game_id);
      const expected = state.version;
      E.seatHuman(state, seat, { id: uid, name });
      await persist(room.game_id, state, expected);
      scheduleBots(room.game_id);
    }
  } else {
    const { error } = await admin.from('room_players').insert({ room_id: room.id, seat, user_id: uid, is_bot: false, name });
    if (error) {
      if (error.code === '23505') return { room }; // raced with ourselves
      throw error;
    }
  }
  await touchRoom(room.id);
  return { room };
}

async function returnToSeat(room: any, mine: any) {
  await updateSeat(room.id, mine.seat, { away: false });
  if (room.status === 'playing' && room.game_id) {
    const state = await loadState(room.game_id);
    if (state.players[mine.seat]?.away) {
      const expected = state.version;
      E.setAway(state, mine.seat, false);
      await persist(room.game_id, state, expected);
    }
  }
  await touchRoom(room.id);
}

async function leaveRoom(uid: string, body: any) {
  const { room, seats } = await loadRoom(body.room_id);
  const mine = seats.find((p) => p.user_id === uid);
  if (!mine) return { ok: true };

  if (room.status === 'playing' && room.game_id) {
    // Mid-game the seat stays theirs; the computer plays until they come back.
    await updateSeat(room.id, mine.seat, { away: true });
    const state = await loadState(room.game_id);
    const expected = state.version;
    E.setAway(state, mine.seat, true);
    await persist(room.game_id, state, expected);
    if (room.host_id === uid) await transferHost(room.id, seats.filter((s) => s.user_id && s.user_id !== uid && !s.away));
    await touchRoom(room.id);
    scheduleBots(room.game_id);
    return { ok: true, away: true };
  }

  await admin.from('room_players').delete().eq('room_id', room.id).eq('seat', mine.seat);
  const humans = seats.filter((s) => s.user_id && s.user_id !== uid);
  if (room.host_id === uid) {
    if (!humans.length) { await admin.from('rooms').delete().eq('id', room.id); return { ok: true, deleted: true }; }
    await transferHost(room.id, humans);
  }
  await touchRoom(room.id);
  return { ok: true };
}

async function transferHost(roomId: string, humans: any[]) {
  if (!humans.length) return;
  await touchRoom(roomId, { host_id: humans[0].user_id });
}

async function addBot(uid: string, body: any) {
  const { room, seats } = await loadRoom(body.room_id);
  requireHost(room, uid);
  if (room.status === 'playing') throw new ApiError('room_started', 'The game has already started');
  const seat = freeSeat(seats, room.max_players);
  if (seat < 0) throw new ApiError('room_full', 'The room is full');
  const { error } = await admin.from('room_players').insert({ room_id: room.id, seat, user_id: null, is_bot: true, name: `Bot ${seat + 1}` });
  if (error) throw error;
  await touchRoom(room.id);
  return { ok: true, seat };
}

async function removeSeat(uid: string, body: any) {
  const { room, seats } = await loadRoom(body.room_id);
  requireHost(room, uid);
  if (room.status === 'playing') throw new ApiError('room_started', 'The game has already started');
  const target = seats.find((p) => p.seat === Number(body.seat));
  if (!target) return { ok: true };
  if (target.user_id === uid) throw new ApiError('cannot_remove_self', 'Leave the room instead');
  await admin.from('room_players').delete().eq('room_id', room.id).eq('seat', target.seat);
  await touchRoom(room.id);
  return { ok: true };
}

async function updateRoom(uid: string, body: any) {
  const { room, seats } = await loadRoom(body.room_id);
  requireHost(room, uid);
  if (room.status === 'playing') throw new ApiError('room_started', 'The game has already started');
  const patch: Record<string, unknown> = {};
  if (body.max_players != null) {
    const m = clampInt(body.max_players, 2, 4, room.max_players);
    if (seats.some((p) => p.seat >= m)) throw new ApiError('seats_taken', 'Remove players first');
    patch.max_players = m;
  }
  if (body.target_score != null) patch.target_score = clampInt(body.target_score, 1, 101, room.target_score);
  if (body.bot_level != null) patch.bot_level = botLevel(body.bot_level, room.bot_level);
  await touchRoom(room.id, patch);
  return { ok: true };
}

// ---------- games ----------

async function startGame(uid: string, body: any) {
  const { room, seats } = await loadRoom(body.room_id);
  requireHost(room, uid);
  if (room.status === 'playing') throw new ApiError('room_started', 'The game is already running');

  // Empty seats are filled by bots so the table is always full.
  for (let s = 0; s < room.max_players; s++) {
    if (!seats.some((p) => p.seat === s)) {
      const row = { room_id: room.id, seat: s, user_id: null, is_bot: true, name: `Bot ${s + 1}`, away: false };
      const { error } = await admin.from('room_players').insert(row);
      if (error) throw error;
      seats.push(row);
    }
  }
  seats.sort((a, b) => a.seat - b.seat);
  if (seats.length < 2) throw new ApiError('not_enough_players', 'Need at least two players');

  // Dealer rotates between games too: the previous game's dealer + 1.
  let dealer = 0;
  if (room.game_id) {
    const { data: prev } = await admin.from('games').select('public').eq('id', room.game_id).maybeSingle();
    if (prev?.public?.dealer != null) dealer = (prev.public.dealer + 1) % seats.length;
  }

  const state = E.newGame({
    players: seats.map((p) => ({ id: p.user_id, name: p.name, bot: p.is_bot })),
    targetScore: room.target_score,
    dealer,
  });
  state.botLevel = botLevel(room.bot_level);
  for (const p of seats) if (p.away && !p.is_bot) state.players[p.seat].away = true;

  const { data: game, error } = await admin.from('games')
    .insert({ room_id: room.id, public: E.publicView(state), version: state.version })
    .select('id').single();
  if (error) throw error;
  const { error: e2 } = await admin.from('game_secrets').insert({ game_id: game.id, state });
  if (e2) throw e2;
  await writeHands(game.id, state);
  await touchRoom(room.id, { status: 'playing', game_id: game.id });
  scheduleBots(game.id);
  return { game_id: game.id };
}

async function loadState(gameId: string) {
  const { data, error } = await admin.from('game_secrets').select('state').eq('game_id', gameId).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError('game_not_found', 'Game not found', 404);
  return data.state;
}

async function writeHands(gameId: string, state: any) {
  const rows = state.players.map((p: any) => ({
    game_id: gameId, seat: p.seat, user_id: p.bot ? null : p.id, cards: E.handOf(state, p.seat), version: state.version,
  }));
  const { error } = await admin.from('game_hands').upsert(rows);
  if (error) throw error;
}

// Optimistic lock on the secret state's version: whoever updates first wins,
// the other request sees a conflict and the client simply re-reads.
async function persist(gameId: string, state: any, expectedVersion: number) {
  const { data, error } = await admin.from('game_secrets')
    .update({ state, updated_at: new Date().toISOString() })
    .eq('game_id', gameId).eq('state->>version', String(expectedVersion))
    .select('game_id');
  if (error) throw error;
  if (!data?.length) throw new ApiError('conflict', 'The game moved on, try again', 409);

  const finished = state.phase === 'game_over';
  const { error: e2 } = await admin.from('games')
    .update({ public: E.publicView(state), version: state.version, status: finished ? 'finished' : 'playing', updated_at: new Date().toISOString() })
    .eq('id', gameId);
  if (e2) throw e2;
  await writeHands(gameId, state);
  if (finished) {
    const { data: g } = await admin.from('games').select('room_id').eq('id', gameId).maybeSingle();
    if (g) await touchRoom(g.room_id, { status: 'finished' });
  }
}

function seatOf(state: any, uid: string) {
  const p = state.players.find((p: any) => p.id === uid && !p.bot);
  if (!p) throw new ApiError('not_in_game', 'You are not in this game', 403);
  return p.seat;
}

async function play(uid: string, body: any) {
  const state = await loadState(body.game_id);
  const seat = seatOf(state, uid);
  const expected = state.version;
  const event = E.play(state, seat, String(body.card), Array.isArray(body.take) ? body.take.map(String) : []);
  await persist(body.game_id, state, expected);
  scheduleBots(body.game_id);
  return { ok: true, event, version: state.version };
}

// Any player at the table may ask the server to move for someone whose time ran out.
async function autoPlay(uid: string, body: any) {
  const state = await loadState(body.game_id);
  seatOf(state, uid);
  if (state.phase !== 'deal') return { ok: false };
  if (!E.turnExpired(state, Date.now() + TIMEOUT_TOLERANCE_MS)) {
    return { ok: false, remainingMs: Math.max(0, state.deal.turnStartedAt + E.TURN_SECONDS * 1000 - Date.now()) };
  }
  const seat = state.deal.current;
  const expected = state.version;
  const move = E.botMove(state, seat, 'normal'); // a stand-in move for a person, not a bot's level
  const event = E.play(state, seat, move.card, move.take);
  event.auto = true;
  await persist(body.game_id, state, expected);
  scheduleBots(body.game_id);
  return { ok: true, version: state.version };
}

async function nextDeal(uid: string, body: any) {
  const state = await loadState(body.game_id);
  seatOf(state, uid);
  const expected = state.version;
  if (state.phase !== 'deal_over') return { ok: true, version: state.version };
  E.nextDeal(state);
  await persist(body.game_id, state, expected);
  scheduleBots(body.game_id);
  return { ok: true, version: state.version };
}

async function backToLobby(uid: string, body: any) {
  const { room } = await loadRoom(body.room_id);
  requireHost(room, uid);
  if (room.status === 'playing') throw new ApiError('room_started', 'The game is still running');
  // Bots that filled empty seats stay listed so the host can swap them for friends.
  await touchRoom(room.id, { status: 'lobby' });
  return { ok: true };
}

// ---------- bots ----------

// The computer plays after the response is sent, one move per BOT_DELAY_MS,
// for bots and for players who are away, until a present human is on turn.
function scheduleBots(gameId: string) {
  const p = runBots(gameId).catch((e) => console.error('bots', e));
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p);
}

async function runBots(gameId: string) {
  for (let i = 0; i < 64; i++) {
    const state = await loadState(gameId);
    if (!E.isComputerTurn(state)) return;
    await new Promise((r) => setTimeout(r, BOT_DELAY_MS));
    const fresh = await loadState(gameId);
    if (fresh.version !== state.version) return; // someone else moved; their request runs the bots
    if (!E.isComputerTurn(fresh)) return;
    const seat = fresh.deal.current;
    const p = fresh.players[seat];
    const move = E.botMove(fresh, seat, p.bot ? (fresh.botLevel || 'normal') : 'normal');
    const expected = fresh.version;
    E.play(fresh, seat, move.card, move.take);
    try {
      await persist(gameId, fresh, expected);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'conflict') return;
      throw e;
    }
  }
}

function clampInt(v: unknown, lo: number, hi: number, dflt: number) {
  const n = parseInt(String(v), 10);
  if (Number.isNaN(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}
