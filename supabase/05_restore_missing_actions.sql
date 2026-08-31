-- بن الشريب POS — V4 missing API actions
-- Additive migration. Restores the server actions referenced by /api/pos.
-- Safe for the current test database and does not delete transactional data.

create or replace function public.pos_restock(p_branch_id text,p_product_id text,p_delta numeric,p_user_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.app_users%rowtype; p public.products%rowtype; st public.stock%rowtype; before_qty numeric; after_qty numeric; result jsonb;
begin
  select * into a from public.app_users where id=p_user_id and active=true;
  if a.id is null or a.role<>'owner' then raise exception 'FORBIDDEN'; end if;
  if p_branch_id is null or p_product_id is null or p_delta is null or p_delta<=0 then raise exception 'INVALID_RESTOCK'; end if;
  select * into p from public.products where id=p_product_id and active=true;
  if p.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
  select * into st from public.stock where branch_id=p_branch_id and product_id=p_product_id for update;
  before_qty:=coalesce(st.qty,0); after_qty:=before_qty+p_delta;
  insert into public.stock(branch_id,product_id,qty) values(p_branch_id,p_product_id,after_qty)
    on conflict(branch_id,product_id) do update set qty=excluded.qty;
  insert into public.inventory_ledger(branch_id,product_id,delta,qty_before,qty_after,movement_type,reference_id,reason,actor_id)
    values(p_branch_id,p_product_id,p_delta,before_qty,after_qty,'restock',null,'Owner restock',p_user_id);
  result:=jsonb_build_object('branch_id',p_branch_id,'product_id',p_product_id,'qty_before',before_qty,'qty_after',after_qty);
  insert into public.audit_log(actor_id,action,entity_type,entity_id,branch_id,after_data)
    values(p_user_id,'restock','stock',p_product_id,p_branch_id,result);
  return result;
end $$;
revoke all on function public.pos_restock(text,text,numeric,text) from public,anon,authenticated;
grant execute on function public.pos_restock(text,text,numeric,text) to service_role;

create or replace function public.pos_close_shift(p_shift_id text,p_actual_cash numeric,p_notes text,p_closed_by text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.app_users%rowtype; s public.shifts%rowtype; before_shift jsonb; expected numeric; diff numeric;
begin
  select * into a from public.app_users where id=p_closed_by and active=true;
  if a.id is null or a.role not in ('manager','owner') then raise exception 'FORBIDDEN'; end if;
  if p_actual_cash is null or p_actual_cash<0 then raise exception 'INVALID_CASH'; end if;
  select * into s from public.shifts where id=p_shift_id for update;
  if s.id is null then raise exception 'SHIFT_NOT_FOUND'; end if;
  if s.closed_at is not null then raise exception 'SHIFT_ALREADY_CLOSED'; end if;
  if a.role='manager' and a.branch_id is distinct from s.branch_id then raise exception 'BRANCH_FORBIDDEN'; end if;
  select s.opening_cash + coalesce(sum(total) filter(where payment_method='cash' and status='completed'),0)
    into expected
  from public.sales where shift_id=s.id;
  diff:=p_actual_cash-expected;
  before_shift:=to_jsonb(s);
  update public.shifts
    set closed_at=now(), expected_cash=expected, actual_cash=p_actual_cash, difference=diff,
        notes=nullif(trim(coalesce(p_notes,'')),''), closed_by=p_closed_by
    where id=s.id returning * into s;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,branch_id,reason,before_data,after_data)
    values(p_closed_by,'close_shift','shift',s.id,s.branch_id,nullif(trim(coalesce(p_notes,'')),''),before_shift,to_jsonb(s));
  return to_jsonb(s);
end $$;
revoke all on function public.pos_close_shift(text,numeric,text,text) from public,anon,authenticated;
grant execute on function public.pos_close_shift(text,numeric,text,text) to service_role;

create or replace function public.pos_void_sale(p_sale_id text,p_reason text,p_actor_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.app_users%rowtype; s public.sales%rowtype; before_sale jsonb; item jsonb; p public.products%rowtype; st public.stock%rowtype; q numeric; before_qty numeric; after_qty numeric;
begin
  select * into a from public.app_users where id=p_actor_id and active=true;
  if a.id is null or a.role<>'owner' then raise exception 'FORBIDDEN'; end if;
  if coalesce(trim(p_reason),'')='' then raise exception 'REASON_REQUIRED'; end if;
  select * into s from public.sales where id=p_sale_id for update;
  if s.id is null then raise exception 'SALE_NOT_FOUND'; end if;
  if s.status='voided' then raise exception 'ALREADY_VOIDED'; end if;
  before_sale:=to_jsonb(s);
  for item in select * from jsonb_array_elements(s.items) loop
    q:=coalesce((item->>'qty')::numeric,0);
    if q<=0 then raise exception 'INVALID_QTY'; end if;
    select * into p from public.products where id=(item->>'productId');
    if p.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
    if p.track_stock then
      select * into st from public.stock where branch_id=s.branch_id and product_id=p.id for update;
      before_qty:=coalesce(st.qty,0); after_qty:=before_qty+q;
      insert into public.stock(branch_id,product_id,qty) values(s.branch_id,p.id,after_qty)
        on conflict(branch_id,product_id) do update set qty=excluded.qty;
      insert into public.inventory_ledger(branch_id,product_id,delta,qty_before,qty_after,movement_type,reference_id,reason,actor_id)
        values(s.branch_id,p.id,q,before_qty,after_qty,'sale_void',s.id,p_reason,p_actor_id);
    end if;
  end loop;
  update public.sales set status='voided',voided_at=now(),voided_by=p_actor_id,void_reason=p_reason where id=s.id returning * into s;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,branch_id,reason,before_data,after_data)
    values(p_actor_id,'void_sale','sale',s.id,s.branch_id,p_reason,before_sale,to_jsonb(s));
  return to_jsonb(s);
end $$;
revoke all on function public.pos_void_sale(text,text,text) from public,anon,authenticated;
grant execute on function public.pos_void_sale(text,text,text) to service_role;

create unique index if not exists app_users_one_owner on public.app_users ((role)) where role='owner' and active=true;
create unique index if not exists app_users_one_manager_per_branch on public.app_users (branch_id) where role='manager' and active=true;
create unique index if not exists app_users_one_cashier_per_period on public.app_users (branch_id,shift_period) where role='cashier' and active=true;
create unique index if not exists shifts_one_active_per_branch_v3 on public.shifts(branch_id) where closed_at is null;
