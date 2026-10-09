-- Usage limits for the agent pipeline.
--
-- This is the only data the server keeps. It holds no financial data and nothing that
-- identifies a person: a random anonymous user id, upload counts and API costs.
--
-- Layers enforced here (see docs/security.md):
--   1. per-user monthly upload limit
--   2. global daily spending cap across all users
--   3. one pipeline run at a time per user
-- All three are checked inside one transaction, so a rejected upload leaves no partial counts.

create schema if not exists private;
-- `private` is not exposed through the REST API; revoke anyway as defence in depth.
revoke all on schema private from public, anon, authenticated;

-- Singapore calendar day; monthly and daily limits roll over at SGT midnight.
create function private.sg_today() returns date
language sql stable
set search_path = ''
as $$ select (now() at time zone 'Asia/Singapore')::date $$;

-- Tunable limits (single row), editable without a migration.
create table private.limits (
  id boolean primary key default true check (id),
  monthly_uploads_per_user integer not null default 5 check (monthly_uploads_per_user >= 0),
  global_daily_cap_usd numeric(10, 4) not null default 3.00 check (global_daily_cap_usd >= 0),
  run_timeout interval not null default interval '10 minutes'
);
insert into private.limits default values;

create table private.usage_monthly (
  user_id uuid not null references auth.users (id) on delete cascade,
  month date not null,
  uploads integer not null default 0 check (uploads >= 0),
  cost_usd numeric(12, 6) not null default 0,
  primary key (user_id, month)
);

create table private.daily_spend (
  day date primary key,
  cost_usd numeric(12, 6) not null default 0,
  -- cost set aside for runs still in progress, so parallel runs can't overshoot the cap
  reserved_usd numeric(12, 6) not null default 0 check (reserved_usd >= 0)
);

create table private.runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  month date not null,
  estimated_usd numeric(12, 6) not null check (estimated_usd > 0),
  actual_usd numeric(12, 6),
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed', 'expired')),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

-- One run at a time per user, enforced by the database rather than by application code.
create unique index runs_one_running_per_user on private.runs (user_id) where status = 'running';

-- RLS on with no policies = deny all, even if these tables were ever exposed by mistake.
alter table private.limits enable row level security;
alter table private.usage_monthly enable row level security;
alter table private.daily_spend enable row level security;
alter table private.runs enable row level security;

-- A run whose Edge Function crashed never calls finish_run. After run_timeout it is expired
-- and charged at its full estimate (fail safe: unknown spend counts as spent).
create function private.expire_stale_runs(p_user_id uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_run private.runs;
begin
  for v_run in
    update private.runs r
       set status = 'expired', actual_usd = r.estimated_usd, finished_at = now()
     where r.user_id = p_user_id
       and r.status = 'running'
       and r.started_at < now() - (select run_timeout from private.limits)
    returning r.*
  loop
    update private.daily_spend
       set reserved_usd = greatest(reserved_usd - v_run.estimated_usd, 0),
           cost_usd = cost_usd + v_run.estimated_usd
     where day = v_run.day;
    update private.usage_monthly
       set cost_usd = cost_usd + v_run.estimated_usd
     where user_id = v_run.user_id and month = v_run.month;
  end loop;
end;
$$;

-- Called by the Edge Function (service role) BEFORE any Claude call.
-- Raises one of: monthly_quota_exceeded | global_daily_cap_reached | run_in_progress | invalid_estimate
create function public.reserve_upload(p_user_id uuid, p_estimated_usd numeric)
returns table (run_id uuid, uploads_used integer, uploads_limit integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limits private.limits;
  v_day date := private.sg_today();
  v_month date := date_trunc('month', private.sg_today())::date;
  v_uploads integer;
  v_run_id uuid;
begin
  if p_estimated_usd is null or p_estimated_usd <= 0 then
    raise exception 'invalid_estimate';
  end if;

  select * into v_limits from private.limits;
  perform private.expire_stale_runs(p_user_id);

  -- 1. Monthly limit. A conditional UPDATE is atomic: concurrent requests queue on the row
  --    lock and re-check the WHERE clause, so two requests can't both take the last upload.
  insert into private.usage_monthly (user_id, month) values (p_user_id, v_month)
  on conflict do nothing;
  update private.usage_monthly
     set uploads = uploads + 1
   where user_id = p_user_id and month = v_month
     and uploads < v_limits.monthly_uploads_per_user
  returning uploads into v_uploads;
  if not found then
    raise exception 'monthly_quota_exceeded';
  end if;

  -- 2. Global daily cap, counting both settled and reserved spend.
  insert into private.daily_spend (day) values (v_day) on conflict do nothing;
  update private.daily_spend
     set reserved_usd = reserved_usd + p_estimated_usd
   where day = v_day
     and cost_usd + reserved_usd + p_estimated_usd <= v_limits.global_daily_cap_usd;
  if not found then
    raise exception 'global_daily_cap_reached';
  end if;

  -- 3. One run at a time (unique partial index).
  begin
    insert into private.runs (user_id, day, month, estimated_usd)
    values (p_user_id, v_day, v_month, p_estimated_usd)
    returning id into v_run_id;
  exception when unique_violation then
    raise exception 'run_in_progress';
  end;

  return query select v_run_id, v_uploads, v_limits.monthly_uploads_per_user;
end;
$$;

-- Called by the Edge Function when a run ends. Idempotent: a second call is a no-op.
-- A failed run that never reached Claude (cost 0) gives the upload back; once tokens
-- were spent it counts, so crafted failing files can't buy unlimited free runs.
create function public.finish_run(p_run_id uuid, p_actual_usd numeric, p_succeeded boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run private.runs;
begin
  if p_actual_usd is null or p_actual_usd < 0 then
    raise exception 'invalid_cost';
  end if;

  update private.runs
     set status = case when p_succeeded then 'succeeded' else 'failed' end,
         actual_usd = p_actual_usd,
         finished_at = now()
   where id = p_run_id and status = 'running'
  returning * into v_run;
  if not found then
    return;
  end if;

  update private.daily_spend
     set reserved_usd = greatest(reserved_usd - v_run.estimated_usd, 0),
         cost_usd = cost_usd + p_actual_usd
   where day = v_run.day;

  update private.usage_monthly
     set cost_usd = cost_usd + p_actual_usd,
         uploads = uploads - case when not p_succeeded and p_actual_usd = 0 then 1 else 0 end
   where user_id = v_run.user_id and month = v_run.month;
end;
$$;

-- The only thing a signed-in browser can read: its own quota for this month.
create function public.get_my_quota()
returns table (uploads_used integer, uploads_limit integer, service_available boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select u.uploads from private.usage_monthly u
               where u.user_id = auth.uid()
                 and u.month = date_trunc('month', private.sg_today())::date), 0),
    l.monthly_uploads_per_user,
    coalesce((select d.cost_usd + d.reserved_usd from private.daily_spend d
               where d.day = private.sg_today()), 0) < l.global_daily_cap_usd
  from private.limits l
  where auth.uid() is not null
$$;

-- Postgres grants EXECUTE to PUBLIC on new functions by default, and Supabase adds grants for
-- anon/authenticated in `public`. Remove them all, then grant exactly what each role needs.
revoke execute on function public.reserve_upload(uuid, numeric) from public, anon, authenticated;
revoke execute on function public.finish_run(uuid, numeric, boolean) from public, anon, authenticated;
revoke execute on function public.get_my_quota() from public, anon;
grant execute on function public.reserve_upload(uuid, numeric) to service_role;
grant execute on function public.finish_run(uuid, numeric, boolean) to service_role;
grant execute on function public.get_my_quota() to authenticated;
