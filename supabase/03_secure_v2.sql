-- بن الشريب POS V2 — security, branch isolation, atomic sales, inventory ledger, audit trail
create extension if not exists pgcrypto;

alter table public.app_users add column if not exists pin_hash text;
alter table public.app_users add column if not exists shift_period text;
alter table public.app_users add column if not exists active boolean not null default true;
alter table public.sales add column if not exists shift_id text;
alter table public.sales add column if not exists status text not null default 'completed';
alter table public.sales add column if not exists voided_at timestamptz;
alter table public.sales add column if not exists voided_by text;
alter table public.sales add column if not exists void_reason text;
alter table public.shifts add column if not exists shift_period text;
alter table public.shifts add column if not exists closed_by text;
alter table public.products add column if not exists active boolean not null default true;

-- Convert the current roles to the requested model.
alter table public.app_users drop constraint if exists app_users_role_check;
update public.app_users set role='owner' where role='manager' and branch_id is null;
update public.app_users set role='cashier', shift_period=case when name ilike '%مسائي%' then 'evening' else 'morning' end where role='staff';
alter table public.app_users alter column pin drop not null;
alter table public.app_users drop constraint if exists app_users_shift_period_check;
alter table public.app_users add constraint app_users_shift_period_check check (shift_period is null or shift_period in ('morning','evening'));
alter table public.app_users add constraint app_users_role_check check (role in ('owner','manager','cashier'));

-- Existing plaintext PINs are converted to bcrypt hashes and removed.
update public.app_users set pin_hash=crypt(pin, gen_salt('bf', 12)) where pin is not null and pin_hash is null;
update public.app_users set pin=null where pin is not null;

create unique index if not exists app_users_one_owner on public.app_users ((role)) where role='owner' and active=true;
create unique index if not exists app_users_one_manager_per_branch on public.app_users (branch_id) where role='manager' and active=true;
create unique index if not exists app_users_one_cashier_per_period on public.app_users (branch_id, shift_period) where role='cashier' and active=true;
create unique index if not exists shifts_one_active_per_branch on public.shifts(branch_id) where closed_at is null;
create index if not exists sales_branch_ts_idx on public.sales(branch_id, ts desc);
create index if not exists sales_shift_idx on public.sales(shift_id);
create index if not exists stock_branch_idx on public.stock(branch_id);
create index if not exists shifts_branch_opened_idx on public.shifts(branch_id, opened_at desc);

alter table public.sales drop constraint if exists sales_status_check;
alter table public.sales add constraint sales_status_check check (status in ('completed','voided'));
alter table public.stock drop constraint if exists stock_qty_nonnegative;
alter table public.stock add constraint stock_qty_nonnegative check (qty >= 0);
alter table public.products drop constraint if exists products_prices_nonnegative;
alter table public.products add constraint products_prices_nonnegative check (sell_price >= 0 and cost_price >= 0 and reorder_point >= 0);
alter table public.shifts drop constraint if exists shifts_cash_nonnegative;
alter table public.shifts add constraint shifts_cash_nonnegative check (opening_cash >= 0 and (actual_cash is null or actual_cash >= 0));

create table if not exists public.inventory_ledger (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null references public.branches(id),
  product_id text not null references public.products(id),
  delta numeric not null check (delta <> 0),
  qty_before numeric not null check (qty_before >= 0),
  qty_after numeric not null check (qty_after >= 0),
  movement_type text not null check (movement_type in ('restock','sale','sale_void','sale_edit','adjustment')),
  reference_id text,
  reason text,
  actor_id text,
  created_at timestamptz not null default now()
);
create index if not exists inventory_ledger_branch_created_idx on public.inventory_ledger(branch_id, created_at desc);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id text,
  action text not null,
  entity_type text not null,
  entity_id text,
  branch_id text,
  reason text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_created_idx on public.audit_log(created_at desc);
create index if not exists audit_log_branch_idx on public.audit_log(branch_id, created_at desc);

alter table public.inventory_ledger enable row level security;
alter table public.audit_log enable row level security;

-- The browser never talks directly to application tables. The Vercel API uses the service role.
drop policy if exists "allow all - branches" on public.branches;
drop policy if exists "allow all - products" on public.products;
drop policy if exists "allow all - stock" on public.stock;
drop policy if exists "allow all - app_users" on public.app_users;
drop policy if exists "allow all - sales" on public.sales;
drop policy if exists "allow all - shifts" on public.shifts;

-- Revoke browser access. Service-role calls from the server continue to work.
revoke all on public.branches, public.products, public.stock, public.app_users, public.sales, public.shifts, public.inventory_ledger, public.audit_log from anon, authenticated;

create or replace function public.pos_restock(p_branch_id text, p_product_id text, p_delta numeric, p_user_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.stock%rowtype; before_qty numeric; after_qty numeric; actor public.app_users%rowtype;
begin
  select * into actor from app_users where id=p_user_id and active=true;
  if actor.role <> 'owner' then raise exception 'FORBIDDEN'; end if;
  if p_delta <= 0 then raise exception 'INVALID_QTY'; end if;
  select * into r from stock where branch_id=p_branch_id and product_id=p_product_id for update;
  before_qty:=coalesce(r.qty,0); after_qty:=before_qty+p_delta;
  insert into stock(branch_id,product_id,qty) values(p_branch_id,p_product_id,after_qty)
    on conflict(branch_id,product_id) do update set qty=excluded.qty;
  insert into inventory_ledger(branch_id,product_id,delta,qty_before,qty_after,movement_type,actor_id)
    values(p_branch_id,p_product_id,p_delta,before_qty,after_qty,'restock',p_user_id);
  insert into audit_log(actor_id,action,entity_type,entity_id,branch_id,after_data)
    values(p_user_id,'restock','stock',p_product_id,p_branch_id,jsonb_build_object('delta',p_delta,'qty_after',after_qty));
  return jsonb_build_object('branch_id',p_branch_id,'product_id',p_product_id,'qty',after_qty);
end $$;

create or replace function public.pos_open_shift(p_branch_id text,p_user_id text,p_shift_period text,p_opening_cash numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare u public.app_users%rowtype; s public.shifts%rowtype; bname text;
begin
  select * into u from app_users where id=p_user_id and active=true;
  if u.role not in ('cashier','manager','owner') then raise exception 'FORBIDDEN'; end if;
  if u.role<>'owner' and u.branch_id is distinct from p_branch_id then raise exception 'BRANCH_FORBIDDEN'; end if;
  if p_opening_cash < 0 or p_shift_period not in ('morning','evening') then raise exception 'INVALID_SHIFT'; end if;
  if u.role='cashier' and u.shift_period is distinct from p_shift_period then raise exception 'WRONG_SHIFT'; end if;
  if exists(select 1 from shifts where branch_id=p_branch_id and closed_at is null) then raise exception 'ACTIVE_SHIFT_EXISTS'; end if;
  select name into bname from branches where id=p_branch_id;
  insert into shifts(id,branch_id,branch_name,user_id,user_name,shift_period,opened_at,opening_cash)
    values(gen_random_uuid()::text,p_branch_id,bname,p_user_id,u.name,p_shift_period,now(),p_opening_cash) returning * into s;
  insert into audit_log(actor_id,action,entity_type,entity_id,branch_id,after_data)
    values(p_user_id,'open_shift','shift',s.id,p_branch_id,to_jsonb(s));
  return to_jsonb(s);
end $$;

create or replace function public.pos_create_sale(p_branch_id text,p_cashier_id text,p_items jsonb,p_customer_name text,p_customer_phone text,p_payment_method text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare u public.app_users%rowtype; sh public.shifts%rowtype; x jsonb; p public.products%rowtype; st public.stock%rowtype; q numeric; unit_price numeric; unit_cost numeric; line_rev numeric; line_cost numeric; total numeric:=0; cost numeric:=0; final_items jsonb:='[]'::jsonb; sale_id text; before_qty numeric; after_qty numeric; v_sale public.sales%rowtype;
begin
  select * into u from app_users where id=p_cashier_id and active=true;
  if u.role not in ('cashier','owner') then raise exception 'FORBIDDEN'; end if;
  if u.role='cashier' and u.branch_id is distinct from p_branch_id then raise exception 'FORBIDDEN'; end if;
  select * into sh from shifts where branch_id=p_branch_id and closed_at is null order by opened_at desc limit 1;
  if sh.id is null or (u.role='cashier' and sh.user_id <> p_cashier_id) then raise exception 'NO_ACTIVE_SHIFT'; end if;
  if p_payment_method not in ('cash','vodafone_cash') then raise exception 'INVALID_PAYMENT'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then raise exception 'EMPTY_CART'; end if;
  sale_id:=gen_random_uuid()::text;
  for x in select * from jsonb_array_elements(p_items) loop
    q:=coalesce((x->>'qty')::numeric,0); if q<=0 then raise exception 'INVALID_QTY'; end if;
    select * into p from products where id=x->>'productId' and active=true;
    if p.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
    unit_price:=p.sell_price; unit_cost:=p.cost_price;
    if p.type='bulk' then line_rev:=(q/1000)*unit_price; line_cost:=(q/1000)*unit_cost; else line_rev:=q*unit_price; line_cost:=q*unit_cost; end if;
    if p.track_stock then
      select * into st from stock where branch_id=p_branch_id and product_id=p.id for update;
      before_qty:=coalesce(st.qty,0); after_qty:=before_qty-q;
      if after_qty<0 then raise exception 'INSUFFICIENT_STOCK:%',p.name; end if;
      insert into stock(branch_id,product_id,qty) values(p_branch_id,p.id,after_qty) on conflict(branch_id,product_id) do update set qty=excluded.qty;
      insert into inventory_ledger(branch_id,product_id,delta,qty_before,qty_after,movement_type,reference_id,actor_id) values(p_branch_id,p.id,-q,before_qty,after_qty,'sale',sale_id,p_cashier_id);
    end if;
    final_items:=final_items||jsonb_build_array(jsonb_build_object('productId',p.id,'name',p.name,'type',p.type,'packageWeight',p.package_weight,'sellPrice',unit_price,'costPrice',unit_cost,'qty',q,'lineRevenue',line_rev,'lineCost',line_cost));
    total:=total+line_rev; cost:=cost+line_cost;
  end loop;
  insert into sales(id,branch_id,branch_name,shift_id,cashier_id,cashier_name,ts,items,total,cost,profit,customer_name,customer_phone,payment_method,status)
    values(sale_id,p_branch_id,sh.branch_name,sh.id,p_cashier_id,u.name,now(),final_items,total,cost,total-cost,p_customer_name,p_customer_phone,p_payment_method,'completed') returning * into v_sale;
  insert into audit_log(actor_id,action,entity_type,entity_id,branch_id,after_data) values(p_cashier_id,'create_sale','sale',sale_id,p_branch_id,to_jsonb(v_sale));
  return to_jsonb(v_sale);
exception when others then raise;
end $$;

create or replace function public.pos_void_sale(p_sale_id text,p_reason text,p_actor_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.app_users%rowtype; s public.sales%rowtype; x jsonb; p public.products%rowtype; st public.stock%rowtype; q numeric; before_qty numeric; after_qty numeric;
begin
  select * into a from app_users where id=p_actor_id and active=true; if a.role<>'owner' then raise exception 'FORBIDDEN'; end if;
  if coalesce(trim(p_reason),'')='' then raise exception 'REASON_REQUIRED'; end if;
  select * into s from sales where id=p_sale_id for update; if s.id is null then raise exception 'SALE_NOT_FOUND'; end if;
  if s.status='voided' then raise exception 'ALREADY_VOIDED'; end if;
  for x in select * from jsonb_array_elements(s.items) loop
    q:=coalesce((x->>'qty')::numeric,0); select * into p from products where id=x->>'productId';
    if p.id is not null and p.track_stock then
      select * into st from stock where branch_id=s.branch_id and product_id=p.id for update; before_qty:=coalesce(st.qty,0); after_qty:=before_qty+q;
      insert into stock(branch_id,product_id,qty) values(s.branch_id,p.id,after_qty) on conflict(branch_id,product_id) do update set qty=excluded.qty;
      insert into inventory_ledger(branch_id,product_id,delta,qty_before,qty_after,movement_type,reference_id,reason,actor_id) values(s.branch_id,p.id,q,before_qty,after_qty,'sale_void',s.id,p_reason,p_actor_id);
    end if;
  end loop;
  update sales set status='voided',voided_at=now(),voided_by=p_actor_id,void_reason=trim(p_reason) where id=s.id returning * into s;
  insert into audit_log(actor_id,action,entity_type,entity_id,branch_id,reason,before_data,after_data) values(p_actor_id,'void_sale','sale',s.id,s.branch_id,p_reason,jsonb_build_object('status','completed'),to_jsonb(s));
  return to_jsonb(s);
end $$;

create or replace function public.pos_close_shift(p_shift_id text,p_actual_cash numeric,p_notes text,p_closed_by text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.app_users%rowtype; s public.shifts%rowtype; cash_sales numeric; expected numeric; diff numeric;
begin
  select * into a from app_users where id=p_closed_by and active=true; if a.role not in ('manager','owner') then raise exception 'FORBIDDEN'; end if;
  if p_actual_cash<0 then raise exception 'INVALID_CASH'; end if;
  select * into s from shifts where id=p_shift_id for update; if s.id is null then raise exception 'SHIFT_NOT_FOUND'; end if;
  if s.closed_at is not null then raise exception 'SHIFT_ALREADY_CLOSED'; end if;
  if a.role='manager' and a.branch_id is distinct from s.branch_id then raise exception 'BRANCH_FORBIDDEN'; end if;
  select coalesce(sum(total),0) into cash_sales from sales where shift_id=s.id and status='completed' and payment_method='cash';
  expected:=s.opening_cash+cash_sales; diff:=p_actual_cash-expected;
  update shifts set closed_at=now(),expected_cash=expected,actual_cash=p_actual_cash,difference=diff,notes=nullif(trim(p_notes),''),closed_by=p_closed_by where id=s.id returning * into s;
  insert into audit_log(actor_id,action,entity_type,entity_id,branch_id,after_data) values(p_closed_by,'close_shift','shift',s.id,s.branch_id,to_jsonb(s));
  return to_jsonb(s);
end $$;

create or replace function public.pos_update_sale(p_sale_id text,p_items jsonb,p_reason text,p_actor_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.app_users%rowtype; s public.sales%rowtype; before_sale jsonb; oldx jsonb; newx jsonb; p public.products%rowtype; st public.stock%rowtype; qold numeric; qnew numeric; delta numeric; before_qty numeric; after_qty numeric; unit_price numeric; unit_cost numeric; line_rev numeric; line_cost numeric; total numeric:=0; cost numeric:=0; final_items jsonb:='[]'::jsonb; v_id text;
begin
  select * into a from app_users where id=p_actor_id and active=true; if a.role<>'owner' then raise exception 'FORBIDDEN'; end if;
  if coalesce(trim(p_reason),'')='' then raise exception 'REASON_REQUIRED'; end if;
  select * into s from sales where id=p_sale_id for update; if s.id is null then raise exception 'SALE_NOT_FOUND'; end if;
  if s.status='voided' then raise exception 'ALREADY_VOIDED'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'EMPTY_CART'; end if;
  for newx in select * from jsonb_array_elements(p_items) loop
    qnew:=coalesce((newx->>'qty')::numeric,0); if qnew<=0 then raise exception 'INVALID_QTY'; end if;
    select * into p from products where id=newx->>'productId' and active=true; if p.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
    unit_price:=p.sell_price; unit_cost:=p.cost_price;
    if p.type='bulk' then line_rev:=(qnew/1000)*unit_price; line_cost:=(qnew/1000)*unit_cost; else line_rev:=qnew*unit_price; line_cost:=qnew*unit_cost; end if;
    final_items:=final_items||jsonb_build_array(jsonb_build_object('productId',p.id,'name',p.name,'type',p.type,'packageWeight',p.package_weight,'sellPrice',unit_price,'costPrice',unit_cost,'qty',qnew,'lineRevenue',line_rev,'lineCost',line_cost));
    total:=total+line_rev; cost:=cost+line_cost;
  end loop;
  for p in select * from products where active=true and track_stock=true and id in (select value->>'productId' from jsonb_array_elements(s.items) value union select value->>'productId' from jsonb_array_elements(p_items) value) loop
    select coalesce((select (value->>'qty')::numeric from jsonb_array_elements(s.items) value where value->>'productId'=p.id limit 1),0) into qold;
    select coalesce((select sum((value->>'qty')::numeric) from jsonb_array_elements(p_items) value where value->>'productId'=p.id),0) into qnew;
    delta:=qold-qnew;
    if delta<>0 then
      select * into st from stock where branch_id=s.branch_id and product_id=p.id for update;
      before_qty:=coalesce(st.qty,0); after_qty:=before_qty+delta;
      if after_qty<0 then raise exception 'INSUFFICIENT_STOCK:%',p.name; end if;
      insert into stock(branch_id,product_id,qty) values(s.branch_id,p.id,after_qty) on conflict(branch_id,product_id) do update set qty=excluded.qty;
      insert into inventory_ledger(branch_id,product_id,delta,qty_before,qty_after,movement_type,reference_id,reason,actor_id) values(s.branch_id,p.id,delta,before_qty,after_qty,'sale_edit',s.id,p_reason,p_actor_id);
    end if;
  end loop;
  before_sale:=to_jsonb(s);
  update sales set items=final_items,total=total,cost=cost,profit=total-cost where id=s.id returning * into s;
  insert into audit_log(actor_id,action,entity_type,entity_id,branch_id,reason,before_data,after_data) values(p_actor_id,'update_sale','sale',s.id,s.branch_id,p_reason,before_sale,to_jsonb(s));
  return to_jsonb(s);
end $$;

grant execute on function public.pos_update_sale(text,jsonb,text,text) to service_role;

create or replace function public.pos_daily_finance(p_branch_id text,p_date date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.app_users%rowtype; revenue numeric; cash numeric; vf numeric; profit numeric; count_sales bigint; shifts_count bigint; closed_count bigint;
begin
  select coalesce(sum(total),0),coalesce(sum(cost),0),count(*) filter(where status='completed'),coalesce(sum(total) filter(where payment_method='cash' and status='completed'),0),coalesce(sum(total) filter(where payment_method='vodafone_cash' and status='completed'),0)
    into revenue,profit,count_sales,cash,vf from sales where (p_branch_id is null or branch_id=p_branch_id) and ts >= (p_date::timestamp at time zone 'Africa/Cairo') and ts < ((p_date+1)::timestamp at time zone 'Africa/Cairo');
  select count(*),count(*) filter(where closed_at is not null) into shifts_count,closed_count from shifts where (p_branch_id is null or branch_id=p_branch_id) and opened_at >= (p_date::timestamp at time zone 'Africa/Cairo') and opened_at < ((p_date+1)::timestamp at time zone 'Africa/Cairo');
  return jsonb_build_object('revenue',revenue,'profit',profit,'count',count_sales,'cash',cash,'vodafone_cash',vf,'shifts',shifts_count,'closed_shifts',closed_count);
end $$;

-- Allow the API's service-role execution while keeping browser roles blocked.
grant execute on function public.pos_restock(text,text,numeric,text), public.pos_open_shift(text,text,text,numeric), public.pos_create_sale(text,text,jsonb,text,text,text), public.pos_void_sale(text,text,text), public.pos_update_sale(text,jsonb,text,text), public.pos_close_shift(text,numeric,text,text), public.pos_daily_finance(text,date) to service_role;
