// Desired safety invariants. Failures document the imported baseline's confirmed defects.
// All tests use synthetic data; they never connect to Google or edit the real spreadsheet.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..', 'apps-script');
const source = fs.readFileSync(path.join(root, 'code.gs'), 'utf8');
class Sheet {
  constructor(rows) { this.rows = rows.map(r => [...r]); }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return Math.max(...this.rows.map(r => r.length)); }
  getRange(row, col, height = 1, width = 1) {
    const sheet = this;
    return {
      getValues() { return Array.from({length: height}, (_, i) => Array.from({length: width}, (_, j) => sheet.rows[row - 1 + i]?.[col - 1 + j] ?? '')); },
      setValue(value) { return this.setValues([[value]]); },
      setValues(values) {
        assert.equal(values.length, height);
        values.forEach((valuesRow, i) => {
          assert.equal(valuesRow.length, width);
          sheet.rows[row - 1 + i] ||= [];
          valuesRow.forEach((value, j) => sheet.rows[row - 1 + i][col - 1 + j] = value);
        });
        return this;
      }
    };
  }
}
function context() {
  const lock = {held: false, waitLock() { this.held = true; }, tryLock() { this.held = true; return true; }, releaseLock() { this.held = false; }};
  const ctx = vm.createContext({console, LockService: {getScriptLock: () => lock}});
  vm.runInContext(source, ctx);
  ctx.ensureSystemReady = () => {};
  ctx.testLock = lock;
  return ctx;
}
function inventory(ctx, entries, counts = [2, 0, 0, 0], serials = '') {
  const master = new Sheet([
    ['Category', 'No.', 'Equipment', 'S/N', 'Good', 'Partial', 'Need Repair', 'Broke', 'Total', 'Note', '_id', 'Location'],
    ['Camera', 1, 'Camera A', serials, ...counts, counts.reduce((a,b) => a+b,0), '', 'eq-a', 'Old studio']
  ]);
  const units = new Sheet([Array.from(ctx.UNIT_HEADERS), ...entries.map((e,i) => [
    'UNIT-' + String(i+1).padStart(6,'0'), 'eq-a', 'Camera', 'Camera A', e.serial || '', e.status || 'good', 'Old studio', '', true, '', ''
  ])]);
  ctx.getMasterSheet = () => master;
  ctx.getUnitsSheet = () => units;
  return {master, units, cols: ctx.resolveMasterCols(master)};
}
test('R1: changing status counts must not invent a third physical unit', () => {
  const c = context();
  const {master, units, cols} = inventory(c, [{}, {}], [1, 0, 1, 0]);
  c.migrateMasterCountsToUnits(master, cols, units);
  assert.equal(c.readUnitTable(units).records.filter(r => r.active).length, 2);
});
test('R2: refresh must preserve the serial-to-Unit-ID mapping when one unit has no serial', () => {
  const c = context();
  const {units} = inventory(c, [{serial: ''}, {serial: 'SN-B'}], [2, 0, 0, 0], 'SN-B');
  c.syncSheetChangesToUnits(0);
  const records = c.readUnitTable(units).records;
  assert.equal(records.find(r => r.unitId === 'UNIT-000002').serial, 'SN-B');
  assert.equal(records.find(r => r.unitId === 'UNIT-000001').serial, '');
});
test('R3: invalid unit status must be rejected before any unit field is changed', () => {
  const c = context();
  const {units} = inventory(c, [{serial: 'OLD'}], [1, 0, 0, 0], 'OLD');
  const before = JSON.stringify(units.rows);
  assert.throws(() => c.updateUnit('UNIT-000001', {serial: 'NEW', status: 'invalid'}));
  assert.equal(JSON.stringify(units.rows), before);
});
test('R4: closeProduction must validate and close while holding the same script lock', () => {
  const c = context();
  c.getProduction = () => ({job: {totalCount: 1, returnedCount: 1}, items: [{}]});
  let heldWhenClosing = false;
  c.setProductionStatus = () => { heldWhenClosing = c.testLock.held; };
  c.closeProduction('JOB-A');
  assert.equal(heldWhenClosing, true);
});
test('R5: a failed checklist save must retain later queued edits', async () => {
  const c = vm.createContext({console, window: {APP_CONFIG: {}}, document: {getElementById() {return {};}, addEventListener() {}}, setTimeout: () => 1, clearTimeout() {}});
  let app = fs.readFileSync(path.join(root, 'app.html'), 'utf8').replace(/^\s*<script>/, '').replace(/<\/script>\s*$/, '');
  app = app.replace('document.addEventListener("DOMContentLoaded", init);', `
    window.test = {
      pending: pendingChecklistUpdates,
      flush: flushChecklistUpdates,
      setCurrent: (value) => {currentProduction = value;},
      setApi: (value) => {api = value;},
      silenceUI: () => {updateChecklistSaveState = () => {}; showBanner = () => {}; renderProductionDetail = () => {};}
    };`);
  vm.runInContext(app, c);
  const t = c.window.test;
  t.silenceUI();
  t.setCurrent({job: {id: 'JOB-A'}, items: []});
  t.pending.set('UNIT-1|taken', {unitId: 'UNIT-1', field: 'taken', value: true});
  let failSave;
  t.setApi((action) => action === 'setChecklistStates' ? new Promise((_, reject) => {failSave = reject;}) : Promise.resolve({job: {id: 'JOB-A'}, items: []}));
  const saving = t.flush();
  t.pending.set('UNIT-2|taken', {unitId: 'UNIT-2', field: 'taken', value: true});
  failSave(new Error('temporary connection failure'));
  await saving;
  assert.equal(t.pending.has('UNIT-2|taken'), true);
});
test('R6: URL job value must not introduce an HTML script closing tag', () => {
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const payload = '</script><script>window.__reviewProbe = true</script>';
  const script = index.match(/<script>\s*window\.APP_CONFIG[\s\S]*?<\/script>/)[0];
  const rendered = script.replace('<?!= JSON.stringify(INITIAL_JOB_ID) ?>', JSON.stringify(payload));
  assert.equal((rendered.match(/<\/script>/g) || []).length, 1);
});
test('R7: category text must remain text instead of becoming HTML', () => {
  const c = vm.createContext({window: {APP_CONFIG: {}}, document: {getElementById() {return {};}, addEventListener() {}}});
  let app = fs.readFileSync(path.join(root, 'app.html'), 'utf8').replace(/^\s*<script>/, '').replace(/<\/script>\s*$/, '');
  app = app.replace('document.addEventListener("DOMContentLoaded", init);', `
    window.buildFilters = buildCategoryFilters;
    items = [{name: 'Camera', category: '<img src=x onerror="window.__reviewProbe=true">'}];
  `);
  const buttons = [];
  const host = {innerHTML: '', appendChild(button) {buttons.push(button);}};
  c.document.getElementById = (id) => id === 'categoryFilters' ? host : {};
  c.document.createElement = () => ({addEventListener() {}});
  vm.runInContext(app, c);
  c.window.buildFilters();
  assert.equal(buttons.some(button => /<img\b/.test(button.innerHTML || '')), false);
});
