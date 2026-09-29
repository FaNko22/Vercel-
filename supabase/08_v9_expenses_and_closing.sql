-- بن الشريب POS V9 — shift expenses + correct closing cash + printable-report data support
-- Additive migration. Does not alter or delete existing sales/products/stock/users.

create table if not exists public.shift_expenses (
  id text primary key default gen_random_uuid()::text,
  shift_id text not null references public.shifts(id) on delete restrict,
  branch_id text not null references public.branches(id) on delete restrict,
  amount numeric not null check (amount > 0),
  description text not null check (length(trim(description)) > 0),
  created_by text not null references public.app_users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists shift_expenses_shift_idx on public.shift_expenses(shift_id, created_at);
create index if not exists shift_expenses_branch_created_idx on public.shift_expenses(branch_id, created_at);

alter table public.shift_expenses enable row level security;
revoke all on public.shift_expenses from anon, authenticated;

create or replace function public.pos_close_shift_v3(
  p_shift_id text,
  p_actual_cash numeric,
  p_expenses jsonb,
  p_closed_by text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  a public.app_users%rowtype;
  s public.shifts%rowtype;
  before_shift jsonb;
  expected numeric := 0;
  expense_total numeric := 0;
  e jsonb;
  amount numeric;
  description text;
  new_expense_id text;
begin
  select * into a from public.app_users where id=p_closed_by and active=true;
  if a.id is null or a.role not in ('manager','owner') then raise exception 'FORBIDDEN'; end if;
  if p_actual_cash is null or p_actual_cash < 0 then raise exception 'INVALID_CASH'; end if;

  select * into s from public.shifts where id=p_shift_id for update;
  if s.id is null then raise exception 'SHIFT_NOT_FOUND'; end if;
  if s.closed_at is not null then raise exception 'SHIFT_ALREADY_CLOSED'; end if;
  if a.role='manager' and a.branch_id is distinct from s.branch_id then raise exception 'BRANCH_FORBIDDEN'; end if;
  if p_expenses is not null and jsonb_typeof(p_expenses) <> 'array' then raise exception 'INVALID_EXPENSES'; end if;

  if p_expenses is not null then
    for e in select * from jsonb_array_elements(p_expenses) loop
      amount := coalesce((e->>'amount')::numeric,0);
      description := trim(coalesce(e->>'description',''));
      if amount <= 0 or description = '' then raise exception 'INVALID_EXPENSE'; end if;
      new_expense_id := gen_random_uuid()::text;
      insert into public.shift_expenses(id,shift_id,branch_id,amount,description,created_by)
        values(new_expense_id,s.id,s.branch_id,amount,description,p_closed_by);
      expense_total := expense_total + amount;
    end loop;
  end if;

  select s.opening_cash
       + coalesce(sum(total) filter(where payment_method='cash' and status='completed'),0)
       - expense_total
    into expected
  from public.sales where shift_id=s.id;

  if expected < 0 then expected := 0; end if;

  before_shift := to_jsonb(s);
  update public.shifts
    set closed_at=now(), expected_cash=expected, actual_cash=p_actual_cash,
        difference=p_actual_cash-expected,
        notes=null
    where id=s.id returning * into s;

  insert into public.audit_log(actor_id,action,entity_type,entity_id,branch_id,reason,before_data,after_data)
    values(p_closed_by,'close_shift','shift',s.id,s.branch_id,null,to_jsonb(before_shift),
      jsonb_build_object('shift',to_jsonb(s),'expense_total',expense_total));

  return jsonb_build_object(
    'shift',to_jsonb(s),
    'expense_total',expense_total
  );
end $$;

revoke all on function public.pos_close_shift_v3(text,numeric,jsonb,text) from public, anon, authenticated;
grant execute on function public.pos_close_shift_v3(text,numeric,jsonb,text) to service_role;
