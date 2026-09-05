-- Version 1.0.0
-- Run this entire file once in Supabase > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[A-Za-z0-9_]{3,24}$'),
  nickname text not null check (char_length(nickname) between 2 and 28),
  created_at timestamptz not null default now()
);

create table if not exists public.player_stats (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  games_played bigint not null default 0,
  games_won bigint not null default 0,
  clues_found bigint not null default 0,
  puzzles_solved bigint not null default 0,
  times_caught bigint not null default 0,
  extractions bigint not null default 0
);

create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (char_length(code)=6),
  host_id uuid not null references public.profiles(id),
  status text not null default 'active' check (status in ('active','completed','abandoned')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.session_players (
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  room text not null default 'lobby',
  is_hidden boolean not null default false,
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key(session_id,user_id)
);

create table if not exists public.game_state (
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  state_key text not null,
  state_value jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key(session_id,state_key)
);

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now()
);

create unique index if not exists profiles_username_lower_unique on public.profiles (lower(username));

create or replace function public.handle_player_join() returns trigger language plpgsql security definer set search_path=public as $$
begin
  update public.player_stats set games_played=games_played+1 where user_id=new.user_id;
  return new;
end; $$;

drop trigger if exists on_session_player_joined on public.session_players;
create trigger on_session_player_joined after insert on public.session_players for each row execute procedure public.handle_player_join();

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare desired_username text; desired_nickname text;
begin
  desired_username := coalesce(new.raw_user_meta_data->>'username','detective_' || substr(new.id::text,1,8));
  desired_nickname := coalesce(new.raw_user_meta_data->>'nickname',desired_username);
  insert into public.profiles(id,username,nickname) values(new.id,desired_username,desired_nickname);
  insert into public.player_stats(user_id) values(new.id);
  return new;
exception when unique_violation then
  raise exception 'Username already taken';
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.increment_stat(target_user uuid, stat_name text, amount bigint default 1)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if target_user <> auth.uid() then raise exception 'Cannot alter another player'; end if;
  if stat_name = 'games_played' then update player_stats set games_played=games_played+amount where user_id=target_user;
  elsif stat_name = 'games_won' then update player_stats set games_won=games_won+amount where user_id=target_user;
  elsif stat_name = 'clues_found' then update player_stats set clues_found=clues_found+amount where user_id=target_user;
  elsif stat_name = 'puzzles_solved' then update player_stats set puzzles_solved=puzzles_solved+amount where user_id=target_user;
  elsif stat_name = 'times_caught' then update player_stats set times_caught=times_caught+amount where user_id=target_user;
  elsif stat_name = 'extractions' then update player_stats set extractions=extractions+amount where user_id=target_user;
  else raise exception 'Invalid stat'; end if;
end; $$;


create or replace function public.complete_game(target_session uuid)
returns void language plpgsql security definer set search_path=public as $$
declare caller uuid := auth.uid(); missing_evidence bigint; players_not_ready bigint;
begin
  if caller is null then raise exception 'Not authenticated'; end if;
  if not exists(select 1 from session_players where session_id=target_session and user_id=caller) then raise exception 'You are not in this session'; end if;
  if not exists(select 1 from game_sessions where id=target_session and status='active') then raise exception 'Session is not active'; end if;
  select count(*) into missing_evidence from (values ('evidence:keycard'),('evidence:morse'),('evidence:photo'),('evidence:ledger')) as required(k)
    where not exists(select 1 from game_state gs where gs.session_id=target_session and gs.state_key=required.k);
  if missing_evidence > 0 then raise exception 'All evidence has not been recovered'; end if;
  select count(*) into players_not_ready from session_players where session_id=target_session and room <> 'loading';
  if players_not_ready > 0 then raise exception 'Every player must be at the loading bay'; end if;
  update game_sessions set status='completed',completed_at=now() where id=target_session;
  update player_stats set games_won=games_won+1 where user_id in (select user_id from session_players where session_id=target_session);
  update player_stats set extractions=extractions+1 where user_id=caller;
end; $$;

alter table public.profiles enable row level security;
alter table public.player_stats enable row level security;
alter table public.game_sessions enable row level security;
alter table public.session_players enable row level security;
alter table public.game_state enable row level security;
alter table public.messages enable row level security;

create policy "profiles public read" on public.profiles for select using (true);
create policy "stats public read" on public.player_stats for select using (true);
create policy "sessions authenticated read" on public.game_sessions for select to authenticated using (true);
create policy "sessions create own" on public.game_sessions for insert to authenticated with check (host_id=auth.uid());
create policy "sessions host update" on public.game_sessions for update to authenticated using (host_id=auth.uid());
create policy "session players read" on public.session_players for select to authenticated using (true);
create policy "session players join self" on public.session_players for insert to authenticated with check (user_id=auth.uid());
create policy "session players update self" on public.session_players for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy "session players leave self" on public.session_players for delete to authenticated using (user_id=auth.uid());
create policy "state read" on public.game_state for select to authenticated using (true);
create policy "state insert member" on public.game_state for insert to authenticated with check (exists(select 1 from public.session_players sp where sp.session_id=game_state.session_id and sp.user_id=auth.uid()));
create policy "state update member" on public.game_state for update to authenticated using (exists(select 1 from public.session_players sp where sp.session_id=game_state.session_id and sp.user_id=auth.uid()));
create policy "messages read" on public.messages for select to authenticated using (exists(select 1 from public.session_players sp where sp.session_id=messages.session_id and sp.user_id=auth.uid()));
create policy "messages send" on public.messages for insert to authenticated with check (user_id=auth.uid() and exists(select 1 from public.session_players sp where sp.session_id=messages.session_id and sp.user_id=auth.uid()));

-- Realtime tables. Safe to ignore duplicate-publication errors if you rerun these lines manually.
alter publication supabase_realtime add table public.session_players;
alter publication supabase_realtime add table public.game_state;
alter publication supabase_realtime add table public.messages;
