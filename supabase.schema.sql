-- Run this in Supabase SQL Editor to set up DB + Storage policies.
-- Safe to run multiple times (uses IF NOT EXISTS where possible).

-- Optional: ensure uuid generator exists
create extension if not exists pgcrypto;

-- 1) Tables
create table if not exists public.skus (
  id text primary key,
  name text not null,
  created_at timestamptz default now()
);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  sku_id text not null references public.skus(id) on delete cascade,
  group_key text not null check (group_key in ('dial','hands','second','outer','inner','bracelet')),
  label text,
  url text not null,
  sort int default 0,
  created_at timestamptz default now()
);

create index if not exists idx_assets_sku_group_sort on public.assets (sku_id, group_key, sort);

-- 2) RLS (Row Level Security)
alter table public.skus enable row level security;
alter table public.assets enable row level security;

-- Read for everyone (public website)
drop policy if exists skus_select_public on public.skus;
create policy skus_select_public on public.skus for select using (true);

drop policy if exists assets_select_public on public.assets;
create policy assets_select_public on public.assets for select using (true);

-- Write for authenticated users (recommended). Replace with stricter rules later if needed.
drop policy if exists skus_write_auth on public.skus;
create policy skus_write_auth on public.skus for insert to authenticated with check (true);

drop policy if exists skus_update_auth on public.skus;
create policy skus_update_auth on public.skus for update to authenticated using (true) with check (true);

drop policy if exists assets_write_auth on public.assets;
create policy assets_write_auth on public.assets for insert to authenticated with check (true);

drop policy if exists assets_update_auth on public.assets;
create policy assets_update_auth on public.assets for update to authenticated using (true) with check (true);

-- (Optional, quick demo only – NOT for production)
-- Allow anon writes so the current Admin UI (no login) can save directly.
-- Comment these out for production or after you add Supabase Auth to the admin.
drop policy if exists skus_write_anon on public.skus;
create policy skus_write_anon on public.skus for insert to anon with check (true);
drop policy if exists skus_update_anon on public.skus;
create policy skus_update_anon on public.skus for update to anon using (true) with check (true);
drop policy if exists assets_write_anon on public.assets;
create policy assets_write_anon on public.assets for insert to anon with check (true);
drop policy if exists assets_update_anon on public.assets;
create policy assets_update_anon on public.assets for update to anon using (true) with check (true);

-- 3) Storage bucket + policies
-- Create bucket (run once). If it exists already this will error; ignore or remove.
-- select storage.create_bucket('watch-assets', public => true);

-- Enable policies for Storage objects (RLS is already managed by Supabase for storage.objects)

drop policy if exists public_read_watch_assets on storage.objects;
create policy public_read_watch_assets on storage.objects
for select using (bucket_id = 'watch-assets');

drop policy if exists auth_write_watch_assets on storage.objects;
create policy auth_write_watch_assets on storage.objects
for insert to authenticated with check (bucket_id = 'watch-assets');

drop policy if exists auth_update_watch_assets on storage.objects;
create policy auth_update_watch_assets on storage.objects
for update to authenticated using (bucket_id = 'watch-assets') with check (bucket_id = 'watch-assets');

-- (Optional, quick demo only)
drop policy if exists anon_write_watch_assets on storage.objects;
create policy anon_write_watch_assets on storage.objects
for insert to anon with check (bucket_id = 'watch-assets');
drop policy if exists anon_update_watch_assets on storage.objects;
create policy anon_update_watch_assets on storage.objects
for update to anon using (bucket_id = 'watch-assets') with check (bucket_id = 'watch-assets');

-- 4) Seed example (replace URLs with your Storage public URLs)
-- insert into public.skus (id,name) values ('nautilus','Nautilus') on conflict (id) do update set name=excluded.name;
-- insert into public.assets (sku_id, group_key, label, url, sort) values
-- ('nautilus','dial','Dial 1','https://YOUR-PROJECT.supabase.co/storage/v1/object/public/watch-assets/nautilus/dial1.png',1),
-- ('nautilus','hands','Hands 1','https://YOUR-PROJECT.supabase.co/storage/v1/object/public/watch-assets/nautilus/hands1.png',1),
-- ('nautilus','second','Second 1','https://YOUR-PROJECT.supabase.co/storage/v1/object/public/watch-assets/nautilus/second1.png',1),
-- ('nautilus','outer','Outer 1','https://YOUR-PROJECT.supabase.co/storage/v1/object/public/watch-assets/nautilus/outer1.png',1),
-- ('nautilus','inner','Inner 1','https://YOUR-PROJECT.supabase.co/storage/v1/object/public/watch-assets/nautilus/inner1.png',1),
-- ('nautilus','bracelet','Bracelet 1','https://YOUR-PROJECT.supabase.co/storage/v1/object/public/watch-assets/nautilus/bracelet1.png',1);
