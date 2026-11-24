-- Arabic Coach App: database setup.
-- Run once in Supabase: SQL Editor -> New query -> paste all of this -> Run.

-- One row per learner. Learners can edit their own settings, but never their plan.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  explain_lang text not null default 'Hindi' check (explain_lang in ('Hindi','Urdu','English')),
  goal text not null default 'customers',
  plan text not null default 'free' check (plan in ('free','pro','company')),
  new_per_day int not null default 10,
  streak int not null default 0,
  last_day date,
  created_at timestamptz not null default now()
);

-- Spaced-review state for each of the 1,000 core words a learner has started.
create table if not exists public.progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  word int not null check (word >= 0 and word < 1000),
  box int not null default 1 check (box between 0 and 5),
  due date not null default current_date,
  updated_at timestamptz not null default now(),
  primary key (user_id, word)
);

-- AI requests per learner per day (written only by the server, for free-plan limits and cost tracking).
create table if not exists public.usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  calls int not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  primary key (user_id, day)
);

-- Explanations shared by all learners, so each sentence is explained (and paid for) once per language.
create table if not exists public.explain_cache (
  key text primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.progress enable row level security;
alter table public.usage enable row level security;
alter table public.explain_cache enable row level security;

drop policy if exists "own profile read" on public.profiles;
create policy "own profile read" on public.profiles for select using (auth.uid() = id);
drop policy if exists "own profile insert" on public.profiles;
create policy "own profile insert" on public.profiles for insert with check (auth.uid() = id and plan = 'free');
drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles for update using (auth.uid() = id);
-- Learners may change these columns only (not plan).
revoke update on public.profiles from authenticated;
grant update (name, explain_lang, goal, new_per_day, streak, last_day) on public.profiles to authenticated;

drop policy if exists "own progress" on public.progress;
create policy "own progress" on public.progress for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own usage read" on public.usage;
create policy "own usage read" on public.usage for select using (auth.uid() = user_id);
-- usage and explain_cache have no write policies: only the server (service role key) writes them.

-- Atomic usage counter used by the server.
create or replace function public.add_usage(p_user uuid, p_day date, p_in bigint, p_out bigint)
returns void language sql security definer set search_path = public as $$
  insert into public.usage (user_id, day, calls, input_tokens, output_tokens)
  values (p_user, p_day, 1, p_in, p_out)
  on conflict (user_id, day) do update
  set calls = usage.calls + 1,
      input_tokens = usage.input_tokens + excluded.input_tokens,
      output_tokens = usage.output_tokens + excluded.output_tokens;
$$;
revoke execute on function public.add_usage from public, anon, authenticated;

-- Table access (new Supabase projects grant nothing by default). Row-level security still limits each learner to their own rows.
revoke all on public.profiles, public.progress, public.usage, public.explain_cache from anon, authenticated;
grant select, insert on public.profiles to authenticated;
grant update (name, explain_lang, goal, new_per_day, streak, last_day) on public.profiles to authenticated;
grant select, insert, update, delete on public.progress to authenticated;
grant select on public.usage to authenticated;
grant all on public.profiles, public.progress, public.usage, public.explain_cache to service_role;

-- ===== Version 0.2/0.3 (applied as migrations learner_docs, docs_size_cap, usage_reservation_and_quota) =====
create table if not exists public.docs (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  path text not null check (length(path) between 1 and 200),
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, path)
);
alter table public.docs enable row level security;
create policy "own docs" on public.docs for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.docs from anon, authenticated;
grant select, insert, update, delete on public.docs to authenticated;
grant all on public.docs to service_role;
create index if not exists docs_user_path_prefix on public.docs (user_id, path text_pattern_ops);
alter table public.docs add constraint docs_size_cap check (octet_length(data::text) <= 300000);

create or replace function public.reserve_call(p_user uuid, p_day date, p_limit int)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.usage (user_id, day, calls) values (p_user, p_day, 0) on conflict (user_id, day) do nothing;
  update public.usage set calls = calls + 1 where user_id = p_user and day = p_day and calls < p_limit returning calls into n;
  return n;
end $$;
revoke execute on function public.reserve_call from public, anon, authenticated;
grant execute on function public.reserve_call to service_role;
create or replace function public.add_tokens(p_user uuid, p_day date, p_in bigint, p_out bigint)
returns void language sql security definer set search_path = public as $$
  update public.usage set input_tokens = input_tokens + p_in, output_tokens = output_tokens + p_out where user_id = p_user and day = p_day;
$$;
revoke execute on function public.add_tokens from public, anon, authenticated;
grant execute on function public.add_tokens to service_role;
create or replace function public.refund_call(p_user uuid, p_day date)
returns void language sql security definer set search_path = public as $$
  update public.usage set calls = greatest(calls - 1, 0) where user_id = p_user and day = p_day;
$$;
revoke execute on function public.refund_call from public, anon, authenticated;
grant execute on function public.refund_call to service_role;
create or replace function public.docs_quota() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.docs where user_id = new.user_id) >= 3000 then
    raise exception 'storage quota reached' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function public.docs_quota from public, anon, authenticated;
drop trigger if exists docs_quota on public.docs;
create trigger docs_quota before insert on public.docs for each row execute function public.docs_quota();

-- ===== v0.3.1 (migration token_budget_and_quota_fix) =====
create or replace function public.reserve_call(p_user uuid, p_day date, p_limit int, p_max_out bigint)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.usage (user_id, day, calls) values (p_user, p_day, 0) on conflict (user_id, day) do nothing;
  update public.usage set calls = calls + 1
   where user_id = p_user and day = p_day and calls < p_limit and output_tokens < p_max_out
   returning calls into n;
  return n;
end $$;
revoke execute on function public.reserve_call(uuid, date, int, bigint) from public, anon, authenticated;
grant execute on function public.reserve_call(uuid, date, int, bigint) to service_role;
create or replace function public.docs_quota() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.docs where user_id = new.user_id and path = new.path) then return new; end if;
  if (select count(*) from public.docs where user_id = new.user_id) >= 3000 then
    raise exception 'storage quota reached' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ===== v0.3.2 (migration retire_old_reserve_call): the 3-argument version always refuses =====
create or replace function public.reserve_call(p_user uuid, p_day date, p_limit int)
returns int language sql security definer set search_path = public as $$ select null::int $$;
revoke execute on function public.reserve_call(uuid, date, int) from public, anon, authenticated;
