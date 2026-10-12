// Eleven — account creation without e-mail round trips.
//  guest : a throw-away account with a chosen (or generated) name, signed in at once
//  signup: a normal account, marked confirmed so the player can sign in immediately
// Both are created through the admin API, so the project's "Confirm email"
// setting does not get in the way. (Real e-mail verification is on the roadmap.)
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function cleanName(v: unknown) {
  return String(v ?? '').replace(/[<>]/g, '').trim().slice(0, 24);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const lang = body.lang === 'ka' ? 'ka' : 'en';

    if (body.action === 'guest') {
      let nickname = cleanName(body.nickname);
      if (nickname.length < 2) nickname = `Guest ${1000 + Math.floor(Math.random() * 9000)}`;
      const id = crypto.randomUUID();
      const email = `guest-${id}@guest.eleven.app`;
      const password = crypto.randomUUID() + crypto.randomUUID();
      const { error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { nickname, lang, provider: 'guest', guest: true },
      });
      if (error) throw error;
      const { data, error: e2 } = await anon.auth.signInWithPassword({ email, password });
      if (e2 || !data.session) throw e2 ?? new Error('no session');
      return json({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        user_id: data.session.user.id,
        nickname,
      });
    }

    if (body.action === 'signup') {
      const email = String(body.email ?? '').trim().toLowerCase();
      const password = String(body.password ?? '');
      const nickname = cleanName(body.nickname);
      const age = Number(body.age) || null;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'bad_email', message: 'Invalid e-mail' }, 400);
      if (password.length < 6) return json({ error: 'weak_password', message: 'Password is too short' }, 400);
      if (nickname.length < 2) return json({ error: 'bad_name', message: 'Name is too short' }, 400);
      if (age != null && (age < 5 || age > 120)) return json({ error: 'bad_age', message: 'Invalid age' }, 400);
      const { error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: {
          nickname, age, lang,
          country: String(body.country ?? '').slice(0, 8),
          phone: String(body.phone ?? '').slice(0, 24),
        },
      });
      if (error) {
        if (/already|exists|registered/i.test(error.message)) return json({ error: 'email_taken', message: 'E-mail already registered' }, 409);
        throw error;
      }
      return json({ ok: true });
    }

    return json({ error: 'bad_action', message: 'Unknown action' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: 'internal', message: String((e as Error)?.message ?? e) }, 500);
  }
});
