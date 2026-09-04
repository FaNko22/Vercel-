-- Bin Alshareeb POS — V6 shift sequence guard
-- Apply after 01_setup.sql through 05_restore_missing_actions.sql.
-- An evening shift for a branch may start only after that branch's morning shift
-- for the current Cairo business day has been closed.

create or replace function public.pos_open_shift_v2(
  p_branch_id text,
  p_user_id text,
  p_shift_period text,
  p_opening_cash numeric
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  u public.app_users%rowtype;
  s public.shifts%rowtype;
  bname text;
  cairo_today date := (now() at time zone 'Africa/Cairo')::date;
begin
  select * into u from public.app_users where id=p_user_id and active=true;
  if u.id is null then raise exception 'FORBIDDEN'; end if;

  if u.role='cashier' then
    if u.branch_id is distinct from p_branch_id or u.shift_period is distinct from p_shift_period then
      raise exception 'FORBIDDEN';
    end if;
  elsif u.role <> 'owner' then
    raise exception 'FORBIDDEN';
  end if;

  if p_opening_cash < 0 or p_shift_period not in ('morning','evening') then
    raise exception 'INVALID_SHIFT';
  end if;
  if exists(select 1 from public.shifts where branch_id=p_branch_id and closed_at is null) then
    raise exception 'ACTIVE_SHIFT_EXISTS';
  end if;
  if p_shift_period='evening' and not exists(
    select 1 from public.shifts
    where branch_id=p_branch_id
      and shift_period='morning'
      and closed_at is not null
      and (opened_at at time zone 'Africa/Cairo')::date=cairo_today
  ) then
    raise exception 'MORNING_SHIFT_MUST_CLOSE_FIRST';
  end if;

  select name into bname from public.branches where id=p_branch_id;
  if bname is null then raise exception 'BRANCH_NOT_FOUND'; end if;

  insert into public.shifts(id,branch_id,branch_name,user_id,user_name,shift_period,opened_at,opening_cash)
    values(gen_random_uuid()::text,p_branch_id,bname,p_user_id,u.name,p_shift_period,now(),p_opening_cash)
    returning * into s;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,branch_id,after_data)
    values(p_user_id,'open_shift','shift',s.id,p_branch_id,to_jsonb(s));
  return to_jsonb(s);
end $$;

revoke all on function public.pos_open_shift_v2(text,text,text,numeric) from public, anon, authenticated;
grant execute on function public.pos_open_shift_v2(text,text,text,numeric) to service_role;
