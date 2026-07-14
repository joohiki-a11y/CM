// ===================================================================
// การตั้งค่า (Config)
// ===================================================================
// 1. เปิด Google Sheet ของคุณ -> Extensions -> Apps Script
// 2. วางโค้ดจากไฟล์ apps-script/Code.gs แล้ว Deploy เป็น Web App
// 3. คัดลอก URL ที่ได้ (ลงท้ายด้วย /exec) มาวางแทนค่าด้านล่างนี้
// ===================================================================

window.APP_CONFIG = {
  // URL ของ Google Apps Script Web App (ลงท้ายด้วย /exec)
  API_URL: "https://script.google.com/a/macros/bitkub.com/s/AKfycbw2flw9hJBEhkeDltoUzQdDNehHye5cosHL95nr8cKd4w3teNqA_0Qx_xed1azyqWls/exec",

  // ชื่อสตูดิโอ (แสดงบนหัวเว็บ)
  STUDIO_NAME: "บอร์ดอุปกรณ์สตูดิโอ",

  // คอลัมน์สถานะบนบอร์ด (เรียงซ้าย -> ขวา ตามลำดับใน array นี้)
  STATUSES: [
    { key: "usable",  label: "ใช้งานได้",       color: "#16a34a" },
    { key: "partial", label: "เสียหายบางส่วน", color: "#d97706" },
    { key: "repair",  label: "ส่งซ่อม",         color: "#2563eb" },
    { key: "broken",  label: "เสียถาวร",        color: "#dc2626" },
  ],
};
