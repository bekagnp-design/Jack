-- Telegram Mini App users: identity and avatar from Telegram.
alter table public.profiles add column telegram_id bigint unique;
alter table public.profiles add column avatar_url text;
