# คู่มือ Subcategories (ประเภทย่อยของชิ้นส่วน) ✅

## ความหมายที่ถูกต้อง

**Subcategory** = ประเภทย่อยของแต่ละ **Part Group** ในแต่ละ **SKU**

### ตัวอย่าง:

```
SKU: Daytona
├── Part Group: bracelet (สายนาฬิกา)
│   ├── Subcategory: "สายเหล็ก" 🖼️
│   │   ├── รูปที่ 1
│   │   ├── รูปที่ 2
│   │   └── รูปที่ 3
│   ├── Subcategory: "สายหนัง" 🖼️
│   │   ├── รูปที่ 1
│   │   └── รูปที่ 2
│   └── Subcategory: "สายยาง" 🖼️
│       └── รูปที่ 1
├── Part Group: dial (หน้าปัด)
│   ├── Subcategory: "หน้าปัดสีดำ" 🖼️
│   ├── Subcategory: "หน้าปัดสีขาว" 🖼️
│   └── Subcategory: "หน้าปัดสีน้ำเงิน" 🖼️
└── Part Group: hands (เข็ม)
    ├── Subcategory: "เข็มสีเงิน" 🖼️
    └── Subcategory: "เข็มสีทอง" 🖼️
```

แต่ละ Subcategory จะมี:
- **รูปภาพตัวเอง** (`image_url`) เพื่อแสดงในหน้า index
- **รูปภาพหลายรูป** (assets) ที่เชื่อมโยงอยู่

## โครงสร้างฐานข้อมูล

### ตาราง subcategories

```sql
subcategories (
  id UUID PRIMARY KEY,
  sku_id TEXT REFERENCES skus(id),           -- เช่น "daytona"
  group_key TEXT REFERENCES part_groups(key), -- เช่น "bracelet"
  name TEXT NOT NULL,                         -- เช่น "สายเหล็ก"
  image_url TEXT,                             -- รูปแสดงใน index
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE (sku_id, group_key, name)            -- ห้ามซ้ำ
)
```

### ตาราง assets (เชื่อมกับ subcategory)

```sql
assets (
  id UUID PRIMARY KEY,
  sku_id TEXT REFERENCES skus(id),
  group_key TEXT REFERENCES part_groups(key),
  subcategory_id UUID REFERENCES subcategories(id), -- เชื่อมกับ subcategory
  label TEXT,
  url TEXT NOT NULL,
  sort INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
)
```

## ข้อมูลตัวอย่างที่สร้างแล้ว

### SKU: Daytona

| Part Group | Subcategory | มีรูปแทน |
|------------|-------------|----------|
| สายนาฬิกา (bracelet) | สายเหล็ก | - |
| สายนาฬิกา (bracelet) | สายหนัง | - |
| สายนาฬิกา (bracelet) | สายยาง | - |
| หน้าปัด (dial) | หน้าปัดสีดำ | - |
| หน้าปัด (dial) | หน้าปัดสีขาว | - |
| หน้าปัด (dial) | หน้าปัดสีน้ำเงิน | - |
| เข็ม (hands) | เข็มสีเงิน | - |
| เข็ม (hands) | เข็มสีทอง | - |

### SKU: Submarine

| Part Group | Subcategory | มีรูปแทน |
|------------|-------------|----------|
| สายนาฬิกา (bracelet) | สายเหล็ก | - |
| สายนาฬิกา (bracelet) | สายหนัง | - |
| หน้าปัด (dial) | หน้าปัดสีดำ | - |
| หน้าปัด (dial) | หน้าปัดสีเขียว | - |
| เข็ม (hands) | เข็มสีเงิน | - |
| เข็ม (hands) | เข็มสีทอง | - |

## วิธีใช้งาน

### 1. ดู Subcategories ทั้งหมดของ SKU

```sql
SELECT 
  s.name as sku,
  pg.name_th as part_group,
  sc.id,
  sc.name as subcategory,
  sc.image_url,
  sc.sort_order
FROM subcategories sc
JOIN skus s ON sc.sku_id = s.id
JOIN part_groups pg ON sc.group_key = pg.key
WHERE s.id = 'daytona'
ORDER BY pg.sort_order, sc.sort_order;
```

### 2. ดู Subcategories ของ Part Group เฉพาะ

```sql
-- ตัวอย่าง: ดู subcategories ของ bracelet ใน daytona
SELECT id, name, image_url, sort_order
FROM subcategories
WHERE sku_id = 'daytona' AND group_key = 'bracelet'
ORDER BY sort_order;
```

### 3. สร้าง Subcategory ใหม่

```sql
INSERT INTO subcategories (sku_id, group_key, name, image_url, sort_order)
VALUES (
  'daytona',
  'bracelet',
  'สายผ้า',
  'https://your-storage-url/subcategory-images/bracelet-fabric.png',
  4
);
```

### 4. อัพเดทรูปภาพของ Subcategory

```sql
UPDATE subcategories
SET image_url = 'https://your-storage-url/subcategory-images/bracelet-steel.png'
WHERE sku_id = 'daytona' 
  AND group_key = 'bracelet' 
  AND name = 'สายเหล็ก';
```

### 5. เพิ่มรูปภาพเข้า Subcategory

```sql
-- ขั้นตอนที่ 1: หา subcategory_id
SELECT id FROM subcategories 
WHERE sku_id = 'daytona' 
  AND group_key = 'bracelet' 
  AND name = 'สายเหล็ก';

-- ขั้นตอนที่ 2: เพิ่มรูป (ใช้ id จากข้างบน)
INSERT INTO assets (sku_id, group_key, subcategory_id, label, url, sort)
VALUES (
  'daytona',
  'bracelet',
  'YOUR_SUBCATEGORY_UUID_HERE',
  'สายเหล็กแบบที่ 1',
  'https://your-storage-url/assets/bracelet-steel-1.png',
  1
);
```

### 6. ดูรูปภาพทั้งหมดของ Subcategory

```sql
-- ใช้ View ที่สร้างไว้
SELECT * FROM assets_with_subcategory
WHERE sku_id = 'daytona' 
  AND group_key = 'bracelet'
  AND subcategory_name = 'สายเหล็ก'
ORDER BY sort;
```

### 7. สรุปจำนวน Subcategories แต่ละ Part Group

```sql
SELECT 
  s.name as sku,
  pg.name_th as part_group,
  COUNT(sc.id) as subcategory_count
FROM part_groups pg
CROSS JOIN skus s
LEFT JOIN subcategories sc 
  ON sc.sku_id = s.id AND sc.group_key = pg.key
GROUP BY s.name, pg.name_th, pg.sort_order
ORDER BY s.name, pg.sort_order;
```

### 8. หา Subcategories ที่ยังไม่มีรูปแทน

```sql
SELECT 
  s.name as sku,
  pg.name_th as part_group,
  sc.name as subcategory
FROM subcategories sc
JOIN skus s ON sc.sku_id = s.id
JOIN part_groups pg ON sc.group_key = pg.key
WHERE sc.image_url IS NULL
ORDER BY s.name, pg.sort_order, sc.sort_order;
```

### 9. หา Subcategories ที่ยังไม่มีรูปภาพ assets

```sql
SELECT 
  s.name as sku,
  pg.name_th as part_group,
  sc.name as subcategory,
  COUNT(a.id) as asset_count
FROM subcategories sc
JOIN skus s ON sc.sku_id = s.id
JOIN part_groups pg ON sc.group_key = pg.key
LEFT JOIN assets a ON a.subcategory_id = sc.id
GROUP BY s.name, pg.name_th, sc.name, pg.sort_order, sc.sort_order
HAVING COUNT(a.id) = 0
ORDER BY s.name, pg.sort_order, sc.sort_order;
```

## การใช้งานใน Frontend

### ใน index.html - แสดงรายการ Subcategories

```javascript
// โหลด subcategories เมื่อเลือก SKU และ Part Group
async function loadSubcategories(skuId, groupKey) {
  const { data, error } = await supabase
    .from('subcategories')
    .select(`
      id,
      name,
      image_url,
      sort_order
    `)
    .eq('sku_id', skuId)
    .eq('group_key', groupKey)
    .order('sort_order');
  
  if (error) {
    console.error('Error loading subcategories:', error);
    return [];
  }
  
  return data;
}

// แสดงเป็นบรรทัดละ subcategory พร้อมรูปภาพ
function renderSubcategoryList(subcategories) {
  const container = document.getElementById('subcategory-list');
  
  const html = subcategories.map(sc => `
    <div class="subcategory-item" data-id="${sc.id}">
      ${sc.image_url ? 
        `<img src="${sc.image_url}" alt="${sc.name}" class="subcategory-image" />` 
        : ''}
      <span class="subcategory-name">${sc.name}</span>
    </div>
  `).join('');
  
  container.innerHTML = html;
}

// เมื่อคลิกเลือก subcategory โหลดรูปภาพ assets
document.addEventListener('click', async (e) => {
  const item = e.target.closest('.subcategory-item');
  if (!item) return;
  
  const subcategoryId = item.dataset.id;
  await loadAssetsForSubcategory(subcategoryId);
});

async function loadAssetsForSubcategory(subcategoryId) {
  const { data, error } = await supabase
    .from('assets')
    .select('*')
    .eq('subcategory_id', subcategoryId)
    .order('sort');
  
  if (error) {
    console.error('Error loading assets:', error);
    return;
  }
  
  // แสดงรูปภาพในส่วนเลือกชิ้นส่วน
  renderAssetThumbnails(data);
}
```

### ใน admin.html - จัดการ Subcategories

```javascript
// สร้าง Subcategory ใหม่
async function createSubcategory(skuId, groupKey, name, imageFile) {
  // 1. อัพโหลดรูปภาพก่อน (ถ้ามี)
  let imageUrl = null;
  if (imageFile) {
    const fileName = `subcategory-${skuId}-${groupKey}-${Date.now()}.png`;
    const { data: uploadData, error: uploadError } = await supabase
      .storage
      .from('watch-assets')
      .upload(`subcategory-images/${fileName}`, imageFile);
    
    if (uploadError) {
      console.error('Upload error:', uploadError);
      return;
    }
    
    imageUrl = supabase.storage
      .from('watch-assets')
      .getPublicUrl(`subcategory-images/${fileName}`).data.publicUrl;
  }
  
  // 2. สร้าง subcategory
  const { data, error } = await supabase
    .from('subcategories')
    .insert({
      sku_id: skuId,
      group_key: groupKey,
      name: name,
      image_url: imageUrl,
      sort_order: 999 // จะ update ทีหลัง
    })
    .select()
    .single();
  
  if (error) {
    console.error('Error creating subcategory:', error);
    return;
  }
  
  console.log('Subcategory created:', data);
  return data;
}

// อัพโหลดรูปภาพเข้า Subcategory
async function uploadAssetToSubcategory(subcategoryId, imageFile, label) {
  // 1. ดึงข้อมูล subcategory
  const { data: sc, error: scError } = await supabase
    .from('subcategories')
    .select('sku_id, group_key')
    .eq('id', subcategoryId)
    .single();
  
  if (scError) {
    console.error('Error fetching subcategory:', scError);
    return;
  }
  
  // 2. อัพโหลดไฟล์
  const fileName = `${sc.sku_id}/${sc.group_key}/${Date.now()}-${imageFile.name}`;
  const { data: uploadData, error: uploadError } = await supabase
    .storage
    .from('watch-assets')
    .upload(fileName, imageFile);
  
  if (uploadError) {
    console.error('Upload error:', uploadError);
    return;
  }
  
  const url = supabase.storage
    .from('watch-assets')
    .getPublicUrl(fileName).data.publicUrl;
  
  // 3. บันทึกลง assets
  const { data: asset, error: assetError } = await supabase
    .from('assets')
    .insert({
      sku_id: sc.sku_id,
      group_key: sc.group_key,
      subcategory_id: subcategoryId,
      label: label || 'New Asset',
      url: url,
      sort: 999
    })
    .select()
    .single();
  
  if (assetError) {
    console.error('Error creating asset:', assetError);
    return;
  }
  
  console.log('Asset uploaded:', asset);
  return asset;
}
```

## UI Flow สำหรับหน้า index.html

### ขั้นตอนที่ผู้ใช้จะเห็น:

1. **เลือก SKU** (เช่น Daytona)
   
2. **เลือก Part Group** (เช่น สายนาฬิกา)
   
3. **แสดงรายการ Subcategories เป็นบรรทัด:**
   ```
   🖼️ สายเหล็ก
   🖼️ สายหนัง
   🖼️ สายยาง
   ```

4. **คลิกเลือก Subcategory** (เช่น สายเหล็ก)
   
5. **แสดงรูปภาพทั้งหมดใน Subcategory นั้น:**
   ```
   [รูปที่ 1] [รูปที่ 2] [รูปที่ 3]
   ```

6. **เลือกรูปเพื่อประกอบนาฬิกา**

## ตัวอย่าง CSS สำหรับแสดง Subcategories

```css
.subcategory-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
}

.subcategory-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.subcategory-item:hover {
  border-color: #bfa888;
  background: #f9fafb;
}

.subcategory-item.active {
  border-color: #bfa888;
  background: #fef3e2;
}

.subcategory-image {
  width: 60px;
  height: 60px;
  object-fit: cover;
  border-radius: 4px;
}

.subcategory-name {
  font-size: 16px;
  font-weight: 500;
  color: #1f2937;
}
```

## ขั้นตอนถัดไป

### สำหรับแต่ละ SKU ที่มี:

1. ✅ สร้าง Subcategories สำหรับแต่ละ Part Group
2. 🔲 อัพโหลดรูปแทนแต่ละ Subcategory (`image_url`)
3. 🔲 อัพโหลดรูปภาพ assets เข้าแต่ละ Subcategory
4. 🔲 แก้ไข `index.html` ให้แสดง Subcategories เป็นบรรทัด
5. 🔲 แก้ไข `admin.html` ให้มีฟังก์ชันจัดการ Subcategories

---

ตอนนี้โครงสร้างพร้อมแล้วครับ! Subcategories สามารถแยกประเภทย่อยของแต่ละ Part Group ได้ถูกต้อง 🎉

