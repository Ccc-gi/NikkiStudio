import assert from 'node:assert/strict';
import {SaveDocument} from '../frontend/save_document.js';
import {NO_ANCHOR,groundAnchor,savePositionToScene,scenePositionToSave} from '../frontend/preset_geometry.js';

// --- preset geometry ---
const anchor={x:120,y:-150,z:340};
const scene={x:12.5,y:3.25,z:-7.75};
const save=scenePositionToSave(scene,anchor);
assert.deepEqual(save,{x:(12.5-120)*100,y:(-7.75-340)*100,z:(3.25+150)*100},'x and z come from scene x and z');
assert.deepEqual(savePositionToScene(save,anchor),scene,'the conversion round-trips');
assert.deepEqual(scenePositionToSave(scene),{x:1250,y:-775,z:325},'without an anchor it is a plain unit change');
assert.deepEqual(savePositionToScene({x:0,y:0,z:0}),NO_ANCHOR);
assert.deepEqual(groundAnchor({min:{x:0,y:10,z:-4},max:{x:20,y:30,z:6}}),{x:10,y:10,z:1},
  'the anchor is the bottom centre of the group');
console.log('PASS: preset positions convert between scene and save space and round-trip');

// --- one gesture is one undo step ---
const source={NeedRestore:true,Snapshots:[
  {bIsAdd:false,instanceID:40,furnitureInfo:{group_id:0,attach_id:0,cfg_item_id:1170000001,colors:[0],
    trans:{position:{x:1,y:2,z:3},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}},extra:{TempInfo:{}}},
]};
const entry=id=>({bIsAdd:false,instanceID:0,extra:{TempInfo:{}},
  furnitureInfo:{group_id:7,attach_id:0,cfg_item_id:id,colors:[0],
    trans:{position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}}});
const document_=new SaveDocument(source,'synthetic.json');
const before=JSON.parse(document_.serialize());
const indices=document_.addItems([entry(1170001276),entry(1170001277),entry(1170001278)]);
assert.deepEqual(indices,[1,2,3]);
assert.equal(document_.rows.length,4);
assert.deepEqual(document_.rows.slice(1).map(r=>r.instanceID),[41,42,43],'ids continue from the highest in use');
assert.deepEqual(document_.rows.slice(1).map(r=>r.furnitureInfo.group_id),[0,0,0],'grouping is dropped like duplicate does');
assert.deepEqual(document_.rows.slice(1).map(r=>r.furnitureInfo.cfg_item_id),[1170001276,1170001277,1170001278]);
document_.undo();
assert.deepEqual(JSON.parse(document_.serialize()),before,'a whole preset is one undo');
document_.redo();
assert.equal(document_.rows.length,4);
console.log('PASS: placing a preset adds every row as one undo step');

// --- the shape the rest of the editor reads ---
const placed=document_.rows[1];
assert.equal(placed.instanceID,41);
assert.equal(placed.furnitureInfo.trans.position.x,0);
assert.equal(placed.extra.TempInfo!==undefined,true,'extra is kept so unrelated fields survive');
console.log('PASS: placed rows keep the save shape the editor reads');

// --- the PlaceInfo collection works too ---
const legacy=new SaveDocument({PlaceInfo:[{ItemID:1170000001,InstanceID:5,Location:{X:0,Y:0,Z:0}}]},'legacy.json');
assert.deepEqual(legacy.addItems([{InstanceID:0,ItemID:1170001276,Location:{X:1,Y:2,Z:3}}]),[1]);
assert.equal(legacy.rows[1].InstanceID,6);
console.log('PASS: the PlaceInfo collection gets instance ids the same way');

// --- a row the editor creates is marked as newly added ---
// The game marks exactly its newest rows this way, and reconciles anything left
// unmarked against what it already has.
const fresh=new SaveDocument({Snapshots:[source.Snapshots[0]]},'fresh.json');
fresh.add(1170001276,{x:0,y:0,z:0});
assert.equal(fresh.rows[1].bIsAdd,true,'add() marks the new row as added');
fresh.duplicateMany([1]);
assert.equal(fresh.rows[2].bIsAdd,true,'a duplicate is a new row too');
console.log('PASS: newly created rows carry the flag the game reads');

// --- a freed instance id is never handed out again ---
// The game keeps its own item type for any instance id it has already seen, so a
// new row that takes an id a delete just freed comes back as the deleted item.
const three={NeedRestore:true,Snapshots:[
  {...entry(1170000001),instanceID:40},
  {...entry(1170000002),instanceID:41},
  {...entry(1170000003),instanceID:42},
]};
const freed=new SaveDocument(three,'freed.json');
freed.removeMany([1,2]);
freed.add(1170000004,{x:0,y:0,z:0});
assert.equal(freed.rows.at(-1).instanceID,43,'a new row clears the highest id the loaded save reached');
assert.deepEqual(freed.rows.map(r=>r.instanceID),[40,43],'the deleted ids stay retired');
console.log('PASS: an id freed by a delete is not reused');

// --- a group keeps its layout wherever it lands ---
const relative=[{x:0,y:0,z:0},{x:250,y:0,z:-125},{x:-250,y:0,z:125}];
const drop={x:88.5,y:-40,z:12.25};
const dropSave=scenePositionToSave(drop);
const landed=relative.map(position=>{
  const scene=savePositionToScene(position);
  return scenePositionToSave({x:scene.x+drop.x,y:scene.y+drop.y,z:scene.z+drop.z});
});
const offsets=landed.map(point=>({x:point.x-dropSave.x,y:point.y-dropSave.y,z:point.z-dropSave.z}));
assert.deepEqual(offsets,relative,'dropping a preset moves it without distorting the group');
console.log('PASS: a placed preset keeps its internal layout and follows the drop point');
