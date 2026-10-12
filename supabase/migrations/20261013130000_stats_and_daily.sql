-- Win/loss statistics (written by the game function) and the daily deal leaderboard.
create table public.player_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  games int not null default 0,
  wins int not null default 0,
  streak int not null default 0,
  best_streak int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.player_stats enable row level security;
create policy "stats are readable by signed-in users" on public.player_stats
  for select to authenticated using (true);

create table public.daily_results (
  day date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null,
  points int not null,
  cards int not null,
  margin int not null,
  moves jsonb not null,
  created_at timestamptz not null default now(),
  primary key (day, user_id)
);
alter table public.daily_results enable row level security;
create policy "daily results are readable by signed-in users" on public.daily_results
  for select to authenticated using (true);
create index daily_results_rank on public.daily_results (day, points desc, cards desc, margin desc);
