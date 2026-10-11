// Eleven — sign-in from the Telegram Mini App.
// The client sends Telegram's signed initData; we verify it with the bot token,
// find or create the matching Supabase user, and hand back a session.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const EMAIL_DOMAIN = 'telegram.eleven.app'; // synthetic addresses, never mailed
const MAX_AGE_SECONDS = 24 * 3600;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function hmacHex(key: ArrayBuffer | Uint8Array, message: string) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacRaw(key: ArrayBuffer | Uint8Array, message: string) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, new TextEncoder().encode(message));
}

// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
async function verifyInitData(initData: string) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new Error('no hash');
  params.delete('hash');
  const pairs = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`);
  const dataCheckString = pairs.join('\n');
  const secret = await hmacRaw(new TextEncoder().encode('WebAppData'), BOT_TOKEN);
  const expected = await hmacHex(secret, dataCheckString);
  if (expected !== hash) throw new Error('bad signature');
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_SECONDS) throw new Error('expired');
  const user = JSON.parse(params.get('user') || 'null');
  if (!user?.id) throw new Error('no user');
  return { user, startParam: params.get('start_param') || '' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (!BOT_TOKEN) return json({ error: 'telegram_not_configured', message: 'TELEGRAM_BOT_TOKEN is not set' }, 503);
    const body = await req.json().catch(() => ({}));
    const initData = String(body.initData || '');
    if (!initData) return json({ error: 'bad_request', message: 'initData missing' }, 400);

    let tg;
    try { tg = await verifyInitData(initData); } catch (e) { return json({ error: 'invalid_init_data', message: String(e?.message ?? e) }, 401); }
    const u = tg.user;
    const tgId = String(u.id);
    const email = `tg-${tgId}@${EMAIL_DOMAIN}`;
    // Deterministic, unguessable without the bot token; the user never sees it.
    const password = await hmacHex(new TextEncoder().encode(BOT_TOKEN), `eleven-password:${tgId}`);
    const nickname = String(u.first_name || u.username || 'Player').slice(0, 24);
    const lang = body.lang === 'ka' ? 'ka' : (u.language_code === 'ka' ? 'ka' : 'en');

    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    let { data: signed, error: signErr } = await anon.auth.signInWithPassword({ email, password });
    if (signErr) {
      const { error: createErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { nickname, telegram_id: u.id, telegram_username: u.username ?? null, lang, provider: 'telegram' },
      });
      if (createErr && !/already|exists|registered/i.test(createErr.message)) throw createErr;
      ({ data: signed, error: signErr } = await anon.auth.signInWithPassword({ email, password }));
      if (signErr) throw signErr;
    }
    const session = signed.session!;
    const userId = session.user.id;

    // Keep the profile in step with Telegram (name only on first sight; avatar always).
    const { data: profile } = await admin.from('profiles').select('id, age, country, telegram_id').eq('id', userId).maybeSingle();
    if (!profile) {
      await admin.from('profiles').insert({ id: userId, nickname, lang, telegram_id: u.id, avatar_url: u.photo_url ?? null });
    } else {
      await admin.from('profiles').update({ telegram_id: u.id, avatar_url: u.photo_url ?? null }).eq('id', userId);
    }
    const needsProfile = !profile || profile.age == null || !profile.country;

    return json({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      user_id: userId,
      needs_profile: needsProfile,
      start_param: tg.startParam,
    });
  } catch (e) {
    console.error(e);
    return json({ error: 'internal', message: String(e?.message ?? e) }, 500);
  }
});
