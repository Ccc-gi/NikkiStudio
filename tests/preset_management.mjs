import assert from 'node:assert/strict';
import {filterPresets} from '../frontend/workspace_presets.js';
const rows=[{id:'a',name:'庭院 10',items:2,savedAt:'2026-01-01'}, {id:'b',name:'庭院 2',items:8,savedAt:'2026-02-01'}, {id:'c',name:'小屋',items:3,savedAt:'2026-01-02'}];
assert.deepEqual(filterPresets(rows,' 庭院 ','name').map(r=>r.id),['b','a']);
assert.deepEqual(filterPresets(rows,'','recent').map(r=>r.id),['b','c','a']);
assert.deepEqual(filterPresets(rows,'','size').map(r=>r.id),['b','c','a']);
assert.equal(rows[0].id,'a');
assert.equal(filterPresets(rows,'不存在','name').length,0);
console.log('PASS: preset search, natural-name sorting, saved-time sorting and item-count sorting');
