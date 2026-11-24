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
