# Bitkub Studio Equipment

เวอร์ชัน Apps Script ปัจจุบันจากไฟล์ที่ส่งวันที่ 21 ตุลาคม 2026 อยู่ใน [apps-script/](apps-script/)

| ไฟล์ | หน้าที่ |
|---|---|
| [apps-script/code.gs](apps-script/code.gs) | Backend, EquipmentUnits, Productions และ Checklist |
| [apps-script/index.html](apps-script/index.html) | หน้าเว็บ Apps Script HTML Service |
| [apps-script/style.html](apps-script/style.html) | CSS partial |
| [apps-script/app.html](apps-script/app.html) | หน้าเว็บและการเรียก google.script.run |

**ยังไม่พร้อมใช้ยืนยันยอดย้ายสตูดิโอจริง:** พบปัญหาข้อมูลและการบันทึกที่ต้องแก้ก่อน อ่าน [ผลรีวิวพร้อมจุดอ้างอิง](docs/code-review-2026-10-21.md) และ [ขอบเขตงานย้าย](docs/studio-move-scope.md)

โค้ดทั้งสี่เป็น baseline ที่แปลงจาก RTF ยังไม่ได้แก้พฤติกรรม อ่าน [บันทึกการนำเข้า](docs/import-notes.md)

## การตรวจสอบในเครื่อง

ใช้ Node.js 20 ขึ้นไป ไม่ต้องติดตั้ง dependencies:

```bash
npm run check
npm run test:readiness
```

- check ตรวจ syntax / DOM IDs / includes / API names
- test:readiness ใช้ข้อมูลจำลองและคาดหวังพฤติกรรมที่ปลอดภัย **baseline นี้ยังไม่ผ่าน 7 กรณี** รายละเอียดอยู่ในผลรีวิว ต้องแก้จนผ่านก่อนนำไปตรวจรับจริง
- ไม่มีเทสต์ใดเชื่อมข้อมูล Google Sheet จริง

## การใช้งานเวอร์ชันปัจจุบัน

ไฟล์ใน apps-script ใช้วางใน Apps Script HTML Service; index เรียก include('style') และ include('app') จึงต้องใช้ทั้งสี่ไฟล์ด้วยกัน ไม่สามารถเปิด index นี้ผ่าน GitHub Pages โดยตรง

ก่อนทดสอบให้คัดลอก Google Sheet และ Apps Script ไปชุดทดลอง แก้ SPREADSHEET_ID ในชุดทดลองให้ชี้ข้อมูลสำเนา ตรวจ deployment access และสำรองข้อมูลก่อนเรียก setupSystem หรือ refresh; สองคำสั่งนี้อาจเขียนข้อมูลจาก master ไม่ได้อ่านอย่างเดียว

ยังไม่มี manifest / trigger configuration / Script ID จากเจ้าของระบบ จึงไม่มีการสร้างค่าพวกนี้แทน การ push เข้า GitHub ไม่ได้อัปเดต Apps Script ที่ใช้งานจริง

## โค้ดรุ่นก่อนหน้า

ไฟล์ที่ root เป็นรุ่นเก่าซึ่งแยก frontend กับ API และเก็บไว้เพื่ออ้างอิง ประวัติการติดตั้งเดิมอยู่ใน [docs/legacy-readme.md](docs/legacy-readme.md) ไม่ใช่คู่มือติดตั้งรุ่นปัจจุบัน อย่านำ backend รุ่นเก่าและรุ่นปัจจุบันไปรวมใน Apps Script project เดียวกันเพราะมีชื่อฟังก์ชันซ้ำ

