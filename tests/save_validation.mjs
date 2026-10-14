import assert from 'node:assert/strict';
import {validateSave,correctedSave,dyeCodes,cleanedDye,pointInPolygon} from '../frontend/save_validation.js';

const SQUARE=[[0,0],[1000,0],[1000,1000],[0,1000]];
const rules={
  constraints:{'1170000001':{scaleRange:[0.7,1.3],rotationAllowed:{x:true,y:true,z:true}},
               '1170000002':{scaleRange:[1,1],rotationAllowed:{x:false,y:false,z:true}}},
  dyeSchemes:{'1170000001':[11,12,21],'1170000002':[31]},
  polygons:{'1-1':SQUARE},
  unlocks:[{desc:'初始解锁',polygons:['1-1']}],
};
const row=(over={})=>Object.assign({ItemID:1170000001,InstanceID:1,Location:{X:500,Y:500,Z:100},
  Rotation:{Roll:0,Pitch:0,Yaw:45},Scale:{X:1,Y:1,Z:1}},over);
const check=rows=>validateSave({PlaceInfo:rows},rules,{name:'synthetic.json'});

// --- scale and rotation ---
let r=check([row()]);
assert.equal(r.scale.length,0);assert.equal(r.rotation.length,0);assert.equal(r.unknown.length,0);
r=check([row({Scale:{X:2,Y:1,Z:1}})]);
assert.deepEqual(r.scale,[0]);assert.deepEqual(r.rotation,[]);
r=check([row({ItemID:1170000002,Rotation:{Roll:30,Pitch:10,Yaw:0}})]);
assert.deepEqual(r.rotation,[0]);assert.deepEqual(r.scale,[]);
console.log('PASS: scale range and forbidden axes are reported');

// --- buildable area ---
assert.deepEqual(check([row({Location:{X:5000,Y:500,Z:100}})]).bounds,[0]);
assert.deepEqual(check([row({Location:{X:500,Y:500,Z:-4000}})]).bounds,[0],'below the plot floor');
const world=validateSave({PlaceInfo:[row({Location:{X:5000,Y:500,Z:100}})]},rules,{name:'WORLDBUILD_x.json'});
assert.equal(world.bounds.length,0,'world edits skip the placement bounds');
assert.ok(pointInPolygon([500,500],SQUARE)&&!pointInPolygon([-1,500],SQUARE));
console.log('PASS: the buildable polygon and its z range are enforced');

// --- colours ---
assert.deepEqual(dyeCodes({1:11,2:0,3:21}),[11,21]);
assert.deepEqual(dyeCodes([0,12]),[12]);
r=check([row({ColorMap:{1:11,2:21}})]);
assert.deepEqual(r.colors,[]);
r=check([row({ColorMap:{1:19}})]);
assert.deepEqual(r.colors,[{index:0,problem:'invalid'}]);
r=check([row({ColorMap:{1:11,2:21,3:12}})]);
assert.deepEqual(r.colors,[{index:0,problem:'conflict'}],'areas 1 and 1 collide');
r=check([row({ColorMap:[11,12]})]);
assert.deepEqual(r.colors,[{index:0,problem:'conflict'}],'the array form can repeat an area');
r=check([row({ColorMap:{1:11,2:21}})]);
assert.deepEqual(r.colors,[],'one preset per area is fine');
console.log('PASS: unsupported presets and conflicting areas are reported');

// --- colours do not depend on a build rule ---
const bare={constraints:{},dyeSchemes:{'1170000009':[11]},polygons:{},unlocks:[]};
r=validateSave({PlaceInfo:[row({ItemID:1170000009,ColorMap:{1:19}})]},bare,{name:'x.json'});
assert.deepEqual(r.colors,[{index:0,problem:'invalid'}]);
assert.deepEqual(r.unknown,[0]);
assert.deepEqual(cleanedDye({1:19,2:12,3:21},[11,12,21]),{1:12,2:21});
assert.deepEqual(cleanedDye({1:19,2:12,3:21},[11,12]),{1:12},'unsupported areas are dropped');
assert.deepEqual(cleanedDye([0,19,12],[11,12]),[12]);
console.log('PASS: dye is checked even when the item has no build rule');

// --- corrected export ---
const source={PlaceInfo:[row({Scale:{X:2,Y:2,Z:2},ColorMap:{1:19,2:12}})]};
const fixed=correctedSave(source,rules,check(source.PlaceInfo),{});
assert.deepEqual(fixed.PlaceInfo[0].Scale,{X:1.3,Y:1.3,Z:1.3});
assert.deepEqual(fixed.PlaceInfo[0].ColorMap,{1:12},'keyed by the area the code packs');
assert.deepEqual(source.PlaceInfo[0].Scale,{X:2,Y:2,Z:2},'the source is never mutated');
const locked={PlaceInfo:[row({ItemID:1170000002,Rotation:{Roll:30,Pitch:10,Yaw:90}})]};
assert.equal(correctedSave(locked,rules,check(locked.PlaceInfo),{}).PlaceInfo[0].Rotation.Roll,0);
assert.equal(correctedSave(locked,rules,check(locked.PlaceInfo),{}).PlaceInfo[0].Rotation.Yaw,90,'yaw stays');
console.log('PASS: corrected export clamps, unlocks yaw and cleans unsupported dye');

// --- unknown items are named, never guessed ---
r=check([row({ItemID:1170000999})]);
assert.deepEqual(r.unknown,[0]);assert.deepEqual(r.scale,[]);
console.log('PASS: an item with no rule is reported instead of constrained');
