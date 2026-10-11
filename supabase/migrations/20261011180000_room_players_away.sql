-- A player who leaves mid-game keeps the seat; the computer plays until they return.
alter table public.room_players add column away boolean not null default false;
