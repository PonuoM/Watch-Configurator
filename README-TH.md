# Watch Configurator - คู่มือการใช้งาน

## ปัญหาที่แก้ไขแล้ว

### 1. การ Save ข้อมูลผ่านหน้า Admin ไม่ได้

**สาเหตุ:** 
- ไฟล์ `supabase.config.js` มี syntax error (ขาด semicolon และ quote)
- Database policies สำหรับ anonymous users ถูก comment out

**วิธีแก้ไข:**
1. แก้ไข `supabase.config.js` ให้มี syntax ถูกต้อง
2. เปิดใช้งาน anonymous write policies ใน `supabase.schema.sql`

### 2. การตั้งค่า Supabase

**ขั้นตอนที่ 1: สร้าง Database Schema**
1. เปิด Supabase Dashboard
2. ไปที่ SQL Editor
3. Copy โค้ดจากไฟล์ `supabase.schema.sql` 
4. Run โค้ดเพื่อสร้าง tables และ policies

**ขั้นตอนที่ 2: สร้าง Storage Bucket**
1. ไปที่ Storage ใน Supabase Dashboard
2. สร้าง bucket ชื่อ `watch-assets`
3. ตั้งค่าเป็น Public bucket

**ขั้นตอนที่ 3: ตรวจสอบการตั้งค่า**
- ไฟล์ `supabase.config.js` ต้องมี URL และ Key ที่ถูกต้อง
- Database ต้องมี policies สำหรับ anonymous users

## วิธีการใช้งาน

### การเพิ่ม SKU ใหม่
1. คลิกปุ่ม "Admin" ในหน้าเว็บ
2. กรอก SKU ID และ SKU Name
3. เลือกไฟล์รูปภาพสำหรับแต่ละส่วน (Dial, Hands, Second, Outer, Inner, Bracelet)
4. คลิก "Save SKU"
5. ระบบจะบันทึกลง Supabase และอัปเดต dropdown

### การ Export/Import ข้อมูล
- **Export:** คลิก "Export JSON" เพื่อดาวน์โหลดข้อมูลทั้งหมด
- **Import:** คลิก "Import JSON" เพื่อนำเข้าข้อมูลจากไฟล์

### การใช้งาน Configurator
1. เลือก SKU จาก dropdown
2. คลิกเลือกรูปภาพในแต่ละส่วน
3. ใช้ปุ่ม Random สำหรับการสุ่ม
4. ใช้ปุ่ม Reset เพื่อรีเซ็ต
5. คลิก "Download PNG" เพื่อบันทึกรูป

## ไฟล์สำคัญ

- `index.html` - หน้าเว็บหลัก
- `script.js` - JavaScript logic
- `supabase.config.js` - การตั้งค่า Supabase
- `supabase.schema.sql` - Database schema
- `styles.css` - CSS styles

## การแก้ไขปัญหาเพิ่มเติม

### หากยัง Save ไม่ได้
1. ตรวจสอบ Console ใน Browser (F12)
2. ตรวจสอบว่า Supabase URL และ Key ถูกต้อง
3. ตรวจสอบว่า Database policies ถูกต้อง
4. ตรวจสอบว่า Storage bucket สร้างแล้ว

### หากรูปภาพไม่แสดง
1. ตรวจสอบว่าไฟล์รูปภาพอยู่ในโฟลเดอร์ `assets/`
2. ตรวจสอบชื่อไฟล์ว่าตรงกับที่กำหนดในโค้ด
3. ตรวจสอบว่า Supabase Storage bucket ตั้งค่าเป็น Public

## หมายเหตุ

- ระบบจะพยายามบันทึกลง Supabase ก่อน หากไม่สำเร็จจะเก็บใน localStorage
- ข้อมูลใน localStorage จะหายไปเมื่อ clear browser data
- สำหรับ production ควรเพิ่ม authentication system