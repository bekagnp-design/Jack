import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 20 } },
});

export class ApiError extends Error {
  constructor(code, message, status) { super(message || code); this.code = code; this.status = status; }
}

// Every game action goes through the `game` edge function.
export async function api(action, payload = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new ApiError('unauthorized', 'Sign in first', 401);
  const res = await fetch(`${SUPABASE_URL}/functions/v1/game`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  }).catch(() => { throw new ApiError('offline', 'No connection'); });
  let body = null;
  try { body = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw new ApiError(body?.error || 'generic', body?.message, res.status);
  return body;
}
