/* ==================================================================
   บอร์ดอุปกรณ์สตูดิโอ — Google Apps Script Backend (API)
   ------------------------------------------------------------------
   ออกแบบให้ทำงานกับชีตที่มีคอลัมน์ (ตามหัวตาราง ไม่ยึดตำแหน่ง):

     Category | No. | Equipment | S/N | Good | Need Repair | Broke | Total | Note

   - 1 แถว = อุปกรณ์ 1 รายการ (มีได้หลายชิ้น) โดยจำนวนกระจายอยู่ในคอลัมน์สถานะ
   - Total = ผลรวมของคอลัมน์สถานะ (คำนวณให้อัตโนมัติ)
   - สคริปต์จะเพิ่มคอลัมน์ "_id" ที่ท้ายตารางให้เอง เพื่อใช้อ้างอิงแถว
     (ไม่กระทบคอลัมน์เดิมของคุณ)

   ➕ อยากได้ 4 สถานะ? เพิ่มคอลัมน์หัวชื่อ "Partial" ในชีต แล้วเพิ่มบรรทัด
      { key: "partial", ... } ใน STATUS_DEFS ด้านล่าง — สคริปต์จะรองรับทันที

   วิธี Deploy: Extensions -> Apps Script -> วางโค้ดนี้ -> Deploy ->
   New deployment -> Web app (Execute as: Me, Who has access: Anyone)
   ================================================================== */

// ID ของ Google Sheet ที่จะเก็บข้อมูล
// ("" = ใช้ไฟล์ที่สคริปต์ผูกอยู่ / getActiveSpreadsheet)
var SPREADSHEET_ID = "1C6JZVd5AWecDANey8yPxxlx91aRPOtNsHIB6sZIS2-I";

// ตั้งชื่อแท็บที่เก็บข้อมูล ("" = ใช้แท็บแรกของไฟล์)
var SHEET_NAME = "";

// นิยามคอลัมน์สถานะ: key (ใช้ในเว็บ) -> ชื่อหัวตารางในชีต (อันไหนที่ชีตไม่มี จะข้ามให้)
var STATUS_DEFS = [
  { key: "good",    header: "Good" },
  // { key: "partial", header: "Partial" },   // <- เปิดใช้ถ้าอยากได้ 4 สถานะ
  { key: "repair",  header: "Need Repair" },
  { key: "broke",   header: "Broke" },
];

// ชื่อหัวตารางที่ยอมรับได้สำหรับแต่ละฟิลด์ (normalize แล้ว)
var FIELD_ALIASES = {
  category:  ["category", "หมวดหมู่"],
  no:        ["no", "ลำดับ"],
  equipment: ["equipment", "ชื่ออุปกรณ์", "อุปกรณ์", "name"],
  sn:        ["s/n", "sn", "serial", "serial number"],
  total:     ["total", "รวม"],
  note:      ["note", "หมายเหตุ", "remark"],
  id:        ["_id", "id"],
};

// ================================================================
function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || "list";
    if (action === "list") return json({ ok: true, items: readAll() });
    return json({ ok: false, error: "unknown action: " + action });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    var a = body.action;
    if (a === "add")          return json({ ok: true, item: addRow(body.row, body.status, body.count) });
    if (a === "setCounts")    return json({ ok: true, item: setCounts(body.id, body.counts) });
    if (a === "updateFields") return json({ ok: true, item: updateFields(body.id, body.fields) });
    if (a === "deleteRow")    return json({ ok: true, id: deleteRow(body.id) });
    return json({ ok: false, error: "unknown action: " + a });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

// ================================================================
// การหาแท็บ + แผนที่คอลัมน์
// ================================================================
function getSheet() {
  var ss = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  var sh = SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : null;
  if (!sh) sh = ss.getSheets()[0];
  return sh;
}

function normalize(h) {
  return String(h == null ? "" : h).trim().toLowerCase().replace(/[.\s]+/g, " ").trim();
}

// คืน object รายละเอียดคอลัมน์ (index เป็นแบบ 1-based, -1 = ไม่มี)
function resolveCols(sh) {
  var lastCol = Math.max(1, sh.getLastColumn());
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(normalize);

  function find(aliases) {
    for (var i = 0; i < headers.length; i++) {
      if (aliases.indexOf(headers[i]) !== -1) return i + 1;
    }
    return -1;
  }

  var cols = {};
  for (var f in FIELD_ALIASES) cols[f] = find(FIELD_ALIASES[f]);

  // คอลัมน์สถานะที่มีจริงในชีต
  cols.statuses = [];
  for (var i = 0; i < STATUS_DEFS.length; i++) {
    var c = find([normalize(STATUS_DEFS[i].header)]);
    if (c > 0) cols.statuses.push({ key: STATUS_DEFS[i].key, col: c });
  }

  // สร้างคอลัมน์ _id ถ้ายังไม่มี
  if (cols.id < 0) {
    var newCol = sh.getLastColumn() + 1;
    sh.getRange(1, newCol).setValue("_id");
    cols.id = newCol;
  }
  cols.lastCol = sh.getLastColumn();
  return cols;
}

// ================================================================
// อ่านทั้งหมด (พร้อม backfill _id ให้แถวที่ยังไม่มี)
// ================================================================
function readAll() {
  var sh = getSheet();
  var cols = resolveCols(sh);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  var width = sh.getLastColumn();
  var range = sh.getRange(2, 1, lastRow - 1, width);
  var values = range.getValues();

  var idColArr = [];
  var needWrite = false;
  var out = [];

  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var equipment = cols.equipment > 0 ? row[cols.equipment - 1] : "";
    var hasContent = String(equipment).trim() !== "" || rowHasStatusCount(row, cols);

    var id = cols.id > 0 ? String(row[cols.id - 1] || "").trim() : "";
    if (hasContent && !id) {
      id = "eq_" + Date.now() + "_" + r + "_" + Math.floor(Math.random() * 1000);
      needWrite = true;
    }
    idColArr.push([id]);

    if (!hasContent) continue;

    var counts = {};
    for (var s = 0; s < cols.statuses.length; s++) {
      var st = cols.statuses[s];
      counts[st.key] = toInt(row[st.col - 1]);
    }
    out.push({
      id: id,
      category: cols.category > 0 ? row[cols.category - 1] : "",
      no: cols.no > 0 ? row[cols.no - 1] : "",
      equipment: equipment,
      sn: cols.sn > 0 ? row[cols.sn - 1] : "",
      note: cols.note > 0 ? row[cols.note - 1] : "",
      counts: counts,
    });
  }

  if (needWrite) sh.getRange(2, cols.id, idColArr.length, 1).setValues(idColArr);
  return out;
}

function rowHasStatusCount(row, cols) {
  for (var s = 0; s < cols.statuses.length; s++) {
    if (toInt(row[cols.statuses[s].col - 1]) > 0) return true;
  }
  return false;
}

// ================================================================
// เพิ่มแถวใหม่
// ================================================================
function addRow(rowData, status, count) {
  var sh = getSheet();
  var cols = resolveCols(sh);
  var n = Math.max(1, parseInt(count, 10) || 1);
  var width = sh.getLastColumn();
  var arr = new Array(width).fill("");

  if (cols.category > 0)  arr[cols.category - 1]  = rowData.category || "";
  if (cols.equipment > 0) arr[cols.equipment - 1] = rowData.equipment || "";
  if (cols.sn > 0)        arr[cols.sn - 1]        = rowData.sn || "";
  if (cols.note > 0)      arr[cols.note - 1]      = rowData.note || "";
  if (cols.no > 0)        arr[cols.no - 1]        = nextNo(sh, cols);
  if (cols.id > 0)        arr[cols.id - 1]        = "eq_" + Date.now() + "_" + Math.floor(Math.random() * 1000);

  var total = 0;
  for (var s = 0; s < cols.statuses.length; s++) {
    var st = cols.statuses[s];
    var v = st.key === status ? n : 0;
    arr[st.col - 1] = v;
    total += v;
  }
  if (cols.total > 0) arr[cols.total - 1] = total;

  sh.getRange(sh.getLastRow() + 1, 1, 1, width).setValues([arr]);
  return { id: arr[cols.id - 1] };
}

function nextNo(sh, cols) {
  if (cols.no < 0) return "";
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return 1;
  var vals = sh.getRange(2, cols.no, lastRow - 1, 1).getValues();
  var max = 0;
  for (var i = 0; i < vals.length; i++) {
    var v = parseInt(vals[i][0], 10);
    if (!isNaN(v) && v > max) max = v;
  }
  return max + 1;
}

// ================================================================
// ปรับจำนวนตามสถานะ (ใช้กับการย้าย/ลบชิ้น)
// ================================================================
function setCounts(id, counts) {
  var sh = getSheet();
  var cols = resolveCols(sh);
  var rowNum = findRow(sh, cols, id);
  if (rowNum < 0) throw new Error("ไม่พบรายการ id: " + id);

  var total = 0;
  for (var s = 0; s < cols.statuses.length; s++) {
    var st = cols.statuses[s];
    var v = Math.max(0, toInt(counts[st.key]));
    sh.getRange(rowNum, st.col).setValue(v);
    total += v;
  }
  if (cols.total > 0) sh.getRange(rowNum, cols.total).setValue(total);
  return { id: id, total: total };
}

// ================================================================
// แก้ไขข้อมูลรายการ (Category / Equipment / S/N / Note)
// ================================================================
function updateFields(id, fields) {
  var sh = getSheet();
  var cols = resolveCols(sh);
  var rowNum = findRow(sh, cols, id);
  if (rowNum < 0) throw new Error("ไม่พบรายการ id: " + id);

  if (fields.category !== undefined && cols.category > 0)  sh.getRange(rowNum, cols.category).setValue(fields.category);
  if (fields.equipment !== undefined && cols.equipment > 0) sh.getRange(rowNum, cols.equipment).setValue(fields.equipment);
  if (fields.sn !== undefined && cols.sn > 0)              sh.getRange(rowNum, cols.sn).setValue(fields.sn);
  if (fields.note !== undefined && cols.note > 0)          sh.getRange(rowNum, cols.note).setValue(fields.note);
  return { id: id };
}

function deleteRow(id) {
  var sh = getSheet();
  var cols = resolveCols(sh);
  var rowNum = findRow(sh, cols, id);
  if (rowNum < 0) throw new Error("ไม่พบรายการ id: " + id);
  sh.deleteRow(rowNum);
  return id;
}

// ================================================================
function findRow(sh, cols, id) {
  var lastRow = sh.getLastRow();
  if (lastRow < 2 || cols.id < 0) return -1;
  var ids = sh.getRange(2, cols.id, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function toInt(v) {
  var n = parseInt(v, 10);
  return isNaN(n) ? 0 : n;
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
