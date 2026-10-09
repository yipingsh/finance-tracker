-- Monthly insight summaries get their own per-user limit, separate from uploads. They share the
-- global daily spending cap and the one-run-at-a-time rule with uploads.
--
-- reserve_upload(...) keeps its signature (the process-statement function and tests use it) and
-- now delegates to the general reserve_run(kind, ...).

alter table private.limits add column monthly_insights_per_user integer not null default 10
  check (monthly_insights_per_user >= 0);
alter table private.usage_monthly add column insights integer not null default 0 check (insights >= 0);
alter table private.runs add column kind text not null default 'upload' check (kind in ('upload', 'insight'));

-- Same three checks as before, in one transaction; only the counter depends on the kind.
-- Raises: monthly_quota_exceeded | global_daily_cap_reached | run_in_progress | invalid_estimate | invalid_kind
create function public.reserve_run(p_user_id uuid, p_kind text, p_estimated_usd numeric)
returns table (run_id uuid, used integer, monthly_limit integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limits private.limits;
  v_day date := private.sg_today();
  v_month date := date_trunc('month', private.sg_today())::date;
  v_limit integer;
  v_used integer;
  v_run_id uuid;
begin
  if p_kind not in ('upload', 'insight') then
    raise exception 'invalid_kind';
  end if;
  if p_estimated_usd is null or p_estimated_usd <= 0 then
    raise exception 'invalid_estimate';
  end if;

  select * into v_limits from private.limits;
  v_limit := case p_kind when 'upload' then v_limits.monthly_uploads_per_user else v_limits.monthly_insights_per_user end;
  perform private.expire_stale_runs(p_user_id);

  -- 1. Monthly limit for this kind (atomic conditional increment).
  insert into private.usage_monthly (user_id, month) values (p_user_id, v_month)
  on conflict do nothing;
  if p_kind = 'upload' then
    update private.usage_monthly set uploads = uploads + 1
     where user_id = p_user_id and month = v_month and uploads < v_limit
    returning uploads into v_used;
  else
    update private.usage_monthly set insights = insights + 1
     where user_id = p_user_id and month = v_month and insights < v_limit
    returning insights into v_used;
  end if;
  if not found then
    raise exception 'monthly_quota_exceeded';
  end if;

  -- 2. Global daily cap, counting settled and reserved spend.
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
    insert into private.runs (user_id, day, month, estimated_usd, kind)
    values (p_user_id, v_day, v_month, p_estimated_usd, p_kind)
    returning id into v_run_id;
  exception when unique_violation then
    raise exception 'run_in_progress';
  end;

  return query select v_run_id, v_used, v_limit;
end;
$$;

-- Unchanged interface for uploads.
create or replace function public.reserve_upload(p_user_id uuid, p_estimated_usd numeric)
returns table (run_id uuid, uploads_used integer, uploads_limit integer)
language sql
security definer
set search_path = ''
as $$
  select r.run_id, r.used, r.monthly_limit from public.reserve_run(p_user_id, 'upload', p_estimated_usd) r
$$;

-- Refunds now go back to the counter of the run's own kind.
create or replace function public.finish_run(p_run_id uuid, p_actual_usd numeric, p_succeeded boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run private.runs;
  v_refund integer;
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

  v_refund := case when not p_succeeded and p_actual_usd = 0 then 1 else 0 end;
  update private.usage_monthly
     set cost_usd = cost_usd + p_actual_usd,
         uploads = uploads - case when v_run.kind = 'upload' then v_refund else 0 end,
         insights = insights - case when v_run.kind = 'insight' then v_refund else 0 end
   where user_id = v_run.user_id and month = v_run.month;
end;
$$;

-- The quota a browser can read now includes insights.
drop function public.get_my_quota();
create function public.get_my_quota()
returns table (uploads_used integer, uploads_limit integer, insights_used integer, insights_limit integer, service_available boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(u.uploads, 0),
    l.monthly_uploads_per_user,
    coalesce(u.insights, 0),
    l.monthly_insights_per_user,
    coalesce((select d.cost_usd + d.reserved_usd from private.daily_spend d
               where d.day = private.sg_today()), 0) < l.global_daily_cap_usd
  from private.limits l
  left join private.usage_monthly u
    on u.user_id = auth.uid() and u.month = date_trunc('month', private.sg_today())::date
  where auth.uid() is not null
$$;

revoke execute on function public.reserve_run(uuid, text, numeric) from public, anon, authenticated;
revoke execute on function public.reserve_upload(uuid, numeric) from public, anon, authenticated;
revoke execute on function public.finish_run(uuid, numeric, boolean) from public, anon, authenticated;
revoke execute on function public.get_my_quota() from public, anon;
grant execute on function public.reserve_run(uuid, text, numeric) to service_role;
grant execute on function public.reserve_upload(uuid, numeric) to service_role;
grant execute on function public.finish_run(uuid, numeric, boolean) to service_role;
grant execute on function public.get_my_quota() to authenticated;
