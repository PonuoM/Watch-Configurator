-- เพิ่มข้อมูล SKU default
INSERT INTO public.skus (id, name) VALUES ('default', 'Default Watch') 
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- เพิ่มข้อมูล Assets สำหรับ SKU default (ใช้ URL จาก Supabase Storage)
INSERT INTO public.assets (sku_id, group_key, label, url, sort) VALUES
-- Dial images
('default', 'dial', 'Dial 1', 'https://orqyxamgukajopqdxpdg.supabase.co/storage/v1/object/public/watch-assets/default/dial/dial1.png', 1),
('default', 'dial', 'Dial 2', 'https://orqyxamgukajopqdxpdg.supabase.co/storage/v1/object/public/watch-assets/default/dial/dial2.png', 2),

-- Hands images  
('default', 'hands', 'Hands 1', 'https://orqyxamgukajopqdxpdg.supabase.co/storage/v1/object/public/watch-assets/default/hands/hands1.png', 1),
('default', 'hands', 'Hands 2', 'https://orqyxamgukajopqdxpdg.supabase.co/storage/v1/object/public/watch-assets/default/hands/hands2.png', 2),

-- Second hand images
('default', 'second', 'Second 1', 'https://orqyxamgukajopqdxpdg.supabase.co/storage/v1/object/public/watch-assets/default/second/second1.png', 1),
('default', 'second', 'Second 2', 'https://orqyxamgukajopqdxpdg.supabase.co/storage/v1/object/public/watch-assets/default/second/second2.png', 2),

-- Outer bezel images
('default', 'outer', 'Outer 1', 'https://orqyxamgukajopqdxpdg.supabase.co/storage/v1/object/public/watch-assets/default/outer/outer1.png', 1),
('default', 'outer', 'Outer 2', 'https://orqyxamgukajopqdxpdg.supabase.co/storage/v1/object/public/watch-assets/default/outer/outer2.png', 2),

-- Inner ring images
('default', 'inner', 'Inner 1', 'https://orqyxamgukajopqdxpdg.supabase.co/storage/v1/object/public/watch-assets/default/inner/inner1.png', 1),
('default', 'inner', 'Inner 2', 'https://orqyxamgukajopqdxpdg.supabase.co/storage/v1/object/public/watch-assets/default/inner/inner2.png', 2),

-- Bracelet images
('default', 'bracelet', 'Bracelet 1', 'https://orqyxamgukajopqdxpdg.supabase.co/storage/v1/object/public/watch-assets/default/bracelet/bracelet1.png', 1),
('default', 'bracelet', 'Bracelet 2', 'https://orqyxamgukajopqdxpdg.supabase.co/storage/v1/object/public/watch-assets/default/bracelet/bracelet2.png', 2)
ON CONFLICT DO NOTHING;
