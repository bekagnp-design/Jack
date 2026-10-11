-- Eleven (თერთმეტი) — core schema. Applied to Supabase project "Eleven" (acknnwflahxlripuybwl).
-- All writes to rooms/games go through the `game` edge function (service role);
-- clients only read, except their own profile.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 2 and 24),
  age int check (age between 5 and 120),
  country text,
  phone text,
  lang text not null default 'en',
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles are readable by signed-in users" on public.profiles
  for select to authenticated using (true);
create policy "users insert their own profile" on public.profiles
  for insert to authenticated with check (auth.uid() = id);
create policy "users update their own profile" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nickname, age, country, phone, lang)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'nickname', ''), split_part(coalesce(new.email, 'player'), '@', 1)),
    nullif(new.raw_user_meta_data->>'age', '')::int,
    nullif(new.raw_user_meta_data->>'country', ''),
    nullif(new.raw_user_meta_data->>'phone', ''),
    coalesce(nullif(new.raw_user_meta_data->>'lang', ''), 'en')
  )
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_id uuid not null references auth.users(id) on delete cascade,
  max_players int not null default 2 check (max_players between 2 and 4),
  target_score int not null default 11 check (target_score between 1 and 101),
  status text not null default 'lobby' check (status in ('lobby', 'playing', 'finished')),
  game_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.rooms enable row level security;
create policy "rooms are readable by signed-in users" on public.rooms
  for select to authenticated using (true);

create table public.room_players (
  room_id uuid not null references public.rooms(id) on delete cascade,
  seat int not null check (seat between 0 and 3),
  user_id uuid references auth.users(id) on delete cascade,
  is_bot boolean not null default false,
  name text not null,
  joined_at timestamptz not null default now(),
  primary key (room_id, seat),
  unique (room_id, user_id)
);
alter table public.room_players enable row level security;
create policy "room players are readable by signed-in users" on public.room_players
  for select to authenticated using (true);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  public jsonb not null,
  version int not null default 0,
  status text not null default 'playing' check (status in ('playing', 'finished')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index games_room_idx on public.games(room_id);
alter table public.games enable row level security;
create policy "games are readable by signed-in users" on public.games
  for select to authenticated using (true);

-- Full state (deck order, every hand). No policies: only the service role reads it.
create table public.game_secrets (
  game_id uuid primary key references public.games(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.game_secrets enable row level security;

-- Each player's own hand, readable only by that player (bots have no user).
create table public.game_hands (
  game_id uuid not null references public.games(id) on delete cascade,
  seat int not null,
  user_id uuid,
  cards jsonb not null default '[]'::jsonb,
  version int not null default 0,
  primary key (game_id, seat)
);
alter table public.game_hands enable row level security;
create policy "players read their own hand" on public.game_hands
  for select to authenticated using (user_id = auth.uid());

-- Realtime: clients subscribe to room, seats, public game state and their hand.
alter table public.rooms replica identity full;
alter table public.room_players replica identity full;
alter table public.games replica identity full;
alter table public.game_hands replica identity full;
alter publication supabase_realtime add table public.rooms, public.room_players, public.games, public.game_hands;
