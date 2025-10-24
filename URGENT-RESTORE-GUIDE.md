# 🚨 คู่มือกู้คืนข้อมูล Assets ที่หายไป

## สาเหตุ

Migration ที่ชื่อ `fix_subcategories_for_part_groups` มีคำสั่ง:
```sql
TRUNCATE TABLE public.subcategories CASCADE;
```

คำสั่งนี้ลบข้อมูลใน `subcategories` และ `assets` ที่เชื่อมอยู่ด้วย **CASCADE DELETE**

## ข่าวดี 🎉

- ✅ **รูปภาพยังอยู่ใน Storage** (bucket: `watch-assets`)
- ✅ **โครงสร้าง database ยังสมบูรณ์**
- ✅ **สามารถกู้คืนได้!**

---

## วิธีกู้คืน (เลือก 1 วิธี)

### 🔵 วิธีที่ 1: Point-in-Time Recovery (PITR) - แนะนำมากที่สุด

ถ้า Supabase project คุณเปิดใช้งาน PITR:

1. เปิด [Supabase Dashboard](https://supabase.com/dashboard)
2. เลือก Project ของคุณ
3. ไปที่ **Database** → **Backups**
4. คลิก **Point in Time Recovery**
5. เลือกเวลา: **ก่อน 15:17 น. วันนี้ (23 Oct 2025)**
6. คลิก **Restore**
7. รอ 5-15 นาที
8. ✅ ข้อมูลกลับมาแล้ว!

**ข้อดี:**
- กู้คืนข้อมูลทั้งหมดได้ 100%
- ไม่ต้องทำอะไรเพิ่ม
- รวดเร็วที่สุด

**ข้อเสีย:**
- ต้องมี PITR enabled (Pro plan ขึ้นไป)

---

### 🟢 วิธีที่ 2: Rollback Migration แล้ว Re-upload

ถ้าไม่มี PITR:

#### ขั้นตอนที่ 1: Rollback Migrations ที่ทำผิด

รันคำสั่ง SQL นี้ใน **SQL Editor**:

```sql
-- 1. ลบ migrations ที่ทำผิด
DELETE FROM supabase_migrations.schema_migrations 
WHERE version IN ('20251023151706', '20251023152303');

-- 2. Drop และสร้าง subcategories ใหม่แบบถูกต้อง
DROP TABLE IF EXISTS public.subcategories CASCADE;

CREATE TABLE public.subcategories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id text NOT NULL REFERENCES public.skus(id) ON DELETE CASCADE,
  group_key text NOT NULL REFERENCES public.part_groups(key) ON DELETE CASCADE,
  name text NOT NULL,
  image_url text,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE (sku_id, group_key, name)
);

-- 3. Enable RLS
ALTER TABLE public.subcategories ENABLE ROW LEVEL SECURITY;

-- 4. สร้าง policies
CREATE POLICY subcategories_select_public ON public.subcategories FOR SELECT USING (true);
CREATE POLICY subcategories_write_anon ON public.subcategories FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY subcategories_write_auth ON public.subcategories FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5. สร้าง indexes
CREATE INDEX idx_subcategories_sku_group ON public.subcategories (sku_id, group_key, sort_order);

-- 6. เพิ่ม subcategory_id กลับไปที่ assets (ถ้ายังไม่มี)
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS subcategory_id uuid REFERENCES public.subcategories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_assets_subcategory_id ON public.assets(subcategory_id);

-- 7. สร้าง View
CREATE OR REPLACE VIEW public.assets_with_subcategory AS
SELECT 
  a.id,
  a.sku_id,
  s.name as sku_name,
  a.group_key,
  pg.name_th as group_name_th,
  pg.name_en as group_name_en,
  pg.z_index,
  a.subcategory_id,
  sc.name as subcategory_name,
  sc.image_url as subcategory_image_url,
  sc.sort_order as subcategory_sort,
  a.label,
  a.url,
  a.sort,
  a.created_at
FROM public.assets a
LEFT JOIN public.skus s ON a.sku_id = s.id
LEFT JOIN public.part_groups pg ON a.group_key = pg.key
LEFT JOIN public.subcategories sc ON a.subcategory_id = sc.id;

GRANT SELECT ON public.assets_with_subcategory TO anon, authenticated;
```

#### ขั้นตอนที่ 2: Re-upload รูปภาพ

เนื่องจากรูปยังอยู่ใน Storage แต่ข้อมูลใน database หาย คุณต้อง:

1. ไปที่ **admin.html**
2. เลือก SKU (เช่น Daytona)
3. สำหรับแต่ละ Part Group:
   - อัพโหลดรูปภาพใหม่
   - ระบบจะ upload ไปที่ Storage (อาจทับรูปเดิม)
   - บันทึกข้อมูลลง database

**หรือใช้ Script อัตโนมัติ:**

ถ้ารูปอยู่ในโฟลเดอร์ `2/SKU2/`, `2/SKU3/` ผมจะสร้าง script ให้อัพโหลดอัตโนมัติ

---

### 🟡 วิธีที่ 3: ดึงรายการไฟล์จาก Storage แล้วสร้าง Assets ใหม่

ถ้ารูปยังอยู่ใน Storage และมี pattern ที่ชัดเจน:

```javascript
// รัน script นี้ใน browser console ที่หน้า admin.html

async function rebuildAssetsFromStorage() {
  const client = supabase;
  
  // 1. ดึงรายการไฟล์ทั้งหมดจาก Storage
  const { data: files, error } = await client.storage
    .from('watch-assets')
    .list('', {
      limit: 1000,
      sortBy: { column: 'name', order: 'asc' }
    });
  
  if (error) {
    console.error('Error listing files:', error);
    return;
  }
  
  console.log('Found', files.length, 'files');
  
  // 2. สร้าง assets จากไฟล์
  for (const file of files) {
    // Parse filename to get SKU, group_key, etc.
    // Format: {sku}/{group_key}/{filename}
    const parts = file.name.split('/');
    if (parts.length < 3) continue;
    
    const [sku, groupKey, filename] = parts;
    const url = client.storage
      .from('watch-assets')
      .getPublicUrl(file.name).data.publicUrl;
    
    // Insert into assets
    const { data, error: insertError } = await client
      .from('assets')
      .insert({
        sku_id: sku,
        group_key: groupKey,
        label: filename.replace(/\.[^/.]+$/, ''), // remove extension
        url: url,
        sort: 1
      });
    
    if (insertError) {
      console.error('Error inserting asset:', insertError);
    } else {
      console.log('Restored:', file.name);
    }
  }
  
  console.log('Done!');
}

// รัน
await rebuildAssetsFromStorage();
```

---

## เลือกวิธีไหนดี?

| วิธี | ระยะเวลา | ความยาก | แนะนำ |
|------|----------|---------|-------|
| 1. PITR | 5-15 นาที | ⭐ ง่ายมาก | ✅ ดีที่สุด |
| 2. Rollback + Re-upload | 30-60 นาที | ⭐⭐ ปานกลาง | ถ้าไม่มี PITR |
| 3. Rebuild from Storage | 10-20 นาที | ⭐⭐⭐ ยาก | ถ้าไฟล์มี pattern ชัดเจน |

---

## ป้องกันไม่ให้เกิดอีก

### 1. สร้าง Backup ก่อน Migration

```sql
-- สร้าง backup table ก่อนทำ migration
CREATE TABLE assets_backup AS SELECT * FROM assets;
CREATE TABLE subcategories_backup AS SELECT * FROM subcategories;
```

### 2. ใช้ Transaction

```sql
BEGIN;
-- migration commands here
-- ถ้าผิดพลาด สามารถ ROLLBACK ได้
COMMIT; -- หรือ ROLLBACK;
```

### 3. Test ใน Development Branch ก่อน

- ใช้ Supabase Branching
- Test migration ใน dev branch
- ถ้าไม่มีปัญหาค่อย merge ไป production

---

## ติดต่อผม

ถ้าต้องการความช่วยเหลือในการกู้คืน กรุณาแจ้งให้ผมทราบว่า:
1. มี PITR ไหม? (ดูที่ Dashboard → Database → Backups)
2. รูปภาพอยู่ที่ไหนใน Storage? (folder structure)
3. มีข้อมูล backup อื่นๆ ไหม?

ขออภัยในความผิดพลาดครั้งนี้ครับ 🙏

