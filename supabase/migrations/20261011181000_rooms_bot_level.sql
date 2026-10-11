-- The host picks how strong the computer players are.
alter table public.rooms add column bot_level text not null default 'normal' check (bot_level in ('easy', 'normal', 'hard'));
