-- Version 3.0.0
-- Apply this migration in Supabase SQL Editor before using the new game systems.

alter table public.player_stats add column if not exists coins bigint not null default 0;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

create table if not exists public.player_items (
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id text not null,
  purchased_at timestamptz not null default now(),
  primary key(user_id,item_id)
);

create table if not exists public.run_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid references public.game_sessions(id) on delete set null,
  settings jsonb not null default '{}'::jsonb,
  destination text not null,
  elapsed_seconds integer not null default 0,
  success boolean not null default false,
  modifier_score integer not null default 0,
  coins_earned bigint not null default 0,
  created_at timestamptz not null default now()
);

alter table public.player_items enable row level security;
alter table public.run_logs enable row level security;

drop policy if exists "items own read" on public.player_items;
drop policy if exists "items own insert" on public.player_items;
create policy "items own read" on public.player_items for select to authenticated using (user_id=auth.uid());
create policy "items own insert" on public.player_items for insert to authenticated with check (user_id=auth.uid());

drop policy if exists "profiles own update" on public.profiles;
create policy "profiles own update" on public.profiles for update to authenticated using (id=auth.uid()) with check (id=auth.uid());

drop policy if exists "run logs own read" on public.run_logs;
create policy "run logs own read" on public.run_logs for select to authenticated using (user_id=auth.uid());
drop policy if exists "run logs own insert" on public.run_logs;
create policy "run logs own insert" on public.run_logs for insert to authenticated with check (user_id=auth.uid());

create or replace function public.award_coins(amount bigint)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if amount < 0 or amount > 100000 then raise exception 'Invalid coin amount'; end if;
  update public.player_stats set coins=coins+amount where user_id=auth.uid();
end; $$;

create or replace function public.spend_coins(amount bigint)
returns void language plpgsql security definer set search_path=public as $$
declare balance bigint;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if amount <= 0 or amount > 100000 then raise exception 'Invalid coin amount'; end if;
  select coins into balance from public.player_stats where user_id=auth.uid() for update;
  if coalesce(balance,0) < amount then raise exception 'Not enough coins'; end if;
  update public.player_stats set coins=coins-amount where user_id=auth.uid();
end; $$;

create or replace function public.complete_game(target_session uuid)
returns void language plpgsql security definer set search_path=public as $$
declare caller uuid := auth.uid(); required_count integer; evidence_found integer; players_not_extracted integer;
begin
  if caller is null then raise exception 'Not authenticated'; end if;
  if not exists(select 1 from public.session_players where session_id=target_session and user_id=caller) then raise exception 'You are not in this session'; end if;
  if not exists(select 1 from public.game_sessions where id=target_session and status='active') then raise exception 'Session is not active'; end if;
  select greatest(2,least(15,coalesce((state_value->>'evidence')::integer,4))) into required_count from public.game_state where session_id=target_session and state_key='settings';
  if required_count is null then required_count:=4; end if;
  select count(*) into evidence_found from public.game_state where session_id=target_session and state_key like 'evidence:r%' and state_value->>'item' is not null;
  if evidence_found < required_count then raise exception 'All required evidence has not been recovered'; end if;
  select count(*) into players_not_extracted from public.session_players sp where sp.session_id=target_session and not exists(select 1 from public.game_state gs where gs.session_id=target_session and gs.state_key='extracted:'||sp.user_id);
  if players_not_extracted > 0 then raise exception 'Every player must extract'; end if;
  update public.game_sessions set status='completed',completed_at=now() where id=target_session;
  update public.player_stats set games_won=games_won+1 where user_id in (select user_id from public.session_players where session_id=target_session);
  update public.player_stats set extractions=extractions+1 where user_id=caller;
end; $$;

revoke execute on function public.award_coins(bigint) from public, anon;
revoke execute on function public.spend_coins(bigint) from public, anon;
grant execute on function public.award_coins(bigint) to authenticated;
grant execute on function public.spend_coins(bigint) to authenticated;
revoke execute on function public.increment_stat(uuid,text,bigint) from anon;
revoke execute on function public.complete_game(uuid) from anon;
grant execute on function public.increment_stat(uuid,text,bigint) to authenticated;
grant execute on function public.complete_game(uuid) to authenticated;

-- Username changes are handled by the trusted Edge Function under supabase/functions/change-username.
