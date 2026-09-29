create or replace function public.pos_daily_finance_v2(p_branch_id text, p_date date)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  revenue numeric;
  cost_total numeric;
  profit_total numeric;
  cash numeric;
  vf numeric;
  count_sales bigint;
  shifts_count bigint;
  closed_count bigint;
  expenses_total numeric;
  void_total numeric;
begin
  select
    coalesce(sum(total) filter(where status='completed'),0),
    coalesce(sum(cost) filter(where status='completed'),0),
    coalesce(sum(profit) filter(where status='completed'),0),
    count(*) filter(where status='completed'),
    coalesce(sum(total) filter(where payment_method='cash' and status='completed'),0),
    coalesce(sum(total) filter(where payment_method='vodafone_cash' and status='completed'),0),
    coalesce(sum(total) filter(where status='voided'),0)
  into revenue,cost_total,profit_total,count_sales,cash,vf,void_total
  from public.sales
  where (p_branch_id is null or branch_id=p_branch_id)
    and ts >= (p_date::timestamp at time zone 'Africa/Cairo')
    and ts < ((p_date+1)::timestamp at time zone 'Africa/Cairo');

  select coalesce(sum(amount),0) into expenses_total
  from public.shift_expenses
  where (p_branch_id is null or branch_id=p_branch_id)
    and created_at >= (p_date::timestamp at time zone 'Africa/Cairo')
    and created_at < ((p_date+1)::timestamp at time zone 'Africa/Cairo');

  select count(*),count(*) filter(where closed_at is not null)
  into shifts_count,closed_count
  from public.shifts
  where (p_branch_id is null or branch_id=p_branch_id)
    and opened_at >= (p_date::timestamp at time zone 'Africa/Cairo')
    and opened_at < ((p_date+1)::timestamp at time zone 'Africa/Cairo');

  return jsonb_build_object(
    'revenue',revenue,'cost',cost_total,'profit',profit_total,
    'count',count_sales,'cash',cash,'vodafone_cash',vf,
    'void_total',void_total,'expenses_total',expenses_total,
    'net_cash',cash-expenses_total,'shifts',shifts_count,'closed_shifts',closed_count
  );
end
$$;
