-- =================================================================
-- Subcategory Quick Reference Queries
-- คัดลอกและรันใน Supabase SQL Editor ได้เลย
-- =================================================================

-- 1. ดู Subcategories ทั้งหมดในระบบ (จัดกลุ่มตาม SKU และ Part Group)
-- =================================================================
SELECT 
  s.name as "SKU",
  pg.name_th as "Part Group",
  sc.name as "Subcategory",
  CASE 
    WHEN sc.image_url IS NULL THEN '❌ ยังไม่มีรูป'
    ELSE '✅ มีรูปแล้ว'
  END as "สถานะรูปแทน",
  sc.sort_order as "ลำดับ",
  COUNT(a.id) as "จำนวนรูปภาพ"
FROM subcategories sc
JOIN skus s ON sc.sku_id = s.id
JOIN part_groups pg ON sc.group_key = pg.key
LEFT JOIN assets a ON a.subcategory_id = sc.id
GROUP BY s.name, pg.name_th, sc.name, sc.image_url, sc.sort_order, pg.sort_order
ORDER BY s.name, pg.sort_order, sc.sort_order;


-- 2. ดู Subcategories ของ SKU เฉพาะ (แทนที่ 'daytona' ด้วย SKU ที่ต้องการ)
-- =================================================================
SELECT 
  pg.name_th as "Part Group",
  sc.id as "Subcategory ID",
  sc.name as "Subcategory Name",
  sc.image_url as "รูปแทน",
  sc.sort_order as "ลำดับ",
  COUNT(a.id) as "จำนวนรูปภาพ"
FROM subcategories sc
JOIN part_groups pg ON sc.group_key = pg.key
LEFT JOIN assets a ON a.subcategory_id = sc.id
WHERE sc.sku_id = 'daytona'  -- 👈 เปลี่ยนตรงนี้
GROUP BY pg.name_th, sc.id, sc.name, sc.image_url, sc.sort_order, pg.sort_order
ORDER BY pg.sort_order, sc.sort_order;


-- 3. สร้าง Subcategory ใหม่
-- =================================================================
-- ตัวอย่าง: สร้าง subcategory "สายผ้า" สำหรับ bracelet ของ daytona
INSERT INTO subcategories (sku_id, group_key, name, sort_order)
VALUES (
  'daytona',        -- SKU ID
  'bracelet',       -- Part Group Key
  'สายผ้า',         -- ชื่อ Subcategory
  4                 -- ลำดับการแสดง
);


-- 4. อัพเดทรูปภาพแทน Subcategory
-- =================================================================
-- ตัวอย่าง: ใส่รูปให้ subcategory "สายเหล็ก"
UPDATE subcategories
SET image_url = 'https://your-storage-url/subcategory-images/bracelet-steel.png'
WHERE sku_id = 'daytona' 
  AND group_key = 'bracelet' 
  AND name = 'สายเหล็ก';


-- 5. เพิ่มรูปภาพเข้า Subcategory
-- =================================================================
-- ขั้นที่ 1: หา subcategory_id
SELECT id, name 
FROM subcategories 
WHERE sku_id = 'daytona' 
  AND group_key = 'bracelet' 
  AND name = 'สายเหล็ก';

-- ขั้นที่ 2: เพิ่มรูป (ใช้ id จากข้างบน)
INSERT INTO assets (sku_id, group_key, subcategory_id, label, url, sort)
VALUES (
  'daytona',
  'bracelet',
  'YOUR_SUBCATEGORY_UUID_HERE',  -- 👈 ใส่ UUID จากขั้นที่ 1
  'สายเหล็กแบบที่ 1',
  'https://your-storage-url/assets/bracelet-steel-1.png',
  1
);


-- 6. ดูรูปภาพทั้งหมดของ Subcategory
-- =================================================================
SELECT 
  a.label as "ชื่อรูป",
  LEFT(a.url, 60) as "URL (60 อักษรแรก)",
  a.sort as "ลำดับ"
FROM assets a
JOIN subcategories sc ON a.subcategory_id = sc.id
WHERE sc.sku_id = 'daytona'           -- 👈 เปลี่ยนตรงนี้
  AND sc.group_key = 'bracelet'       -- 👈 เปลี่ยนตรงนี้
  AND sc.name = 'สายเหล็ก'            -- 👈 เปลี่ยนตรงนี้
ORDER BY a.sort;


-- 7. ลบ Subcategory (⚠️ จะลบรูปภาพที่เชื่อมทั้งหมดด้วย)
-- =================================================================
DELETE FROM subcategories 
WHERE sku_id = 'daytona' 
  AND group_key = 'bracelet' 
  AND name = 'สายผ้า';


-- 8. เปลี่ยนลำดับการแสดง Subcategories
-- =================================================================
-- ตัวอย่าง: สลับลำดับ "สายเหล็ก" กับ "สายหนัง"
UPDATE subcategories SET sort_order = 2 
WHERE sku_id = 'daytona' AND group_key = 'bracelet' AND name = 'สายเหล็ก';

UPDATE subcategories SET sort_order = 1 
WHERE sku_id = 'daytona' AND group_key = 'bracelet' AND name = 'สายหนัง';


-- 9. หา Subcategories ที่ยังไม่มีรูปแทน (image_url = NULL)
-- =================================================================
SELECT 
  s.name as "SKU",
  pg.name_th as "Part Group",
  sc.name as "Subcategory",
  sc.id as "ID (สำหรับ UPDATE)"
FROM subcategories sc
JOIN skus s ON sc.sku_id = s.id
JOIN part_groups pg ON sc.group_key = pg.key
WHERE sc.image_url IS NULL
ORDER BY s.name, pg.sort_order, sc.sort_order;


-- 10. หา Subcategories ที่ยังไม่มีรูปภาพ (ไม่มี assets)
-- =================================================================
SELECT 
  s.name as "SKU",
  pg.name_th as "Part Group",
  sc.name as "Subcategory",
  sc.id as "Subcategory ID"
FROM subcategories sc
JOIN skus s ON sc.sku_id = s.id
JOIN part_groups pg ON sc.group_key = pg.key
LEFT JOIN assets a ON a.subcategory_id = sc.id
GROUP BY s.name, pg.name_th, sc.name, sc.id, pg.sort_order, sc.sort_order
HAVING COUNT(a.id) = 0
ORDER BY s.name, pg.sort_order, sc.sort_order;


-- 11. สรุปจำนวน Subcategories และรูปภาพแต่ละ SKU
-- =================================================================
SELECT 
  s.name as "SKU",
  COUNT(DISTINCT sc.id) as "จำนวน Subcategories",
  COUNT(DISTINCT CASE WHEN sc.image_url IS NOT NULL THEN sc.id END) as "มีรูปแทนแล้ว",
  COUNT(a.id) as "จำนวนรูปภาพทั้งหมด"
FROM skus s
LEFT JOIN subcategories sc ON sc.sku_id = s.id
LEFT JOIN assets a ON a.subcategory_id = sc.id
GROUP BY s.name
ORDER BY s.name;


-- 12. ย้ายรูปภาพที่ไม่มี subcategory_id ไปยัง subcategory เริ่มต้น
-- =================================================================
-- ขั้นที่ 1: สร้าง subcategory "มาตรฐาน" สำหรับแต่ละ part group (ถ้ายังไม่มี)
INSERT INTO subcategories (sku_id, group_key, name, sort_order)
SELECT DISTINCT 
  a.sku_id,
  a.group_key,
  'มาตรฐาน',
  0
FROM assets a
WHERE a.subcategory_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM subcategories sc 
    WHERE sc.sku_id = a.sku_id 
      AND sc.group_key = a.group_key 
      AND sc.name = 'มาตรฐาน'
  );

-- ขั้นที่ 2: ย้ายรูปไปที่ subcategory "มาตรฐาน"
UPDATE assets a
SET subcategory_id = (
  SELECT sc.id 
  FROM subcategories sc 
  WHERE sc.sku_id = a.sku_id 
    AND sc.group_key = a.group_key 
    AND sc.name = 'มาตรฐาน'
  LIMIT 1
)
WHERE a.subcategory_id IS NULL;


-- 13. ลบ Subcategories ที่ไม่มีรูปภาพ
-- =================================================================
-- ⚠️ ระวัง: จะลบ subcategories ที่ว่างเปล่าออกทั้งหมด
DELETE FROM subcategories sc
WHERE NOT EXISTS (
  SELECT 1 FROM assets a WHERE a.subcategory_id = sc.id
);


-- 14. Clone Subcategories จาก SKU หนึ่งไปอีก SKU
-- =================================================================
-- ตัวอย่าง: คัดลอก subcategories จาก daytona ไปยัง submarine
INSERT INTO subcategories (sku_id, group_key, name, sort_order)
SELECT 
  'submarine',      -- 👈 SKU ปลายทาง
  group_key,
  name,
  sort_order
FROM subcategories
WHERE sku_id = 'daytona'  -- 👈 SKU ต้นทาง
ON CONFLICT (sku_id, group_key, name) DO NOTHING;


-- 15. ดูรายงานสรุปแบบละเอียด
-- =================================================================
SELECT 
  s.name as "SKU",
  pg.name_th as "Part Group",
  pg.key as "Group Key",
  COUNT(DISTINCT sc.id) as "จำนวน Subcategories",
  COUNT(DISTINCT CASE WHEN sc.image_url IS NOT NULL THEN sc.id END) as "มีรูปแทน",
  COUNT(DISTINCT CASE WHEN sc.image_url IS NULL THEN sc.id END) as "ยังไม่มีรูปแทน",
  COUNT(a.id) as "จำนวนรูปภาพ",
  STRING_AGG(DISTINCT sc.name, ', ' ORDER BY sc.name) as "รายชื่อ Subcategories"
FROM skus s
CROSS JOIN part_groups pg
LEFT JOIN subcategories sc ON sc.sku_id = s.id AND sc.group_key = pg.key
LEFT JOIN assets a ON a.subcategory_id = sc.id
GROUP BY s.name, pg.name_th, pg.key, pg.sort_order
ORDER BY s.name, pg.sort_order;


-- =================================================================
-- View: assets_with_subcategory (สร้างไว้แล้ว)
-- =================================================================
-- ใช้ View นี้ได้เลยโดยไม่ต้อง JOIN เอง
SELECT * FROM assets_with_subcategory
WHERE sku_id = 'daytona' 
  AND group_key = 'bracelet'
  AND subcategory_name = 'สายเหล็ก'
ORDER BY sort;

