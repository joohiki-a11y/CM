const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..', 'apps-script');
new vm.Script(fs.readFileSync(path.join(root, 'code.gs'), 'utf8'), { filename: 'code.gs' });
const app = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const match = app.match(/^\s*<script>([\s\S]*)<\/script>\s*$/i);
if (!match) throw new Error('app.html must contain one script wrapper');
new vm.Script(match[1], { filename: 'app.html' });
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const ids = [...index.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
if (new Set(ids).size !== ids.length) throw new Error('Duplicate HTML IDs');
for (const [, id] of app.matchAll(/\$\("([^"]+)"\)/g)) {
  if (!ids.includes(id)) throw new Error('Missing DOM element: ' + id);
}
for (const [, name] of index.matchAll(/include\("([^"]+)"\)/g)) {
  if (!fs.existsSync(path.join(root, name + '.html'))) throw new Error('Missing include: ' + name);
}
const server = fs.readFileSync(path.join(root, 'code.gs'), 'utf8');
for (const [, name] of app.matchAll(/\brunner\.(\w+)\(/g)) {
  if (!server.includes('function ' + name + '(')) throw new Error('Missing API: ' + name);
}
console.log('PASS: server/client JavaScript syntax, DOM IDs, HTML includes, client/server API names');
console.log('This check does not run the Apps Script service or prove inventory readiness.');
