-- بن الشريب POS — Production hardening V3
-- Safe/additive migration. Does not delete products or transactional data.
create extension if not exists pgcrypto;

-- Stronger identifiers and idempotency for sales.
alter table public.sales add column if not exists request_id text;
create unique index if not exists sales_request_id_unique on public.sales(request_id) where request_id is not null;

-- Prevent impossible values at database level.
alter table public.sales drop constraint if exists sales_total_nonnegative;
alter table public.sales add constraint sales_total_nonnegative check (total >= 0 and cost >= 0);
alter table public.sales drop constraint if exists sales_payment_method_check;
alter table public.sales add constraint sales_payment_method_check check (payment_method in ('cash','vodafone_cash'));
alter table public.shifts drop constraint if exists shifts_period_check;
alter table public.shifts add constraint shifts_period_check check (shift_period in ('morning','evening'));

-- One active shift per branch is intentional: morning must close before evening starts.
create unique index if not exists shifts_one_active_per_branch_v3 on public.shifts(branch_id) where closed_at is null;

-- Login throttling. Only the Vercel server uses this table via service_role.
create table if not exists public.login_rate_limits (
  key text primary key,
  window_started_at timestamptz not null default now(),
  failed_count integer not null default 0 check (failed_count >= 0),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.login_rate_limits enable row level security;
revoke all on public.login_rate_limits from anon, authenticated;

create or replace function public.pos_login_guard(p_key text, p_success boolean)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare r public.login_rate_limits%rowtype; now_ts timestamptz:=now();
begin
  if coalesce(trim(p_key),'')='' then return jsonb_build_object('allowed',true,'failed_count',0); end if;
  select * into r from public.login_rate_limits where key=p_key for update;
  if not found then
    insert into public.login_rate_limits(key,window_started_at,failed_count,blocked_until,updated_at)
      values(p_key,now_ts,case when p_success then 0 else 1 end,case when p_success then null else now_ts+interval '30 seconds' end,now_ts);
    return jsonb_build_object('allowed',true,'failed_count',case when p_success then 0 else 1 end);
  end if;
  if r.blocked_until is not null and r.blocked_until > now_ts and not p_success then
    return jsonb_build_object('allowed',false,'failed_count',r.failed_count,'blocked_until',r.blocked_until);
  end if;
  if r.window_started_at < now_ts - interval '10 minutes' then
    update public.login_rate_limits set window_started_at=now_ts,failed_count=case when p_success then 0 else 1 end,blocked_until=case when p_success then null else null end,updated_at=now_ts where key=p_key;
    return jsonb_build_object('allowed',true,'failed_count',case when p_success then 0 else 1 end);
  end if;
  if p_success then
    update public.login_rate_limits set failed_count=0,blocked_until=null,updated_at=now_ts where key=p_key;
    return jsonb_build_object('allowed',true,'failed_count',0);
  end if;
  update public.login_rate_limits
    set failed_count=failed_count+1,
        blocked_until=case when failed_count+1 >= 5 then now_ts+interval '10 minutes' when failed_count+1 >= 3 then now_ts+interval '30 seconds' else null end,
        updated_at=now_ts
    where key=p_key returning * into r;
  return jsonb_build_object('allowed', r.failed_count < 5, 'failed_count', r.failed_count, 'blocked_until', r.blocked_until);
end $$;
revoke all on function public.pos_login_guard(text,boolean) from public, anon, authenticated;
grant execute on function public.pos_login_guard(text,boolean) to service_role;

-- Replace the sale procedure with an idempotent, branch-safe version.
create or replace function public.pos_create_sale_v2(
  p_branch_id text,
  p_cashier_id text,
  p_items jsonb,
  p_customer_name text,
  p_customer_phone text,
  p_payment_method text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  u public.app_users%rowtype;
  sh public.shifts%rowtype;
  x jsonb;
  p public.products%rowtype;
  st public.stock%rowtype;
  q numeric;
  unit_price numeric;
  unit_cost numeric;
  line_rev numeric;
  line_cost numeric;
  total numeric:=0;
  cost numeric:=0;
  final_items jsonb:='[]'::jsonb;
  sale_id text;
  before_qty numeric;
  after_qty numeric;
  v_sale public.sales%rowtype;
  seen jsonb:='{}'::jsonb;
  pid text;
  request_key text:=nullif(trim(p_request_id),'');
begin
  if request_key is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
  select * into v_sale from public.sales where request_id=request_key limit 1;
  if v_sale.id is not null then return to_jsonb(v_sale); end if;

  select * into u from public.app_users where id=p_cashier_id and active=true;
  if u.id is null or u.role not in ('cashier','owner') then raise exception 'FORBIDDEN'; end if;
  if u.role='cashier' and u.branch_id is distinct from p_branch_id then raise exception 'BRANCH_FORBIDDEN'; end if;
  select * into sh from public.shifts where branch_id=p_branch_id and closed_at is null order by opened_at desc limit 1;
  if sh.id is null or (u.role='cashier' and sh.user_id <> p_cashier_id) then raise exception 'NO_ACTIVE_SHIFT'; end if;
  if p_payment_method not in ('cash','vodafone_cash') then raise exception 'INVALID_PAYMENT'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'EMPTY_CART'; end if;

  for x in select * from jsonb_array_elements(p_items) loop
    pid:=nullif(trim(x->>'productId'),'');
    q:=coalesce((x->>'qty')::numeric,0);
    if pid is null or q<=0 then raise exception 'INVALID_QTY'; end if;
    if seen ? pid then raise exception 'DUPLICATE_PRODUCT'; end if;
    seen:=seen || jsonb_build_object(pid,true);
    select * into p from public.products where id=pid and active=true;
    if p.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
    unit_price:=p.sell_price; unit_cost:=p.cost_price;
    if p.type='bulk' then line_rev:=(q/1000)*unit_price; line_cost:=(q/1000)*unit_cost; else line_rev:=q*unit_price; line_cost:=q*unit_cost; end if;
    if line_rev<0 or line_cost<0 then raise exception 'INVALID_PRICE'; end if;
    if p.track_stock then
      select * into st from public.stock where branch_id=p_branch_id and product_id=p.id for update;
      before_qty:=coalesce(st.qty,0); after_qty:=before_qty-q;
      if after_qty<0 then raise exception 'INSUFFICIENT_STOCK:%',p.name; end if;
      insert into public.stock(branch_id,product_id,qty) values(p_branch_id,p.id,after_qty)
        on conflict(branch_id,product_id) do update set qty=excluded.qty;
      insert into public.inventory_ledger(branch_id,product_id,delta,qty_before,qty_after,movement_type,reference_id,actor_id)
        values(p_branch_id,p.id,-q,before_qty,after_qty,'sale',request_key,p_cashier_id);
    end if;
    final_items:=final_items||jsonb_build_array(jsonb_build_object('productId',p.id,'name',p.name,'type',p.type,'packageWeight',p.package_weight,'sellPrice',unit_price,'costPrice',unit_cost,'qty',q,'lineRevenue',line_rev,'lineCost',line_cost));
    total:=total+line_rev; cost:=cost+line_cost;
  end loop;

  sale_id:=gen_random_uuid()::text;
  insert into public.sales(id,branch_id,branch_name,shift_id,cashier_id,cashier_name,ts,items,total,cost,profit,customer_name,customer_phone,payment_method,status,request_id)
    values(sale_id,p_branch_id,sh.branch_name,sh.id,p_cashier_id,u.name,now(),final_items,total,cost,total-cost,nullif(trim(p_customer_name),''),nullif(trim(p_customer_phone),''),p_payment_method,'completed',request_key)
    returning * into v_sale;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,branch_id,after_data)
    values(p_cashier_id,'create_sale','sale',sale_id,p_branch_id,to_jsonb(v_sale));
  return to_jsonb(v_sale);
exception when unique_violation then
  select * into v_sale from public.sales where request_id=request_key limit 1;
  if v_sale.id is not null then return to_jsonb(v_sale); end if;
  raise;
end $$;
revoke all on function public.pos_create_sale_v2(text,text,jsonb,text,text,text,text) from public, anon, authenticated;
grant execute on function public.pos_create_sale_v2(text,text,jsonb,text,text,text,text) to service_role;

-- Manager may close a shift in their own branch; owner may close any branch.
-- Cashiers alone open their assigned morning/evening shift.
create or replace function public.pos_open_shift_v2(p_branch_id text,p_user_id text,p_shift_period text,p_opening_cash numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare u public.app_users%rowtype; s public.shifts%rowtype; bname text;
begin
  select * into u from public.app_users where id=p_user_id and active=true;
  if u.id is null then raise exception 'FORBIDDEN'; end if;
  if u.role='cashier' then
    if u.branch_id is distinct from p_branch_id or u.shift_period is distinct from p_shift_period then raise exception 'FORBIDDEN'; end if;
  elsif u.role='owner' then
    null;
  else
    raise exception 'FORBIDDEN';
  end if;
  if p_opening_cash < 0 or p_shift_period not in ('morning','evening') then raise exception 'INVALID_SHIFT'; end if;
  if exists(select 1 from public.shifts where branch_id=p_branch_id and closed_at is null) then raise exception 'ACTIVE_SHIFT_EXISTS'; end if;
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

-- Fix daily finance calculation: previous version accidentally returned COST as PROFIT.
create or replace function public.pos_daily_finance_v2(p_branch_id text,p_date date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare revenue numeric; cost_total numeric; profit_total numeric; cash numeric; vf numeric; count_sales bigint; shifts_count bigint; closed_count bigint;
begin
  select coalesce(sum(total),0),coalesce(sum(cost),0),coalesce(sum(profit),0),count(*) filter(where status='completed'),
         coalesce(sum(total) filter(where payment_method='cash' and status='completed'),0),
         coalesce(sum(total) filter(where payment_method='vodafone_cash' and status='completed'),0)
    into revenue,cost_total,profit_total,count_sales,cash,vf
  from public.sales
  where (p_branch_id is null or branch_id=p_branch_id)
    and ts >= (p_date::timestamp at time zone 'Africa/Cairo')
    and ts < ((p_date+1)::timestamp at time zone 'Africa/Cairo');
  select count(*),count(*) filter(where closed_at is not null) into shifts_count,closed_count
  from public.shifts
  where (p_branch_id is null or branch_id=p_branch_id)
    and opened_at >= (p_date::timestamp at time zone 'Africa/Cairo')
    and opened_at < ((p_date+1)::timestamp at time zone 'Africa/Cairo');
  return jsonb_build_object('revenue',revenue,'cost',cost_total,'profit',profit_total,'count',count_sales,'cash',cash,'vodafone_cash',vf,'shifts',shifts_count,'closed_shifts',closed_count);
end $$;
revoke all on function public.pos_daily_finance_v2(text,date) from public, anon, authenticated;
grant execute on function public.pos_daily_finance_v2(text,date) to service_role;

-- Prevent non-owner managers from modifying financial records through the API by design.
-- Keep the base tables inaccessible to browser roles.
revoke all on public.branches, public.products, public.stock, public.app_users, public.sales, public.shifts, public.inventory_ledger, public.audit_log from anon, authenticated;

-- Replace the login guard with a non-mutating pre-check + atomic recorder.
drop function if exists public.pos_login_guard(text,boolean);
create or replace function public.pos_login_check(p_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.login_rate_limits%rowtype; now_ts timestamptz:=now();
begin
  select * into r from public.login_rate_limits where key=p_key;
  if not found then return jsonb_build_object('allowed',true); end if;
  if r.blocked_until is not null and r.blocked_until > now_ts then
    return jsonb_build_object('allowed',false,'blocked_until',r.blocked_until,'failed_count',r.failed_count);
  end if;
  return jsonb_build_object('allowed',true,'failed_count',r.failed_count);
end $$;
create or replace function public.pos_login_record(p_key text,p_success boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.login_rate_limits%rowtype; now_ts timestamptz:=now();
begin
  select * into r from public.login_rate_limits where key=p_key for update;
  if not found then
    insert into public.login_rate_limits(key,window_started_at,failed_count,blocked_until,updated_at)
      values(p_key,now_ts,case when p_success then 0 else 1 end,case when p_success then null else now_ts+interval '30 seconds' end,now_ts)
      returning * into r;
  elsif p_success then
    update public.login_rate_limits set failed_count=0,blocked_until=null,updated_at=now_ts where key=p_key returning * into r;
  elsif r.window_started_at < now_ts - interval '10 minutes' then
    update public.login_rate_limits set window_started_at=now_ts,failed_count=1,blocked_until=now_ts+interval '30 seconds',updated_at=now_ts where key=p_key returning * into r;
  else
    update public.login_rate_limits set failed_count=failed_count+1,blocked_until=case when failed_count+1 >= 5 then now_ts+interval '10 minutes' when failed_count+1 >= 3 then now_ts+interval '30 seconds' else null end,updated_at=now_ts where key=p_key returning * into r;
  end if;
  return jsonb_build_object('allowed',true,'failed_count',r.failed_count,'blocked_until',r.blocked_until);
end $$;
revoke all on function public.pos_login_check(text), public.pos_login_record(text,boolean) from public, anon, authenticated;
grant execute on function public.pos_login_check(text), public.pos_login_record(text,boolean) to service_role;

-- Accurate reporting from PostgreSQL; no client-side 2,000-row cap.
create or replace function public.pos_report_summary(p_branch_id text,p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  d date := (p_now at time zone 'Africa/Cairo')::date;
  today_start timestamptz := (d::timestamp at time zone 'Africa/Cairo');
  tomorrow_start timestamptz := ((d+1)::timestamp at time zone 'Africa/Cairo');
  week_start timestamptz := (((d-6)::date)::timestamp at time zone 'Africa/Cairo');
  prev_week_start timestamptz := (((d-13)::date)::timestamp at time zone 'Africa/Cairo');
  prev_week_end timestamptz := (((d-6)::date)::timestamp at time zone 'Africa/Cairo');
  all_stats jsonb; branches_stats jsonb; users_stats jsonb; products_stats jsonb; payments jsonb;
begin
  select jsonb_build_object(
    'revenue',coalesce(sum(s.total) filter(where s.status='completed'),0),
    'cost',coalesce(sum(s.cost) filter(where s.status='completed'),0),
    'profit',coalesce(sum(s.profit) filter(where s.status='completed'),0),
    'count',count(*) filter(where s.status='completed'),
    'revToday',coalesce(sum(s.total) filter(where s.status='completed' and s.ts>=today_start and s.ts<tomorrow_start),0),
    'profitToday',coalesce(sum(s.profit) filter(where s.status='completed' and s.ts>=today_start and s.ts<tomorrow_start),0),
    'thisWeek',coalesce(sum(s.total) filter(where s.status='completed' and s.ts>=week_start and s.ts<tomorrow_start),0),
    'lastWeek',coalesce(sum(s.total) filter(where s.status='completed' and s.ts>=prev_week_start and s.ts<prev_week_end),0)
  ) into all_stats
  from public.sales s
  where (p_branch_id is null or s.branch_id=p_branch_id);

  select coalesce(jsonb_object_agg(x.branch_id,x.data),'{}'::jsonb) into branches_stats from (
    select s.branch_id,
      jsonb_build_object(
        'revenue',coalesce(sum(s.total) filter(where s.status='completed'),0),
        'cost',coalesce(sum(s.cost) filter(where s.status='completed'),0),
        'profit',coalesce(sum(s.profit) filter(where s.status='completed'),0),
        'count',count(*) filter(where s.status='completed'),
        'revToday',coalesce(sum(s.total) filter(where s.status='completed' and s.ts>=today_start and s.ts<tomorrow_start),0),
        'profitToday',coalesce(sum(s.profit) filter(where s.status='completed' and s.ts>=today_start and s.ts<tomorrow_start),0)
      ) data
    from public.sales s
    where (p_branch_id is null or s.branch_id=p_branch_id)
    group by s.branch_id
  ) x;

  select coalesce(jsonb_object_agg(x.cashier_id,x.data),'{}'::jsonb) into users_stats from (
    select s.cashier_id,
      jsonb_build_object('name',max(s.cashier_name),'revenue',coalesce(sum(s.total) filter(where s.status='completed'),0),'profit',coalesce(sum(s.profit) filter(where s.status='completed'),0),'count',count(*) filter(where s.status='completed')) data
    from public.sales s
    where (p_branch_id is null or s.branch_id=p_branch_id)
    group by s.cashier_id
  ) x;

  select coalesce(jsonb_agg(jsonb_build_array(x.product_name,x.qty) order by x.qty desc),'[]'::jsonb) into products_stats from (
    select item->>'name' product_name, sum(coalesce((item->>'qty')::numeric,0)) qty
    from public.sales s cross join lateral jsonb_array_elements(s.items) item
    where s.status='completed' and (p_branch_id is null or s.branch_id=p_branch_id)
    group by item->>'name'
    order by qty desc limit 20
  ) x;

  select jsonb_build_object(
    'cash',coalesce(sum(s.total) filter(where s.status='completed' and s.payment_method='cash'),0),
    'vodafone_cash',coalesce(sum(s.total) filter(where s.status='completed' and s.payment_method='vodafone_cash'),0)
  ) into payments
  from public.sales s where (p_branch_id is null or s.branch_id=p_branch_id);

  return jsonb_build_object('all',all_stats,'perBranch',branches_stats,'perUser',users_stats,'topProducts',products_stats,'payments',payments);
end $$;
revoke all on function public.pos_report_summary(text,timestamptz) from public, anon, authenticated;
grant execute on function public.pos_report_summary(text,timestamptz) to service_role;

-- Correct sale editing: preserve original price/cost snapshot and reconcile stock for removed items too.
create or replace function public.pos_update_sale_v2(p_sale_id text,p_items jsonb,p_reason text,p_actor_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  a public.app_users%rowtype; s public.sales%rowtype; before_sale jsonb;
  old_item jsonb; new_item jsonb; p public.products%rowtype; st public.stock%rowtype;
  oldq numeric; newq numeric; delta numeric; before_qty numeric; after_qty numeric;
  total numeric:=0; cost_total numeric:=0; final_items jsonb:='[]'::jsonb; pid text; seen jsonb:='{}'::jsonb; unit_price numeric; unit_cost numeric; line_rev numeric; line_cost numeric;
begin
  select * into a from public.app_users where id=p_actor_id and active=true;
  if a.id is null or a.role<>'owner' then raise exception 'FORBIDDEN'; end if;
  if coalesce(trim(p_reason),'')='' then raise exception 'REASON_REQUIRED'; end if;
  select * into s from public.sales where id=p_sale_id for update;
  if s.id is null then raise exception 'SALE_NOT_FOUND'; end if;
  if s.status='voided' then raise exception 'ALREADY_VOIDED'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'EMPTY_CART'; end if;

  -- Only quantity changes/removal are allowed; product set cannot be changed from the original sale.
  for new_item in select * from jsonb_array_elements(p_items) loop
    pid:=nullif(trim(new_item->>'productId'),'');
    newq:=coalesce((new_item->>'qty')::numeric,0);
    if pid is null or newq<=0 then raise exception 'INVALID_QTY'; end if;
    if seen ? pid then raise exception 'DUPLICATE_PRODUCT'; end if;
    seen:=seen || jsonb_build_object(pid,true);
    select * into old_item from jsonb_array_elements(s.items) item where item->>'productId'=pid limit 1;
    if old_item is null then raise exception 'NEW_PRODUCT_NOT_ALLOWED'; end if;
    unit_price:=coalesce((old_item->>'sellPrice')::numeric,0); unit_cost:=coalesce((old_item->>'costPrice')::numeric,0);
    if (old_item->>'type')='bulk' then line_rev:=(newq/1000)*unit_price; line_cost:=(newq/1000)*unit_cost; else line_rev:=newq*unit_price; line_cost:=newq*unit_cost; end if;
    final_items:=final_items||jsonb_build_array(jsonb_build_object('productId',pid,'name',old_item->>'name','type',old_item->>'type','packageWeight',old_item->'packageWeight','sellPrice',unit_price,'costPrice',unit_cost,'qty',newq,'lineRevenue',line_rev,'lineCost',line_cost));
    total:=total+line_rev; cost_total:=cost_total+line_cost;
  end loop;

  -- Reconcile every product in old or new set, including inactive products.
  for pid in
    select distinct item->>'productId' from jsonb_array_elements(s.items) item
    union
    select distinct item->>'productId' from jsonb_array_elements(p_items) item
  loop
    select coalesce(sum((item->>'qty')::numeric),0) into oldq from jsonb_array_elements(s.items) item where item->>'productId'=pid;
    select coalesce(sum((item->>'qty')::numeric),0) into newq from jsonb_array_elements(p_items) item where item->>'productId'=pid;
    delta:=oldq-newq;
    if delta<>0 then
      select * into p from public.products where id=pid;
      if p.id is null then raise exception 'PRODUCT_NOT_FOUND:%',pid; end if;
      if p.track_stock then
        select * into st from public.stock where branch_id=s.branch_id and product_id=p.id for update;
        before_qty:=coalesce(st.qty,0); after_qty:=before_qty+delta;
        if after_qty<0 then raise exception 'INSUFFICIENT_STOCK:%',p.name; end if;
        insert into public.stock(branch_id,product_id,qty) values(s.branch_id,p.id,after_qty)
          on conflict(branch_id,product_id) do update set qty=excluded.qty;
        insert into public.inventory_ledger(branch_id,product_id,delta,qty_before,qty_after,movement_type,reference_id,reason,actor_id)
          values(s.branch_id,p.id,delta,before_qty,after_qty,'sale_edit',s.id,p_reason,p_actor_id);
      end if;
    end if;
  end loop;

  before_sale:=to_jsonb(s);
  update public.sales set items=final_items,total=total,cost=cost_total,profit=total-cost_total where id=s.id returning * into s;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,branch_id,reason,before_data,after_data)
    values(p_actor_id,'update_sale','sale',s.id,s.branch_id,p_reason,before_sale,to_jsonb(s));
  return to_jsonb(s);
end $$;
revoke all on function public.pos_update_sale_v2(text,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.pos_update_sale_v2(text,jsonb,text,text) to service_role;
