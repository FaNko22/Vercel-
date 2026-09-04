-- Bin Alshareeb POS — V7 fix sale editing
-- `total` conflicted with sales.total inside PL/pgSQL, causing invoice edits to fail.

create or replace function public.pos_update_sale_v2(p_sale_id text,p_items jsonb,p_reason text,p_actor_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  a public.app_users%rowtype; s public.sales%rowtype; before_sale jsonb;
  old_item jsonb; new_item jsonb; p public.products%rowtype; st public.stock%rowtype;
  oldq numeric; newq numeric; delta numeric; before_qty numeric; after_qty numeric;
  v_total numeric:=0; cost_total numeric:=0; final_items jsonb:='[]'::jsonb; pid text; seen jsonb:='{}'::jsonb; unit_price numeric; unit_cost numeric; line_rev numeric; line_cost numeric;
begin
  select * into a from public.app_users where id=p_actor_id and active=true;
  if a.id is null or a.role<>'owner' then raise exception 'FORBIDDEN'; end if;
  if coalesce(trim(p_reason),'')='' then raise exception 'REASON_REQUIRED'; end if;
  select * into s from public.sales where id=p_sale_id for update;
  if s.id is null then raise exception 'SALE_NOT_FOUND'; end if;
  if s.status='voided' then raise exception 'ALREADY_VOIDED'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'EMPTY_CART'; end if;

  for new_item in select * from jsonb_array_elements(p_items) loop
    pid:=nullif(trim(new_item->>'productId'),''); newq:=coalesce((new_item->>'qty')::numeric,0);
    if pid is null or newq<=0 then raise exception 'INVALID_QTY'; end if;
    if seen ? pid then raise exception 'DUPLICATE_PRODUCT'; end if;
    seen:=seen || jsonb_build_object(pid,true);
    select * into old_item from jsonb_array_elements(s.items) item where item->>'productId'=pid limit 1;
    if old_item is null then raise exception 'NEW_PRODUCT_NOT_ALLOWED'; end if;
    unit_price:=coalesce((old_item->>'sellPrice')::numeric,0); unit_cost:=coalesce((old_item->>'costPrice')::numeric,0);
    if (old_item->>'type')='bulk' then line_rev:=(newq/1000)*unit_price; line_cost:=(newq/1000)*unit_cost; else line_rev:=newq*unit_price; line_cost:=newq*unit_cost; end if;
    final_items:=final_items||jsonb_build_array(jsonb_build_object('productId',pid,'name',old_item->>'name','type',old_item->>'type','packageWeight',old_item->'packageWeight','sellPrice',unit_price,'costPrice',unit_cost,'qty',newq,'lineRevenue',line_rev,'lineCost',line_cost));
    v_total:=v_total+line_rev; cost_total:=cost_total+line_cost;
  end loop;

  for pid in select distinct item->>'productId' from jsonb_array_elements(s.items) item union select distinct item->>'productId' from jsonb_array_elements(p_items) item loop
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
        insert into public.stock(branch_id,product_id,qty) values(s.branch_id,p.id,after_qty) on conflict(branch_id,product_id) do update set qty=excluded.qty;
        insert into public.inventory_ledger(branch_id,product_id,delta,qty_before,qty_after,movement_type,reference_id,reason,actor_id) values(s.branch_id,p.id,delta,before_qty,after_qty,'sale_edit',s.id,p_reason,p_actor_id);
      end if;
    end if;
  end loop;

  before_sale:=to_jsonb(s);
  update public.sales set items=final_items,total=v_total,cost=cost_total,profit=v_total-cost_total where id=s.id returning * into s;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,branch_id,reason,before_data,after_data) values(p_actor_id,'update_sale','sale',s.id,s.branch_id,p_reason,before_sale,to_jsonb(s));
  return to_jsonb(s);
end $$;
revoke all on function public.pos_update_sale_v2(text,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.pos_update_sale_v2(text,jsonb,text,text) to service_role;
