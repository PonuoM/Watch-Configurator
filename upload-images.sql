-- เพิ่มข้อมูล SKU
INSERT INTO public.skus (id, name) VALUES ('premium-watch', 'Premium Watch') 
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- เพิ่มข้อมูล Assets (แก้ไข URL ให้ตรงกับที่อยู่จริงใน Supabase Storage)
INSERT INTO public.assets (sku_id, group_key, label, url, sort) VALUES
-- Dial images
('premium-watch', 'dial', 'Dial 1', 'https://orqyxamgukajopqdxpdg.supabase.co/storage/v1/object/public/watch-assets/premium-watch/dial/dial1.png', 1),
('premium-watch', 'dial', 'Dial 2', 'https://orqyxamgukajopqdxpdg.supabase.co/storage/v1/object/public/watch-assets/premium-watch/dial/dial2.png', 2),

-- Hands images
('premium-watch', 'hands', 'Hands 1', 'https://orqyxamgukajopqdxpdg.supabase.co/storage/v1/object/public/watch-assets/premium-watch/hands/hands1.png', 1),
('premium-watch', 'hands', 'Hands 2', 'https://orqyxamgukajopqdxpdg.supabase.co/storage/v1/object/public/watch-assets/premium-watch/hands/hands2.png', 2),

-- Second hand images
('premium-watch', 'second', 'Second 1', 'https://orqyxamgukajopqdxpdg.supabase.co/storage/v1/object/public/watch-assets/premium-watch/second/second1.png', 1),
('premium-watch', 'second', 'Second 2', 'https://orqyxamgukajopqdxpdg.supabase.co/storage/v1/object/public/watch-assets/premium-watch/second/second2.png', 2),

-- Outer bezel images
('premium-watch', 'outer', 'Outer 1', 'https://orqyxamgukajopqdxpdg.supabase.co/storage/v1/object/public/watch-assets/premium-watch/outer/outer1.png', 1),
('premium-watch', 'outer', 'Outer 2', 'https://orqyxamgukajopqdxpdg.supabase.co/storage/v1/object/public/watch-assets/premium-watch/outer/outer2.png', 2),

-- Inner ring images
('premium-watch', 'inner', 'Inner 1', 'https://orqyxamgukajopqdxpdg.supabase.co/storage/v1/object/public/watch-assets/premium-watch/inner/inner1.png', 1),
('premium-watch', 'inner', 'Inner 2', 'https://orqyxamgukajopqdxpdg.supabase.co/storage/v1/object/public/watch-assets/premium-watch/inner/inner2.png', 2),

-- Bracelet images
('premium-watch', 'bracelet', 'Bracelet 1', 'https://orqyxamgukajopqdxpdg.supabase.co/storage/v1/object/public/watch-assets/premium-watch/bracelet/bracelet1.png', 1),
('premium-watch', 'bracelet', 'Bracelet 2', 'https://orqyxamgukajopqdxpdg.supabase.co/storage/v1/object/public/watch-assets/premium-watch/bracelet/bracelet2.png', 2)
ON CONFLICT DO NOTHING;
