// Telegram Mini App glue. Everything here is a no-op outside Telegram.
import { SUPABASE_URL, SUPABASE_KEY, TELEGRAM_BOT_USERNAME } from './config.js';

export const tg = typeof window !== 'undefined' ? window.Telegram?.WebApp ?? null : null;

export function inTelegram() { return !!(tg && tg.initData); }

export function telegramLang() { return tg?.initDataUnsafe?.user?.language_code === 'ka' ? 'ka' : null; }

export function startParam() {
  return String(tg?.initDataUnsafe?.start_param || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export function prepareTelegram() {
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    tg.setHeaderColor?.('#0f1417');
    tg.setBackgroundColor?.('#0f1417');
    tg.disableVerticalSwipes?.();
  } catch { /* older clients */ }
}

// Exchange Telegram's signed initData for a Supabase session.
export async function telegramSignIn(supabase, lang) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/tg-auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY },
    body: JSON.stringify({ initData: tg.initData, lang }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message || body?.error || 'telegram sign-in failed');
  const { error } = await supabase.auth.setSession({ access_token: body.access_token, refresh_token: body.refresh_token });
  if (error) throw error;
  return body;
}

// A link that opens the Mini App straight at a table, when the bot is known.
export function roomLinkFor(code, webLink) {
  return TELEGRAM_BOT_USERNAME ? `https://t.me/${TELEGRAM_BOT_USERNAME}?startapp=${code}` : webLink;
}

export function shareInTelegram(url, text) {
  if (!tg) return false;
  try { tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`); return true; }
  catch { return false; }
}

export function haptic(kind = 'light') {
  try {
    if (kind === 'success' || kind === 'error' || kind === 'warning') tg?.HapticFeedback?.notificationOccurred(kind);
    else tg?.HapticFeedback?.impactOccurred(kind);
  } catch { /* ignore */ }
}

export function showBackButton(onClick) {
  if (!tg?.BackButton) return;
  try {
    tg.BackButton.offClick?.(showBackButton._handler);
    showBackButton._handler = onClick;
    tg.BackButton.onClick(onClick);
    tg.BackButton.show();
  } catch { /* ignore */ }
}

export function hideBackButton() {
  try { tg?.BackButton?.hide(); } catch { /* ignore */ }
}
