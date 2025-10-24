# การตั้งค่า Subcategories สำเร็จแล้ว ✅

## สิ่งที่ทำไปแล้ว

### 1. ✅ แก้ไขโครงสร้างฐานข้อมูล
- ลบ `group_key` ออกจากตาราง `subcategories` (เพราะ subcategory คือการแบ่งกลุ่มตาม SKU ไม่ใช่ตาม part group)
- ลบ `image_url` ออกจาก `subcategories` (ใช้ตาราง assets แทน)
- เพิ่ม `subcategory_id` (uuid) ใน `assets` table เพื่อเชื่อมกับ `subcategories`
- สร้าง index เพื่อเพิ่มประสิทธิภาพ

### 2. ✅ สร้าง SKUs ใหม่
มี SKU ทั้งหมด 6 ตัว:
- `daytona` - Daytona
- `submarine` - Submarine  
- `SKU2` - นาฬิกา SKU2
- `SKU3` - นาฬิกา SKU3
- `SKU4` - นาฬิกา SKU4
- `SKU5` - นาฬิกา SKU5

### 3. ✅ สร้าง Subcategories
แต่ละ SKU มี subcategories ดังนี้:

**SKU2:**
- รุ่นมาตรฐาน (ID: `ead859e6-cde8-4c39-a037-29d0d59cd04e`)
- รุ่นพิเศษ (ID: `cac7c194-7d72-4599-ba7c-3f6ed2cc6cdc`)

**SKU3:**
- รุ่นมาตรฐาน (ID: `63b38154-6ea7-4531-84d4-b1cf5857973b`)
- รุ่นลิมิเต็ด (ID: `20d7913a-f441-4b38-9178-fe5bceb931ec`)

**SKU4:**
- รุ่นมาตรฐาน (ID: `efbc7dcf-bc13-424c-a7a7-51af53a4aa15`)
- รุ่นกันน้ำ (ID: `e733df46-a775-4cfe-9956-079a287012b3`)

**SKU5:**
- รุ่นมาตรฐาน (ID: `f0350efb-21a1-4102-80e3-54e942a21301`)
- รุ่นสปอร์ต (ID: `4cd5c066-82ef-4e7e-b53a-0439cffa023d`)

**Daytona & Submarine:**
- มาตรฐาน

### 4. ✅ สร้าง View สำหรับดึงข้อมูล
สร้าง `assets_with_subcategory` view ที่รวมข้อมูล:
- SKU details (id, name)
- Subcategory details (id, name, sort_order)
- Part group details (key, name_th, name_en, z_index)
- Asset details (label, url, sort)

## โครงสร้างฐานข้อมูลปัจจุบัน

```sql
-- ตาราง skus
skus (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ
)

-- ตาราง subcategories
subcategories (
  id UUID PRIMARY KEY,
  sku_id TEXT REFERENCES skus(id),  -- เชื่อมกับ SKU
  name TEXT NOT NULL,                -- ชื่อ subcategory
  sort_order INT,                    -- ลำดับการแสดงผล
  created_at TIMESTAMPTZ
)

-- ตาราง assets
assets (
  id UUID PRIMARY KEY,
  sku_id TEXT REFERENCES skus(id),
  subcategory_id UUID REFERENCES subcategories(id),  -- เชื่อมกับ subcategory
  subcategory TEXT,                                  -- เก็บไว้เผื่อ backward compatibility
  group_key TEXT REFERENCES part_groups(key),
  label TEXT,
  url TEXT NOT NULL,
  sort INT,
  created_at TIMESTAMPTZ
)
```

## วิธีใช้งาน

### 1. ดูรายการ Subcategories ทั้งหมด

```sql
SELECT 
  s.id as sku_id,
  s.name as sku_name,
  sc.id as subcategory_id,
  sc.name as subcategory_name,
  sc.sort_order
FROM skus s
LEFT JOIN subcategories sc ON sc.sku_id = s.id
ORDER BY s.name, sc.sort_order;
```

### 2. ดูรายการ Subcategories ของ SKU เฉพาะ

```sql
-- ตัวอย่าง: ดู subcategories ของ SKU2
SELECT id, name, sort_order
FROM subcategories
WHERE sku_id = 'SKU2'
ORDER BY sort_order;
```

### 3. เพิ่มรูปภาพเข้า Subcategory

```sql
-- ขั้นตอนที่ 1: เลือก subcategory_id
SELECT id FROM subcategories WHERE sku_id = 'SKU2' AND name = 'รุ่นมาตรฐาน';

-- ขั้นตอนที่ 2: เพิ่มรูป (ใช้ id จากข้างบน)
INSERT INTO assets (sku_id, subcategory_id, group_key, label, url, sort)
VALUES (
  'SKU2',
  'ead859e6-cde8-4c39-a037-29d0d59cd04e',  -- subcategory_id
  'dial',
  'หน้าปัด 1',
  'https://your-storage-url/SKU2/dial1.png',
  1
);
```

### 4. ดูรูปภาพตาม Subcategory

```sql
-- ใช้ View ที่สร้างไว้
SELECT * FROM assets_with_subcategory
WHERE sku_id = 'SKU2' AND subcategory_name = 'รุ่นมาตรฐาน'
ORDER BY z_index, sort;
```

### 5. ย้ายรูปเดิมไปที่ Subcategory

```sql
-- ตัวอย่าง: ย้ายรูปทั้งหมดของ daytona ไปที่ subcategory "มาตรฐาน"
UPDATE assets
SET subcategory_id = '4d35def8-6a6d-458e-84b9-584371dad1ee'
WHERE sku_id = 'daytona' AND subcategory_id IS NULL;
```

### 6. สร้าง Subcategory ใหม่

```sql
INSERT INTO subcategories (sku_id, name, sort_order)
VALUES ('SKU2', 'รุ่นกีฬา', 3);
```

### 7. ลบ Subcategory

```sql
-- ⚠️ ระวัง: จะลบรูปภาพที่เชื่อมอยู่ทั้งหมดด้วย (cascade)
DELETE FROM subcategories WHERE id = 'YOUR-UUID-HERE';
```

## การใช้งานใน Frontend

### ใน admin.html - แสดง Dropdown Subcategories

```javascript
// ดึง subcategories เมื่อเลือก SKU
async function loadSubcategoriesForSKU(skuId) {
  const { data, error } = await supabase
    .from('subcategories')
    .select('id, name, sort_order')
    .eq('sku_id', skuId)
    .order('sort_order');
  
  if (error) {
    console.error('Error loading subcategories:', error);
    return [];
  }
  
  return data;
}

// แสดงใน dropdown
function renderSubcategoryDropdown(subcategories) {
  const html = subcategories.map(sc => 
    `<option value="${sc.id}">${sc.name}</option>`
  ).join('');
  
  document.getElementById('subcategory-select').innerHTML = html;
}
```

### ใน script.js - โหลดรูปภาพตาม Subcategory

```javascript
// โหลด assets พร้อม subcategory
async function loadAssetsWithSubcategory(skuId, subcategoryId = null) {
  let query = supabase
    .from('assets_with_subcategory')
    .select('*')
    .eq('sku_id', skuId);
  
  if (subcategoryId) {
    query = query.eq('subcategory_id', subcategoryId);
  }
  
  const { data, error } = await query.order('z_index').order('sort');
  
  if (error) {
    console.error('Error loading assets:', error);
    return [];
  }
  
  return data;
}
```

## ตัวอย่างการอัพโหลดรูปจากโฟลเดอร์

ถ้ามีรูปใน `2/SKU2/`, `2/SKU3/` ต้องการอัพโหลด:

1. **อัพโหลดไฟล์ไปที่ Supabase Storage:**
   - Path: `watch-assets/SKU2/{group_key}/{filename}.png`
   - ตัวอย่าง: `watch-assets/SKU2/dial/6710f48460cce0e9a7cc242d.png`

2. **บันทึก URL ลง database:**
   ```sql
   INSERT INTO assets (sku_id, subcategory_id, group_key, label, url, sort)
   VALUES (
     'SKU2',
     'ead859e6-cde8-4c39-a037-29d0d59cd04e',
     'dial',
     'หน้าปัด 1',
     'https://orqyxamgukajopqdxpdg.supabase.co/storage/v1/object/public/watch-assets/SKU2/dial/6710f48460cce0e9a7cc242d.png',
     1
   );
   ```

## Query ที่เป็นประโยชน์

### สรุปจำนวนรูปแต่ละ SKU/Subcategory

```sql
SELECT 
  s.name as sku_name,
  sc.name as subcategory_name,
  a.group_key,
  COUNT(*) as image_count
FROM assets a
LEFT JOIN skus s ON a.sku_id = s.id
LEFT JOIN subcategories sc ON a.subcategory_id = sc.id
GROUP BY s.name, sc.name, a.group_key
ORDER BY s.name, sc.name, a.group_key;
```

### หารูปที่ยังไม่ได้กำหนด Subcategory

```sql
SELECT sku_id, group_key, COUNT(*) as count
FROM assets
WHERE subcategory_id IS NULL
GROUP BY sku_id, group_key
ORDER BY sku_id, group_key;
```

### ตรวจสอบ Subcategory ที่ไม่มีรูป

```sql
SELECT 
  s.name as sku_name,
  sc.name as subcategory_name,
  COUNT(a.id) as image_count
FROM subcategories sc
JOIN skus s ON sc.sku_id = s.id
LEFT JOIN assets a ON a.subcategory_id = sc.id
GROUP BY s.name, sc.name
HAVING COUNT(a.id) = 0;
```

## ขั้นตอนถัดไป

1. ✅ ฐานข้อมูลพร้อมแล้ว
2. 🔲 อัพเดต `admin.html` ให้แสดง subcategory dropdown เมื่อเลือก SKU
3. 🔲 แก้ไข `script.js` ให้โหลดและแสดงรูปตาม subcategory
4. 🔲 อัพโหลดรูปจากโฟลเดอร์ `2/SKU2/`, `2/SKU3/`, ฯลฯ
5. 🔲 บันทึก `subcategory_id` สำหรับรูปแต่ละรูป

---

## ตัวอย่าง UI Flow

1. **ผู้ใช้เลือก SKU** → แสดง dropdown subcategories
2. **ผู้ใช้เลือก Subcategory** → แสดงรูปภาพของ subcategory นั้น
3. **ผู้ใช้เลือกชิ้นส่วน** → ประกอบนาฬิกาจากรูปของ subcategory ที่เลือก
4. **ผู้ใช้กด Save/Download** → บันทึกผลลัพธ์

หากมีคำถามเพิ่มเติม สามารถเปิด browser console เพื่อดู error logs ได้ครับ

