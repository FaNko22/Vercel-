-- ============================================
-- بن الشريب — إعداد قاعدة البيانات (شغّلها مرة واحدة في مشروع جديد)
-- Supabase Dashboard > SQL Editor > New query > الصق ودوس Run
-- ============================================

create table if not exists branches (
  id text primary key,
  name text not null
);

create table if not exists products (
  id text primary key,
  name text not null,
  type text not null check (type in ('bulk','packaged','piece')),
  package_weight numeric,
  sell_price numeric not null,
  cost_price numeric not null default 0,
  track_stock boolean not null default true,
  reorder_point numeric not null default 0
);

create table if not exists stock (
  branch_id text references branches(id) on delete cascade,
  product_id text references products(id) on delete cascade,
  qty numeric not null default 0,
  primary key (branch_id, product_id)
);

create table if not exists app_users (
  id text primary key,
  name text not null,
  pin text not null,
  role text not null check (role in ('manager','staff')),
  branch_id text references branches(id),
  permissions jsonb not null default '{}'::jsonb
);

create table if not exists sales (
  id text primary key,
  branch_id text references branches(id),
  branch_name text,
  cashier_id text,
  cashier_name text,
  ts timestamptz not null default now(),
  items jsonb not null,
  total numeric not null,
  cost numeric not null,
  profit numeric not null,
  customer_name text,
  customer_phone text,
  payment_method text default 'cash'
);

create table if not exists shifts (
  id text primary key,
  branch_id text references branches(id),
  branch_name text,
  user_id text,
  user_name text,
  opened_at timestamptz not null default now(),
  opening_cash numeric not null default 0,
  closed_at timestamptz,
  expected_cash numeric,
  actual_cash numeric,
  difference numeric,
  notes text
);

-- تفعيل الأمان على مستوى الصفوف (RLS)
alter table branches enable row level security;
alter table products enable row level security;
alter table stock enable row level security;
alter table app_users enable row level security;
alter table sales enable row level security;
alter table shifts enable row level security;

-- السماح لأي حد معاه مفتاح الـ anon/publishable بالقراءة والكتابة
-- (النظام بيعتمد على تسجيل دخول داخلي بالـ PIN جوه التطبيق نفسه، مش على Supabase Auth)
drop policy if exists "allow all - branches" on branches;
create policy "allow all - branches" on branches for all using (true) with check (true);

drop policy if exists "allow all - products" on products;
create policy "allow all - products" on products for all using (true) with check (true);

drop policy if exists "allow all - stock" on stock;
create policy "allow all - stock" on stock for all using (true) with check (true);

drop policy if exists "allow all - app_users" on app_users;
create policy "allow all - app_users" on app_users for all using (true) with check (true);

drop policy if exists "allow all - sales" on sales;
create policy "allow all - sales" on sales for all using (true) with check (true);

drop policy if exists "allow all - shifts" on shifts;
create policy "allow all - shifts" on shifts for all using (true) with check (true);

-- الفروع الافتراضية (تقدر تغيّر الأسماء بعدين من داخل التطبيق)
insert into branches (id, name) values
  ('b1','الفرع الأول'),
  ('b2','الفرع الثاني'),
  ('b3','الفرع الثالث')
on conflict (id) do nothing;

-- تفعيل التحديث اللحظي بين الفروع
alter publication supabase_realtime add table stock;
alter publication supabase_realtime add table sales;
alter publication supabase_realtime add table products;
alter publication supabase_realtime add table app_users;
alter publication supabase_realtime add table branches;
alter publication supabase_realtime add table shifts;
