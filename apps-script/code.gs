/* ==================================================================
Studio Equipment Board — Unit-level inventory (Phase 1)
Master sheet (existing):
Category | No. | Equipment | S/N | Good | Need Repair | Broke | Total | Note
New sheet created automatically: EquipmentUnits
One row in EquipmentUnits = one physical unit with a stable Unit ID.
================================================================== */
var SPREADSHEET_ID = "1C6JZVd5AWecDANey8yPxxlx91aRPOtNsHIB6sZIS2-I";
var SHEET_NAME = ""; // blank = first sheet that is not a system sheet
var UNITS_SHEET_NAME = "EquipmentUnits";
var PRODUCTIONS_SHEET_NAME = "Productions";
var CHECKLIST_SHEET_NAME = "ProductionChecklist";
var FAVORITES_SHEET_NAME = "EquipmentFavorites";
var MIGRATION_PROPERTY = "EQUIPMENT_UNITS_MIGRATION_V1";
var STATUS_DEFS = [
{ key: "good", header: "Good" },
{ key: "partial", header: "Partial" },
{ key: "repair", header: "Need Repair" },
{ key: "broke", header: "Broke" }
];
var FIELD_ALIASES = {
category: ["category", "หมวดหมู่"],
no: ["no", "ลำดับ"],
equipment: ["equipment", "ชื่ออุปกรณ์", "อุปกรณ์", "name"],
sn: ["s/n", "sn", "serial", "serial number"],
location: ["location", "ที่เก็บ", "storage location"],
total: ["total", "รวม"],
note: ["note", "หมายเหตุ", "remark"],
id: ["_id", "id"]
};
var UNIT_HEADERS = [
"Unit ID", "Equipment ID", "Category", "Equipment", "Serial Number",
"Status", "Location", "Note", "Active", "Created At", "Updated At"
];
var PRODUCTION_HEADERS = [
"Job ID", "Title", "Shoot Date", "Location", "Owner", "Note",
"Status", "Created At", "Updated At"
];
var CHECKLIST_HEADERS = [
"Checklist ID", "Job ID", "Unit ID", "Equipment ID", "Equipment", "Category",
"Serial Number", "Taken", "Returned", "Note", "Active", "Updated By", "Updated At", "Location"
];
var FAVORITE_HEADERS = ["Owner", "Equipment ID", "Active", "Updated At"];
function doGet(e) {
var template = HtmlService.createTemplateFromFile("index");
template.INITIAL_JOB_ID = (e && e.parameter && e.parameter.job) ? String(e.parameter.job) : "";
return template.evaluate()
.setTitle(getClientConfig().STUDIO_NAME)
.addMetaTag("viewport", "width=device-width, initial-scale=1");
}
function include(filename) {
return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
function getClientConfig() {
return {
STUDIO_NAME: "บอร์ดอุปกรณ์สตูดิโอ",
SHEET_URL: "https://docs.google.com/spreadsheets/d/" + SPREADSHEET_ID + "/edit",
STATUSES: [
{ key: "good", label: "ใช้งานได้", color: "#02d767" },
{ key: "partial", label: "เสียหายบางส่วน", color: "#a3ed24" },
{ key: "repair", label: "ส่งซ่อม", color: "#d6b900" },
{ key: "broke", label: "เสียถาวร", color: "#404040" }
]
};
}
// Run manually once if you want to inspect the migration summary in Execution log.
function setupSystem() {
var lock = LockService.getScriptLock();
lock.waitLock(30000);
try {
var master = getMasterSheet();
var cols = resolveMasterCols(master);
backfillMasterIds(master, cols);
var unitsSheet = getUnitsSheet(true);
getProductionsSheet(true);
getChecklistSheet(true);
getFavoritesSheet(true);
var result = migrateMasterCountsToUnits(master, cols, unitsSheet);
syncAllMasterCounts(master, cols, unitsSheet);
PropertiesService.getScriptProperties().setProperty(MIGRATION_PROPERTY, "done");
console.log(JSON.stringify(result));
return result;
} finally {
lock.releaseLock();
}
}
// Run manually when rows added directly in the master sheet do not appear on the web.
// This function never deletes units or checklist history.
function repairNewEquipmentRows() {
var lock = LockService.getScriptLock();
lock.waitLock(30000);
try {
var master = getMasterSheet();
var cols = resolveMasterCols(master);
var createdIds = backfillMasterIds(master, cols);
var unitsSheet = getUnitsSheet(true);
getProductionsSheet(true);
getChecklistSheet(true);
getFavoritesSheet(true);
var activeEquipmentIds = {};
readUnitTable(unitsSheet).records.forEach(function (record) {
if (record.active && record.equipmentId) activeEquipmentIds[record.equipmentId] = true;
});
var newIdMap = {};
createdIds.forEach(function (entry) { newIdMap[entry.id] = true; });
var repairedCounts = 0;
var countRepairs = [];
var skippedRows = [];
if (master.getLastRow() >= 2) {
var width = master.getLastColumn();
var values = master.getRange(2, 1, master.getLastRow() - 1, width).getValues();
values.forEach(function (row, index) {
var name = String(row[cols.equipment - 1] || "").trim();
var equipmentId = String(row[cols.id - 1] || "").trim();
if (!name || !equipmentId || activeEquipmentIds[equipmentId]) return;
var statusTotal = 0;
cols.statuses.forEach(function (status) { statusTotal += Math.max(0, toInt(row[status.col - 1])); });
if (statusTotal > 0) return;
var totalValue = cols.total > 0 ? Math.max(0, toInt(row[cols.total - 1])) : 0;
var serialCount = cols.sn > 0 ? splitSerials(row[cols.sn - 1]).length : 0;
var fallbackCount = Math.max(totalValue, serialCount, newIdMap[equipmentId] ? 1 : 0);
if (fallbackCount < 1) {
skippedRows.push(index + 2);
return;
}
countRepairs.push({ rowNum: index + 2, value: fallbackCount });
repairedCounts++;
});
countRepairs.forEach(function (repair) {
master.getRange(repair.rowNum, cols.statuses[0].col).setValue(repair.value);
});
}
var migration = migrateMasterCountsToUnits(master, cols, unitsSheet);
var affectedIds = createdIds.map(function (entry) { return entry.id; });
if (affectedIds.length) syncMasterCountsForIds(master, cols, unitsSheet, affectedIds);
PropertiesService.getScriptProperties().setProperty(MIGRATION_PROPERTY, "done");
var result = {
masterSheet: master.getName(),
idsCreated: createdIds.length,
rowsWithCountRepaired: repairedCounts,
unitsCreated: migration.createdUnits || 0,
skippedRowsWithoutQuantity: skippedRows
};
console.log(JSON.stringify(result));
return result;
} finally {
lock.releaseLock();
}
}
function ensureSystemReady() {
var ss = getSpreadsheet();
var unitsSheet = ss.getSheetByName(UNITS_SHEET_NAME);
var productionsSheet = ss.getSheetByName(PRODUCTIONS_SHEET_NAME);
var checklistSheet = ss.getSheetByName(CHECKLIST_SHEET_NAME);
var favoritesSheet = ss.getSheetByName(FAVORITES_SHEET_NAME);
var migrated = PropertiesService.getScriptProperties().getProperty(MIGRATION_PROPERTY);
if (!unitsSheet || !productionsSheet || !checklistSheet || !favoritesSheet || migrated !== "done") setupSystem();
}
// ------------------------------------------------------------------
// Public server methods called by app.html via google.script.run
// ------------------------------------------------------------------
function listItems() {
ensureSystemReady();
return readActiveUnits();
}
// Used by the Refresh button. A sync failure must not make the whole app unusable.
function refreshItemsFromMaster() {
ensureSystemReady();
var syncWarning = "";
try {
syncSheetChangesToUnits(5000);
} catch (err) {
syncWarning = err && err.message ? err.message : String(err);
console.warn("Master sheet sync skipped: " + syncWarning);
}
return { items: readActiveUnits(), syncWarning: syncWarning };
}
function addItem(item, status, count) {
ensureSystemReady();
item = item || {};
status = status || item.status;
if (!item.name) throw new Error("กรุณาระบุชื่ออุปกรณ์");
if (!isKnownStatus(status)) throw new Error("สถานะไม่ถูกต้อง");
var n = Math.max(1, parseInt(count, 10) || 1);
var lock = LockService.getScriptLock();
lock.waitLock(30000);
try {
var master = getMasterSheet();
var cols = resolveMasterCols(master);
var equipmentId = "eq_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
appendMasterRow(master, cols, equipmentId, item);
var unitSheet = getUnitsSheet(true);
var next = nextUnitSequence(unitSheet);
var now = new Date();
var rows = [];
for (var i = 0; i < n; i++) {
rows.push(unitRow("UNIT-" + padNumber(next++, 6), equipmentId, item.category, item.name,
"", status, item.location, item.note, true, now, now));
}
appendRows(unitSheet, rows);
syncMasterCountsForIds(master, cols, unitSheet, [equipmentId]);
return { equipmentId: equipmentId, added: n };
} finally {
lock.releaseLock();
}
}
function moveUnits(ids, newStatus) {
ensureSystemReady();
if (!isKnownStatus(newStatus)) throw new Error("สถานะปลายทางไม่ถูกต้อง");
var uniqueIds = uniqueStrings(ids);
var lock = LockService.getScriptLock();
lock.waitLock(30000);
try {
var unitSheet = getUnitsSheet(false);
var data = readUnitTable(unitSheet);
var affected = {};
for (var i = 0; i < data.records.length; i++) {
var record = data.records[i];
if (uniqueIds.indexOf(record.unitId) === -1 || !record.active) continue;
unitSheet.getRange(record.rowNum, data.cols.status).setValue(newStatus);
unitSheet.getRange(record.rowNum, data.cols.updatedAt).setValue(new Date());
affected[record.equipmentId] = true;
}
syncMasterCountsForIds(getMasterSheet(), resolveMasterCols(getMasterSheet()), unitSheet, Object.keys(affected));
return { moved: uniqueIds.length };
} finally {
lock.releaseLock();
}
}
// Edit shared/type-level data from the card menu.
function updateGroup(ids, fields) {
ensureSystemReady();
fields = fields || {};
var uniqueIds = uniqueStrings(ids);
var lock = LockService.getScriptLock();
lock.waitLock(30000);
try {
var unitSheet = getUnitsSheet(false);
var data = readUnitTable(unitSheet);
var equipmentIds = {};
data.records.forEach(function (record) {
if (uniqueIds.indexOf(record.unitId) !== -1) equipmentIds[record.equipmentId] = true;
});
data.records.forEach(function (record) {
if (!equipmentIds[record.equipmentId] || !record.active) return;
if (fields.name !== undefined) unitSheet.getRange(record.rowNum, data.cols.equipment).setValue(fields.name);
if (fields.category !== undefined) unitSheet.getRange(record.rowNum, data.cols.category).setValue(fields.category);
if (fields.location !== undefined) unitSheet.getRange(record.rowNum, data.cols.location).setValue(fields.location);
if (fields.note !== undefined) unitSheet.getRange(record.rowNum, data.cols.note).setValue(fields.note);
unitSheet.getRange(record.rowNum, data.cols.updatedAt).setValue(new Date());
});
updateMasterFields(Object.keys(equipmentIds), fields);
return { updatedTypes: Object.keys(equipmentIds).length };
} finally {
lock.releaseLock();
}
}
// Edit details belonging to one physical unit.
function updateUnit(unitId, fields) {
ensureSystemReady();
fields = fields || {};
var lock = LockService.getScriptLock();
lock.waitLock(30000);
try {
var unitSheet = getUnitsSheet(false);
var data = readUnitTable(unitSheet);
var target = null;
for (var i = 0; i < data.records.length; i++) {
if (data.records[i].unitId === String(unitId) && data.records[i].active) target = data.records[i];
}
if (!target) throw new Error("ไม่พบอุปกรณ์ Unit ID: " + unitId);
var serial = fields.serial !== undefined ? String(fields.serial || "").trim() : target.serial;
if (serial) validateUniqueSerial(data.records, target.unitId, serial);
if (fields.serial !== undefined) unitSheet.getRange(target.rowNum, data.cols.serial).setValue(serial);
if (fields.location !== undefined) unitSheet.getRange(target.rowNum, data.cols.location).setValue(fields.location || "");
if (fields.note !== undefined) unitSheet.getRange(target.rowNum, data.cols.note).setValue(fields.note || "");
if (fields.status !== undefined) {
if (!isKnownStatus(fields.status)) throw new Error("สถานะไม่ถูกต้อง");
unitSheet.getRange(target.rowNum, data.cols.status).setValue(fields.status);
}
unitSheet.getRange(target.rowNum, data.cols.updatedAt).setValue(new Date());
syncMasterCountsForIds(getMasterSheet(), resolveMasterCols(getMasterSheet()), unitSheet, [target.equipmentId]);
return { unitId: target.unitId };
} finally {
lock.releaseLock();
}
}
// Soft delete keeps history for the production-checklist phase.
function deleteUnits(ids) {
ensureSystemReady();
var uniqueIds = uniqueStrings(ids);
var lock = LockService.getScriptLock();
lock.waitLock(30000);
try {
var unitSheet = getUnitsSheet(false);
var data = readUnitTable(unitSheet);
var affected = {};
data.records.forEach(function (record) {
if (uniqueIds.indexOf(record.unitId) === -1 || !record.active) return;
unitSheet.getRange(record.rowNum, data.cols.active).setValue(false);
unitSheet.getRange(record.rowNum, data.cols.updatedAt).setValue(new Date());
affected[record.equipmentId] = true;
});
syncMasterCountsForIds(getMasterSheet(), resolveMasterCols(getMasterSheet()), unitSheet, Object.keys(affected));
return { deleted: uniqueIds.length };
} finally {
lock.releaseLock();
}
}
// ------------------------------------------------------------------
// Production jobs and take/return checklists (Phase 2)
// ------------------------------------------------------------------
function listProductions() {
ensureSystemReady();
var jobs = readProductionTable(getProductionsSheet(false)).records;
var checklist = readChecklistTable(getChecklistSheet(false)).records;
var stats = summarizeChecklist(checklist);
return jobs.map(function (job) { return publicJob(job, stats[job.jobId]); })
.sort(function (a, b) { return String(b.shootDate || b.createdAt).localeCompare(String(a.shootDate || a.createdAt)); });
}
function createProduction(data) {
ensureSystemReady();
data = data || {};
var title = String(data.title || "").trim();
if (!title) throw new Error("กรุณาระบุชื่อกอง");
var lock = LockService.getScriptLock();
lock.waitLock(30000);
try {
var sheet = getProductionsSheet(false);
var jobId = nextJobId(sheet);
var now = new Date();
sheet.appendRow([
jobId, title, String(data.shootDate || ""), String(data.location || ""),
String(data.owner || ""), String(data.note || ""), "open", now, now
]);
return getProduction(jobId);
} finally {
lock.releaseLock();
}
}
function updateProduction(jobId, data) {
ensureSystemReady();
data = data || {};
var title = String(data.title || "").trim();
if (!title) throw new Error("กรุณาระบุชื่อกอง");
var lock = LockService.getScriptLock();
lock.waitLock(30000);
try {
var sheet = getProductionsSheet(false);
var table = readProductionTable(sheet);
var target = null;
table.records.forEach(function (job) { if (job.jobId === String(jobId)) target = job; });
if (!target) throw new Error("ไม่พบกอง: " + jobId);
sheet.getRange(target.rowNum, table.cols.title).setValue(title);
sheet.getRange(target.rowNum, table.cols.shootDate).setValue(String(data.shootDate || ""));
sheet.getRange(target.rowNum, table.cols.location).setValue(String(data.location || ""));
sheet.getRange(target.rowNum, table.cols.owner).setValue(String(data.owner || ""));
sheet.getRange(target.rowNum, table.cols.note).setValue(String(data.note || ""));
sheet.getRange(target.rowNum, table.cols.updatedAt).setValue(new Date());
return getProduction(jobId);
} finally {
lock.releaseLock();
}
}
function getProduction(jobId) {
ensureSystemReady();
var job = findProduction(jobId);
if (!job) throw new Error("ไม่พบกอง: " + jobId);
var checklist = readChecklistTable(getChecklistSheet(false)).records.filter(function (item) {
return item.active && item.jobId === String(jobId);
});
var unitsById = {};
readActiveUnits().forEach(function (unit) { unitsById[unit.id] = unit; });
checklist.forEach(function (item) {
var current = unitsById[item.unitId];
if (!current) return;
item.equipment = current.name || item.equipment;
item.category = current.category || item.category;
item.serial = current.serial || "";
item.location = current.location || "";
});
var stats = summarizeChecklist(checklist)[job.jobId];
return {
job: publicJob(job, stats),
items: checklist.map(publicChecklistItem),
shareUrl: getProductionShareUrl(job.jobId)
};
}
function listProductionUnitOptions(jobId) {
ensureSystemReady();
var favorites = favoriteEquipmentIdsForCurrentUser();
var jobs = readProductionTable(getProductionsSheet(false)).records;
var jobsById = {};
jobs.forEach(function (job) { jobsById[job.jobId] = job; });
var checklist = readChecklistTable(getChecklistSheet(false)).records;
var selected = {};
var unavailable = {};
checklist.forEach(function (item) {
if (!item.active) return;
if (item.jobId === String(jobId)) selected[item.unitId] = true;
var job = jobsById[item.jobId];
if (item.jobId !== String(jobId) && item.taken && !item.returned && job && job.status !== "closed") {
unavailable[item.unitId] = { jobId: job.jobId, title: job.title };
}
});
return readActiveUnits().map(function (unit) {
return {
id: unit.id, equipmentId: unit.equipmentId, name: unit.name, category: unit.category,
serial: unit.serial, status: unit.status, location: unit.location,
favorite: !!favorites[unit.equipmentId],
selected: !!selected[unit.id],
unavailableJobId: unavailable[unit.id] ? unavailable[unit.id].jobId : "",
unavailableJobTitle: unavailable[unit.id] ? unavailable[unit.id].title : ""
};
});
}
function setEquipmentFavorite(equipmentId, value) {
ensureSystemReady();
equipmentId = String(equipmentId || "").trim();
if (!equipmentId) throw new Error("ไม่พบ Equipment ID");
var owner = favoriteOwnerKey();
var lock = LockService.getScriptLock();
lock.waitLock(30000);
try {
var sheet = getFavoritesSheet(false);
var data = readFavoritesTable(sheet);
var found = null;
data.records.forEach(function (record) {
if (record.owner === owner && record.equipmentId === equipmentId) found = record;
});
if (found) {
sheet.getRange(found.rowNum, data.cols.active).setValue(!!value);
sheet.getRange(found.rowNum, data.cols.updatedAt).setValue(new Date());
} else {
sheet.appendRow([owner, equipmentId, !!value, new Date()]);
}
return { equipmentId: equipmentId, favorite: !!value };
} finally {
lock.releaseLock();
}
}
function addProductionUnits(jobId, unitIds) {
ensureSystemReady();
var job = findProduction(jobId);
if (!job || job.status === "closed") throw new Error("กองนี้ปิดแล้วหรือไม่พบข้อมูล");
var wanted = uniqueStrings(unitIds);
if (!wanted.length) return getProduction(jobId);
var lock = LockService.getScriptLock();
lock.waitLock(30000);
try {
var sheet = getChecklistSheet(false);
var checklist = readChecklistTable(sheet).records;
var jobs = readProductionTable(getProductionsSheet(false)).records;
var jobsById = {};
jobs.forEach(function (row) { jobsById[row.jobId] = row; });
var existing = {};
var unavailable = {};
checklist.forEach(function (item) {
if (!item.active) return;
if (item.jobId === String(jobId)) existing[item.unitId] = true;
var otherJob = jobsById[item.jobId];
if (item.jobId !== String(jobId) && item.taken && !item.returned && otherJob && otherJob.status !== "closed") {
unavailable[item.unitId] = otherJob.title;
}
});
var units = {};
readActiveUnits().forEach(function (unit) { units[unit.id] = unit; });
var rows = [];
var now = new Date();
wanted.forEach(function (unitId) {
if (existing[unitId]) return;
if (unavailable[unitId]) throw new Error(unitId + " ยังอยู่ในกอง “" + unavailable[unitId] + "”");
var unit = units[unitId];
if (!unit) throw new Error("ไม่พบอุปกรณ์ " + unitId);
rows.push([
"CHK-" + Date.now() + "-" + Math.floor(Math.random() * 100000), String(jobId), unit.id,
unit.equipmentId, unit.name, unit.category || "", unit.serial || "", false, false, "",
true, activeUserEmail(), now, unit.location || ""
]);
});
appendChecklistRows(sheet, rows);
touchProduction(jobId);
return getProduction(jobId);
} finally {
lock.releaseLock();
}
}
function copyProductionItems(targetJobId, sourceJobId) {
ensureSystemReady();
targetJobId = String(targetJobId || "");
sourceJobId = String(sourceJobId || "");
if (!targetJobId || !sourceJobId || targetJobId === sourceJobId) throw new Error("กรุณาเลือกกองต้นทางที่ถูกต้อง");
var target = findProduction(targetJobId);
var source = findProduction(sourceJobId);
if (!target || target.status === "closed") throw new Error("กองปลายทางปิดแล้วหรือไม่พบข้อมูล");
if (!source) throw new Error("ไม่พบกองต้นทาง");
var sourceItems = readChecklistTable(getChecklistSheet(false)).records.filter(function (item) {
return item.active && item.jobId === sourceJobId;
});
var sourceUnitIds = uniqueStrings(sourceItems.map(function (item) { return item.unitId; }));
if (!sourceUnitIds.length) return { production: getProduction(targetJobId), copied: 0, skipped: 0 };
var optionsById = {};
listProductionUnitOptions(targetJobId).forEach(function (unit) { optionsById[unit.id] = unit; });
var eligible = sourceUnitIds.filter(function (unitId) {
var unit = optionsById[unitId];
return unit && !unit.selected && !unit.unavailableJobId;
});
var production = eligible.length ? addProductionUnits(targetJobId, eligible) : getProduction(targetJobId);
return { production: production, copied: eligible.length, skipped: sourceUnitIds.length - eligible.length };
}
function removeProductionUnit(jobId, unitId) {
return removeProductionUnits(jobId, [unitId]);
}
function removeProductionUnits(jobId, unitIds) {
ensureSystemReady();
var wanted = uniqueStrings(unitIds);
if (!wanted.length) return getProduction(jobId);
var lock = LockService.getScriptLock();
lock.waitLock(30000);
try {
var sheet = getChecklistSheet(false);
var data = readChecklistTable(sheet);
var matching = data.records.filter(function (item) {
return item.active && item.jobId === String(jobId) && wanted.indexOf(item.unitId) !== -1;
});
if (!matching.length) throw new Error("ไม่พบรายการอุปกรณ์ในกองนี้");
var startRow = Math.min.apply(null, matching.map(function (item) { return item.rowNum; }));
var endRow = Math.max.apply(null, matching.map(function (item) { return item.rowNum; }));
var rowCount = endRow - startRow + 1;
var auditValues = sheet.getRange(startRow, data.cols.active, rowCount, 3).getValues();
var email = activeUserEmail();
var now = new Date();
data.records.forEach(function (item) {
if (!item.active || item.jobId !== String(jobId) || wanted.indexOf(item.unitId) === -1) return;
if (item.taken) throw new Error("ยกเลิกรายการไม่ได้ เพราะทำเครื่องหมายนำออกแล้ว");
var index = item.rowNum - startRow;
auditValues[index][0] = false;
auditValues[index][1] = email;
auditValues[index][2] = now;
});
sheet.getRange(startRow, data.cols.active, rowCount, 3).setValues(auditValues);
touchProduction(jobId);
return getProduction(jobId);
} finally {
lock.releaseLock();
}
}
function setChecklistState(jobId, unitId, field, value) {
return setChecklistStates(jobId, [{ unitId: unitId, field: field, value: value }]);
}
// Saves many quick checkbox changes in one server call and a small number of Sheet writes.
function setChecklistStates(jobId, updates) {
ensureSystemReady();
updates = Array.isArray(updates) ? updates : [];
if (!updates.length) return getProduction(jobId);
var lock = LockService.getScriptLock();
lock.waitLock(30000);
try {
var job = findProduction(jobId);
if (!job || job.status === "closed") throw new Error("กองนี้ปิดแล้วหรือไม่พบข้อมูล");
var sheet = getChecklistSheet(false);
var data = readChecklistTable(sheet);
var targets = {};
data.records.forEach(function (item) {
if (item.active && item.jobId === String(jobId)) targets[item.unitId] = item;
});
var targetRows = updates.map(function (update) {
var target = targets[String(update.unitId || "")];
if (!target) throw new Error("ไม่พบรายการ Checklist: " + String(update.unitId || ""));
return target.rowNum;
});
var startRow = Math.min.apply(null, targetRows);
var endRow = Math.max.apply(null, targetRows);
var rowCount = endRow - startRow + 1;
var stateValues = sheet.getRange(startRow, data.cols.taken, rowCount, 2).getValues();
var auditValues = sheet.getRange(startRow, data.cols.updatedBy, rowCount, 2).getValues();
var jobs = readProductionTable(getProductionsSheet(false)).records;
var openJobs = {};
jobs.forEach(function (row) { if (row.status !== "closed") openJobs[row.jobId] = row; });
var email = activeUserEmail();
var now = new Date();
updates.forEach(function (update) {
var field = String(update.field || "");
var unitId = String(update.unitId || "");
if (field !== "taken" && field !== "returned") throw new Error("สถานะ Checklist ไม่ถูกต้อง");
var target = targets[unitId];
if (!target) throw new Error("ไม่พบรายการ Checklist: " + unitId);
var index = target.rowNum - startRow;
var checked = !!update.value;
var currentTaken = isTruthy(stateValues[index][0]);
if (field === "returned" && checked && !currentTaken) throw new Error("ต้องเช็กนำออกก่อนจึงจะเช็กนำกลับได้");
if (field === "taken" && checked && !currentTaken) {
for (var i = 0; i < data.records.length; i++) {
var other = data.records[i];
if (!other.active || other.jobId === String(jobId) || other.unitId !== unitId) continue;
if (other.taken && !other.returned && openJobs[other.jobId]) {
throw new Error(unitId + " ยังอยู่ในกอง “" + openJobs[other.jobId].title + "”");
}
}
}
if (field === "taken") {
stateValues[index][0] = checked;
if (!checked) stateValues[index][1] = false;
} else {
stateValues[index][1] = checked;
}
auditValues[index][0] = email;
auditValues[index][1] = now;
});
sheet.getRange(startRow, data.cols.taken, rowCount, 2).setValues(stateValues);
sheet.getRange(startRow, data.cols.updatedBy, rowCount, 2).setValues(auditValues);
touchProduction(jobId);
return getProduction(jobId);
} finally {
lock.releaseLock();
}
}
function closeProduction(jobId) {
ensureSystemReady();
var result = getProduction(jobId);
if (!result.items.length) throw new Error("ยังไม่มีอุปกรณ์ในกองนี้");
if (result.job.returnedCount !== result.job.totalCount) throw new Error("ยังมีอุปกรณ์ที่นำกลับไม่ครบ");
setProductionStatus(jobId, "closed");
return getProduction(jobId);
}
function reopenProduction(jobId) {
ensureSystemReady();
setProductionStatus(jobId, "open");
return getProduction(jobId);
}
function getProductionShareUrl(jobId) {
var base = ScriptApp.getService().getUrl() || "";
return base ? base + (base.indexOf("?") >= 0 ? "&" : "?") + "job=" + encodeURIComponent(jobId) : "?job=" + encodeURIComponent(jobId);
}
// ------------------------------------------------------------------
// Spreadsheet setup and migration
// ------------------------------------------------------------------
function getSpreadsheet() {
return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}
function getMasterSheet() {
var ss = getSpreadsheet();
if (SHEET_NAME) {
var named = ss.getSheetByName(SHEET_NAME);
if (!named) throw new Error("ไม่พบแท็บ: " + SHEET_NAME);
return named;
}
var systemNames = {};
systemNames[UNITS_SHEET_NAME] = true;
systemNames[PRODUCTIONS_SHEET_NAME] = true;
systemNames[CHECKLIST_SHEET_NAME] = true;
systemNames[FAVORITES_SHEET_NAME] = true;
var candidates = ss.getSheets().filter(function (sheet) {
return !systemNames[sheet.getName()] && masterSheetScore(sheet) > 0;
}).sort(function (a, b) {
return masterSheetScore(b) - masterSheetScore(a);
});
if (candidates.length) return candidates[0];
throw new Error("ไม่พบแท็บที่มีคอลัมน์ Equipment/ชื่ออุปกรณ์");
}
function masterSheetScore(sheet) {
if (sheet.getLastColumn() < 1) return 0;
var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(normalize);
function hasAny(aliases) {
return aliases.some(function (alias) { return headers.indexOf(normalize(alias)) !== -1; });
}
if (!hasAny(FIELD_ALIASES.equipment)) return 0;
var score = 100;
if (hasAny(FIELD_ALIASES.category)) score += 10;
if (hasAny(FIELD_ALIASES.sn)) score += 10;
if (hasAny(FIELD_ALIASES.total)) score += 10;
STATUS_DEFS.forEach(function (status) { if (hasAny([status.header])) score += 5; });
return score;
}
function getUnitsSheet(createIfMissing) {
var ss = getSpreadsheet();
var sheet = ss.getSheetByName(UNITS_SHEET_NAME);
if (!sheet && createIfMissing) {
sheet = ss.insertSheet(UNITS_SHEET_NAME);
sheet.getRange(1, 1, 1, UNIT_HEADERS.length).setValues([UNIT_HEADERS]);
sheet.setFrozenRows(1);
}
if (!sheet) throw new Error("ไม่พบแท็บ " + UNITS_SHEET_NAME + " — กรุณารัน setupSystem");
ensureUnitHeaders(sheet);
return sheet;
}
function ensureUnitHeaders(sheet) {
if (sheet.getLastColumn() < UNIT_HEADERS.length) sheet.insertColumnsAfter(Math.max(1, sheet.getLastColumn()), UNIT_HEADERS.length - sheet.getLastColumn());
var current = sheet.getRange(1, 1, 1, UNIT_HEADERS.length).getValues()[0];
for (var i = 0; i < UNIT_HEADERS.length; i++) if (!current[i]) current[i] = UNIT_HEADERS[i];
sheet.getRange(1, 1, 1, UNIT_HEADERS.length).setValues([current]);
}
function resolveMasterCols(sheet) {
var lastCol = Math.max(1, sheet.getLastColumn());
var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(normalize);
function find(aliases) {
for (var i = 0; i < headers.length; i++) if (aliases.indexOf(headers[i]) !== -1) return i + 1;
return -1;
}
function ensure(header) {
var existing = find([normalize(header)]);
if (existing > 0) return existing;
var col = sheet.getLastColumn() + 1;
sheet.getRange(1, col).setValue(header);
headers.push(normalize(header));
return col;
}
var cols = {};
for (var field in FIELD_ALIASES) cols[field] = find(FIELD_ALIASES[field]);
if (cols.equipment < 0) throw new Error("ไม่พบคอลัมน์ Equipment ในชีตหลัก");
cols.id = cols.id > 0 ? cols.id : ensure("_id");
cols.location = cols.location > 0 ? cols.location : ensure("Location");
cols.total = cols.total > 0 ? cols.total : ensure("Total");
cols.statuses = STATUS_DEFS.map(function (status) { return { key: status.key, col: ensure(status.header) }; });
return cols;
}
function backfillMasterIds(sheet, cols) {
var lastRow = sheet.getLastRow();
if (lastRow < 2) return [];
var ids = sheet.getRange(2, cols.id, lastRow - 1, 1).getValues();
var names = sheet.getRange(2, cols.equipment, lastRow - 1, 1).getValues();
var changed = false;
var created = [];
for (var i = 0; i < ids.length; i++) {
if (String(names[i][0] || "").trim() && !String(ids[i][0] || "").trim()) {
ids[i][0] = "eq_" + Date.now() + "_" + i + "_" + Math.floor(Math.random() * 1000);
changed = true;
created.push({ rowNum: i + 2, id: ids[i][0] });
}
}
if (changed) sheet.getRange(2, cols.id, ids.length, 1).setValues(ids);
return created;
}
function migrateMasterCountsToUnits(master, cols, unitSheet) {
var lastRow = master.getLastRow();
if (lastRow < 2) return { createdUnits: 0, equipmentTypes: 0 };
var values = master.getRange(2, 1, lastRow - 1, master.getLastColumn()).getValues();
var unitData = readUnitTable(unitSheet);
var existing = {};
unitData.records.forEach(function (record) {
if (!record.active) return;
var key = record.equipmentId + "||" + record.status;
existing[key] = (existing[key] || 0) + 1;
});
var next = nextUnitSequence(unitSheet);
var rows = [];
var equipmentTypes = 0;
for (var r = 0; r < values.length; r++) {
var row = values[r];
var equipment = String(row[cols.equipment - 1] || "").trim();
var equipmentId = String(row[cols.id - 1] || "").trim();
if (!equipment || !equipmentId) continue;
equipmentTypes++;
var category = cols.category > 0 ? row[cols.category - 1] : "";
var location = cols.location > 0 ? row[cols.location - 1] : "";
var note = cols.note > 0 ? row[cols.note - 1] : "";
var serials = splitSerials(cols.sn > 0 ? row[cols.sn - 1] : "");
var serialIndex = 0;
cols.statuses.forEach(function (status) {
var expected = Math.max(0, toInt(row[status.col - 1]));
var key = equipmentId + "||" + status.key;
var missing = Math.max(0, expected - (existing[key] || 0));
for (var i = 0; i < missing; i++) {
var now = new Date();
rows.push(unitRow("UNIT-" + padNumber(next++, 6), equipmentId, category, equipment,
serials[serialIndex++] || "", status.key, location, note, true, now, now));
}
});
}
appendRows(unitSheet, rows);
return { createdUnits: rows.length, equipmentTypes: equipmentTypes };
}
// Pull user edits from the readable master sheet into EquipmentUnits.
// Shared name/category and S/N are synchronized; increases to status counts create missing units.
// Decreasing counts in the master sheet does not delete physical units for safety.
function syncSheetChangesToUnits(waitMillis) {
var lock = LockService.getScriptLock();
var acquired = lock.tryLock(Math.max(0, Number(waitMillis) || 0));
if (!acquired) throw new Error("ระบบกำลังบันทึกข้อมูลอยู่ กรุณากดรีเฟรชอีกครั้ง");
try {
var master = getMasterSheet();
var cols = resolveMasterCols(master);
backfillMasterIds(master, cols);
var unitSheet = getUnitsSheet(false);
var migration = migrateMasterCountsToUnits(master, cols, unitSheet);
if (master.getLastRow() < 2 || unitSheet.getLastRow() < 2) {
return { createdUnits: migration.createdUnits || 0, updatedUnits: 0 };
}
var masterValues = master.getRange(2, 1, master.getLastRow() - 1, master.getLastColumn()).getValues();
var masterById = {};
masterValues.forEach(function (row) {
var equipmentId = String(row[cols.id - 1] || "").trim();
if (!equipmentId) return;
masterById[equipmentId] = {
name: String(row[cols.equipment - 1] || "").trim(),
category: cols.category > 0 ? row[cols.category - 1] || "" : "",
serials: cols.sn > 0 ? splitSerials(row[cols.sn - 1]) : null
};
});
var unitData = readUnitTable(unitSheet);
var unitsByEquipment = {};
unitData.records.forEach(function (record) {
if (!record.active || !masterById[record.equipmentId]) return;
if (!unitsByEquipment[record.equipmentId]) unitsByEquipment[record.equipmentId] = [];
unitsByEquipment[record.equipmentId].push(record);
});
var width = unitSheet.getLastColumn();
var values = unitSheet.getRange(2, 1, unitSheet.getLastRow() - 1, width).getValues();
var changed = false;
var updatedUnits = 0;
Object.keys(unitsByEquipment).forEach(function (equipmentId) {
var source = masterById[equipmentId];
var records = unitsByEquipment[equipmentId].sort(function (a, b) { return a.rowNum - b.rowNum; });
records.forEach(function (record, index) {
var row = values[record.rowNum - 2];
var serial = source.serials === null ? row[unitData.cols.serial - 1] : (source.serials[index] || "");
var updates = [
[unitData.cols.equipment, source.name],
[unitData.cols.category, source.category],
[unitData.cols.serial, serial]
];
var rowChanged = false;
updates.forEach(function (update) {
var column = update[0];
var nextValue = update[1];
if (String(row[column - 1] == null ? "" : row[column - 1]) !== String(nextValue == null ? "" : nextValue)) {
row[column - 1] = nextValue;
rowChanged = true;
}
});
if (rowChanged) {
row[unitData.cols.updatedAt - 1] = new Date();
changed = true;
updatedUnits++;
}
});
});
if (changed) unitSheet.getRange(2, 1, values.length, width).setValues(values);
return {
createdUnits: migration.createdUnits || 0,
updatedUnits: updatedUnits
};
} finally {
lock.releaseLock();
}
}
// ------------------------------------------------------------------
// Unit table reads and writes
// ------------------------------------------------------------------
function readUnitTable(sheet) {
var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(normalize);
function col(name) { return headers.indexOf(normalize(name)) + 1; }
var cols = {
unitId: col("Unit ID"), equipmentId: col("Equipment ID"), category: col("Category"),
equipment: col("Equipment"), serial: col("Serial Number"), status: col("Status"),
location: col("Location"), note: col("Note"), active: col("Active"),
createdAt: col("Created At"), updatedAt: col("Updated At")
};
var records = [];
if (sheet.getLastRow() >= 2) {
var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
for (var i = 0; i < values.length; i++) {
var row = values[i];
var unitId = String(row[cols.unitId - 1] || "").trim();
if (!unitId) continue;
records.push({
rowNum: i + 2, unitId: unitId,
equipmentId: String(row[cols.equipmentId - 1] || "").trim(),
category: row[cols.category - 1] || "", equipment: row[cols.equipment - 1] || "",
serial: row[cols.serial - 1] || "", status: row[cols.status - 1] || "good",
location: row[cols.location - 1] || "", note: row[cols.note - 1] || "",
active: isTruthy(row[cols.active - 1])
});
}
}
return { cols: cols, records: records };
}
function readActiveUnits() {
var data = readUnitTable(getUnitsSheet(false));
return data.records.filter(function (record) { return record.active; }).map(function (record) {
return {
id: record.unitId, equipmentId: record.equipmentId, name: record.equipment,
category: record.category, serial: record.serial, status: record.status,
location: record.location, note: record.note
};
});
}
function unitRow(unitId, equipmentId, category, equipment, serial, status, location, note, active, createdAt, updatedAt) {
return [unitId, equipmentId, category || "", equipment || "", serial || "", status,
location || "", note || "", active, createdAt, updatedAt];
}
function appendRows(sheet, rows) {
if (!rows || !rows.length) return;
sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, UNIT_HEADERS.length).setValues(rows);
}
function nextUnitSequence(sheet) {
var max = 0;
if (sheet.getLastRow() >= 2) {
var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
values.forEach(function (row) {
var match = String(row[0] || "").match(/^UNIT-(\d+)$/);
if (match) max = Math.max(max, parseInt(match[1], 10));
});
}
return max + 1;
}
function validateUniqueSerial(records, currentUnitId, serial) {
var needle = serial.toLowerCase();
for (var i = 0; i < records.length; i++) {
if (records[i].active && records[i].unitId !== currentUnitId && String(records[i].serial || "").trim().toLowerCase() === needle) {
throw new Error("S/N นี้ถูกใช้กับ " + records[i].unitId + " แล้ว");
}
}
}
// ------------------------------------------------------------------
// Production sheet helpers
// ------------------------------------------------------------------
function getProductionsSheet(createIfMissing) {
return getSystemSheet(PRODUCTIONS_SHEET_NAME, PRODUCTION_HEADERS, createIfMissing);
}
function getChecklistSheet(createIfMissing) {
return getSystemSheet(CHECKLIST_SHEET_NAME, CHECKLIST_HEADERS, createIfMissing);
}
function getFavoritesSheet(createIfMissing) {
return getSystemSheet(FAVORITES_SHEET_NAME, FAVORITE_HEADERS, createIfMissing);
}
function getSystemSheet(name, headers, createIfMissing) {
var ss = getSpreadsheet();
var sheet = ss.getSheetByName(name);
if (!sheet && createIfMissing) {
sheet = ss.insertSheet(name);
sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
sheet.setFrozenRows(1);
}
if (!sheet) throw new Error("ไม่พบแท็บ " + name + " — กรุณารัน setupSystem");
var current = sheet.getRange(1, 1, 1, Math.max(headers.length, sheet.getLastColumn())).getValues()[0];
for (var i = 0; i < headers.length; i++) if (!current[i]) current[i] = headers[i];
sheet.getRange(1, 1, 1, current.length).setValues([current]);
return sheet;
}
function readFavoritesTable(sheet) {
var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(normalize);
function col(name) { return headers.indexOf(normalize(name)) + 1; }
var cols = { owner: col("Owner"), equipmentId: col("Equipment ID"), active: col("Active"), updatedAt: col("Updated At") };
var records = [];
if (sheet.getLastRow() >= 2) {
var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
for (var i = 0; i < values.length; i++) {
var row = values[i];
var owner = String(row[cols.owner - 1] || "").trim();
var equipmentId = String(row[cols.equipmentId - 1] || "").trim();
if (!owner || !equipmentId) continue;
records.push({ rowNum: i + 2, owner: owner, equipmentId: equipmentId, active: isTruthy(row[cols.active - 1]) });
}
}
return { cols: cols, records: records };
}
function favoriteOwnerKey() {
return activeUserEmail() || "shared";
}
function favoriteEquipmentIdsForCurrentUser() {
var owner = favoriteOwnerKey();
var result = {};
readFavoritesTable(getFavoritesSheet(false)).records.forEach(function (record) {
if (record.owner === owner && record.active) result[record.equipmentId] = true;
});
return result;
}
function readProductionTable(sheet) {
var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(normalize);
function col(name) { return headers.indexOf(normalize(name)) + 1; }
var cols = {
jobId: col("Job ID"), title: col("Title"), shootDate: col("Shoot Date"), location: col("Location"),
owner: col("Owner"), note: col("Note"), status: col("Status"), createdAt: col("Created At"), updatedAt: col("Updated At")
};
var records = [];
if (sheet.getLastRow() >= 2) {
var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
for (var i = 0; i < values.length; i++) {
var row = values[i];
var jobId = String(row[cols.jobId - 1] || "").trim();
if (!jobId) continue;
records.push({
rowNum: i + 2, jobId: jobId, title: row[cols.title - 1] || "",
shootDate: displayDate(row[cols.shootDate - 1]), location: row[cols.location - 1] || "",
owner: row[cols.owner - 1] || "", note: row[cols.note - 1] || "",
status: row[cols.status - 1] || "open",
createdAt: displayDateTime(row[cols.createdAt - 1]), updatedAt: displayDateTime(row[cols.updatedAt - 1])
});
}
}
return { cols: cols, records: records };
}
function readChecklistTable(sheet) {
var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(normalize);
function col(name) { return headers.indexOf(normalize(name)) + 1; }
var cols = {
checklistId: col("Checklist ID"), jobId: col("Job ID"), unitId: col("Unit ID"), equipmentId: col("Equipment ID"),
equipment: col("Equipment"), category: col("Category"), serial: col("Serial Number"), taken: col("Taken"),
returned: col("Returned"), note: col("Note"), active: col("Active"), updatedBy: col("Updated By"),
updatedAt: col("Updated At"), location: col("Location")
};
var records = [];
if (sheet.getLastRow() >= 2) {
var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
for (var i = 0; i < values.length; i++) {
var row = values[i];
var checklistId = String(row[cols.checklistId - 1] || "").trim();
if (!checklistId) continue;
records.push({
rowNum: i + 2, checklistId: checklistId,
jobId: String(row[cols.jobId - 1] || ""), unitId: String(row[cols.unitId - 1] || ""),
equipmentId: String(row[cols.equipmentId - 1] || ""), equipment: row[cols.equipment - 1] || "",
category: row[cols.category - 1] || "", serial: row[cols.serial - 1] || "",
taken: isTruthy(row[cols.taken - 1]), returned: isTruthy(row[cols.returned - 1]),
note: row[cols.note - 1] || "", active: isTruthy(row[cols.active - 1]),
updatedBy: row[cols.updatedBy - 1] || "", updatedAt: displayDateTime(row[cols.updatedAt - 1]),
location: cols.location > 0 ? row[cols.location - 1] || "" : ""
});
}
}
return { cols: cols, records: records };
}
function summarizeChecklist(records) {
var stats = {};
records.forEach(function (item) {
if (!item.active) return;
if (!stats[item.jobId]) stats[item.jobId] = { total: 0, taken: 0, returned: 0 };
stats[item.jobId].total++;
if (item.taken) stats[item.jobId].taken++;
if (item.returned) stats[item.jobId].returned++;
});
return stats;
}
function publicJob(job, stats) {
stats = stats || { total: 0, taken: 0, returned: 0 };
return {
id: job.jobId, title: job.title, shootDate: job.shootDate, location: job.location,
owner: job.owner, note: job.note, status: job.status, createdAt: job.createdAt, updatedAt: job.updatedAt,
totalCount: stats.total, takenCount: stats.taken, returnedCount: stats.returned
};
}
function publicChecklistItem(item) {
return {
id: item.checklistId, jobId: item.jobId, unitId: item.unitId, equipmentId: item.equipmentId,
name: item.equipment, category: item.category, serial: item.serial,
location: item.location || "", taken: item.taken, returned: item.returned, note: item.note,
updatedBy: item.updatedBy, updatedAt: item.updatedAt
};
}
function findProduction(jobId) {
var records = readProductionTable(getProductionsSheet(false)).records;
for (var i = 0; i < records.length; i++) if (records[i].jobId === String(jobId)) return records[i];
return null;
}
function nextJobId(sheet) {
var datePart = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Asia/Bangkok", "yyyyMMdd");
var prefix = "JOB-" + datePart + "-";
var max = 0;
if (sheet.getLastRow() >= 2) {
var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
values.forEach(function (row) {
var text = String(row[0] || "");
if (text.indexOf(prefix) !== 0) return;
max = Math.max(max, parseInt(text.slice(prefix.length), 10) || 0);
});
}
return prefix + padNumber(max + 1, 3);
}
function appendChecklistRows(sheet, rows) {
if (!rows.length) return;
var startRow = sheet.getLastRow() + 1;
sheet.getRange(startRow, 1, rows.length, CHECKLIST_HEADERS.length).setValues(rows);
sheet.getRange(startRow, 8, rows.length, 2).insertCheckboxes();
}
function touchProduction(jobId) {
var sheet = getProductionsSheet(false);
var data = readProductionTable(sheet);
data.records.forEach(function (job) {
if (job.jobId === String(jobId)) sheet.getRange(job.rowNum, data.cols.updatedAt).setValue(new Date());
});
}
function setProductionStatus(jobId, status) {
var sheet = getProductionsSheet(false);
var data = readProductionTable(sheet);
var found = false;
data.records.forEach(function (job) {
if (job.jobId !== String(jobId)) return;
sheet.getRange(job.rowNum, data.cols.status).setValue(status);
sheet.getRange(job.rowNum, data.cols.updatedAt).setValue(new Date());
found = true;
});
if (!found) throw new Error("ไม่พบกอง: " + jobId);
}
function displayDate(value) {
if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
return Utilities.formatDate(value, Session.getScriptTimeZone() || "Asia/Bangkok", "yyyy-MM-dd");
}
return String(value || "");
}
function displayDateTime(value) {
if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
return Utilities.formatDate(value, Session.getScriptTimeZone() || "Asia/Bangkok", "yyyy-MM-dd HH:mm");
}
return String(value || "");
}
function activeUserEmail() {
try { return Session.getActiveUser().getEmail() || ""; } catch (err) { return ""; }
}
// ------------------------------------------------------------------
// Keep legacy summary counts in sync
// ------------------------------------------------------------------
function syncAllMasterCounts(master, cols, unitSheet) {
var data = readUnitTable(unitSheet);
var ids = {};
data.records.forEach(function (record) { if (record.active) ids[record.equipmentId] = true; });
syncMasterCountsForIds(master, cols, unitSheet, Object.keys(ids));
}
function syncMasterCountsForIds(master, cols, unitSheet, equipmentIds) {
if (!equipmentIds || !equipmentIds.length) return;
var wanted = {};
equipmentIds.forEach(function (id) { wanted[id] = true; });
var counts = {};
var serials = {};
equipmentIds.forEach(function (id) {
counts[id] = { good: 0, partial: 0, repair: 0, broke: 0 };
serials[id] = [];
});
readUnitTable(unitSheet).records.forEach(function (record) {
if (!record.active || !wanted[record.equipmentId] || !counts[record.equipmentId]) return;
if (counts[record.equipmentId][record.status] !== undefined) counts[record.equipmentId][record.status]++;
if (String(record.serial || "").trim()) serials[record.equipmentId].push(String(record.serial).trim());
});
if (master.getLastRow() < 2) return;
var ids = master.getRange(2, cols.id, master.getLastRow() - 1, 1).getValues();
for (var i = 0; i < ids.length; i++) {
var id = String(ids[i][0] || "").trim();
if (!wanted[id]) continue;
var rowNum = i + 2;
var total = 0;
cols.statuses.forEach(function (status) {
var value = counts[id] ? counts[id][status.key] || 0 : 0;
master.getRange(rowNum, status.col).setValue(value);
total += value;
});
master.getRange(rowNum, cols.total).setValue(total);
if (cols.sn > 0) master.getRange(rowNum, cols.sn).setValue((serials[id] || []).join("\n"));
}
}
function appendMasterRow(sheet, cols, equipmentId, item) {
var width = sheet.getLastColumn();
var row = new Array(width).fill("");
row[cols.id - 1] = equipmentId;
row[cols.equipment - 1] = item.name || "";
if (cols.category > 0) row[cols.category - 1] = item.category || "";
if (cols.location > 0) row[cols.location - 1] = item.location || "";
if (cols.note > 0) row[cols.note - 1] = item.note || "";
if (cols.no > 0) row[cols.no - 1] = nextMasterNo(sheet, cols);
cols.statuses.forEach(function (status) { row[status.col - 1] = 0; });
row[cols.total - 1] = 0;
sheet.getRange(sheet.getLastRow() + 1, 1, 1, width).setValues([row]);
}
function updateMasterFields(equipmentIds, fields) {
var master = getMasterSheet();
var cols = resolveMasterCols(master);
if (master.getLastRow() < 2) return;
var ids = master.getRange(2, cols.id, master.getLastRow() - 1, 1).getValues();
var wanted = {};
equipmentIds.forEach(function (id) { wanted[id] = true; });
for (var i = 0; i < ids.length; i++) {
if (!wanted[String(ids[i][0] || "").trim()]) continue;
var rowNum = i + 2;
if (fields.name !== undefined) master.getRange(rowNum, cols.equipment).setValue(fields.name);
if (fields.category !== undefined && cols.category > 0) master.getRange(rowNum, cols.category).setValue(fields.category);
if (fields.location !== undefined && cols.location > 0) master.getRange(rowNum, cols.location).setValue(fields.location);
if (fields.note !== undefined && cols.note > 0) master.getRange(rowNum, cols.note).setValue(fields.note);
}
}
// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
function normalize(value) { return String(value == null ? "" : value).trim().toLowerCase().replace(/[.\s]+/g, " ").trim(); }
function toInt(value) { var n = parseInt(value, 10); return isNaN(n) ? 0 : n; }
function isKnownStatus(key) { return STATUS_DEFS.some(function (status) { return status.key === key; }); }
function isTruthy(value) { return value === true || String(value).toLowerCase() === "true" || String(value) === "1"; }
function padNumber(value, length) { var text = String(value); while (text.length < length) text = "0" + text; return text; }
function uniqueStrings(values) { var map = {}; (values || []).forEach(function (value) { map[String(value)] = true; }); return Object.keys(map); }
function splitSerials(value) { return String(value || "").split(/[\n,;]+/).map(function (part) { return part.trim(); }).filter(Boolean); }
function nextMasterNo(sheet, cols) {
if (cols.no < 0 || sheet.getLastRow() < 2) return 1;
var values = sheet.getRange(2, cols.no, sheet.getLastRow() - 1, 1).getValues();
var max = 0;
values.forEach(function (row) { var n = parseInt(row[0], 10); if (!isNaN(n)) max = Math.max(max, n); });
return max + 1;
}
