import assert from 'node:assert/strict';
import {SaveDocument} from '../frontend/save_document.js';
const source={futureMetadata:{keep:['未知字段',42]},PlaceInfo:[{ItemID:1170000001,InstanceID:1,Location:{X:100,Y:200,Z:300},Rotation:{Pitch:0,Yaw:90,Roll:0},Scale:{X:1,Y:1,Z:1},unknown:{keep:true},ColorMap:[1,2]}]};
const doc=new SaveDocument(source,'synthetic.json');assert.deepEqual(JSON.parse(doc.serialize()),source);
doc.transform(0,{position:{x:123,y:200,z:300},rotation:{x:0,y:90,z:0},scale:{x:1,y:1,z:1}});
const expected=structuredClone(source);expected.PlaceInfo[0].Location.X=123;
assert.deepEqual(JSON.parse(doc.serialize()),expected);doc.undo();assert.deepEqual(doc.data,source);doc.redo();assert.deepEqual(doc.data,expected);
doc.duplicate(0);assert.equal(new Set(doc.rows.map(r=>r.InstanceID)).size,2);doc.undo();assert.deepEqual(doc.data,expected);
console.log('PASS: synthetic save edit/export/undo/duplicate preserves every unrelated field');
for(const key of ['Snapshots','PlaceInfo']){
  const raw={NeedRestore:true,[key]:{},unknown:{keep:true}},empty=new SaveDocument(raw);
  assert.equal(empty.rows.length,0);assert.deepEqual(JSON.parse(empty.serialize()),raw);
  empty.add(1170000001,{x:1,y:2,z:3});assert.equal(empty.rows.length,1);assert.ok(Array.isArray(empty.data[key]));
  empty.undo();assert.deepEqual(JSON.parse(empty.serialize()),raw);empty.redo();assert.equal(empty.rows.length,1);
}
// --- an imported save takes the identities the game already assigned ---
// The game keeps its own type for an instance id it has seen, so a row carried in
// from elsewhere that lands on such an id would come back as the other item.
const row=(instanceID,cfg_item_id,attach_id=0)=>({bIsAdd:false,instanceID,
  furnitureInfo:{group_id:0,attach_id,cfg_item_id,colors:[0],
    trans:{position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}},extra:{}});
const onDisk={Snapshots:[row(100,1170000001),row(101,1170000002),row(900,1170000009)]};
const imported=new SaveDocument({Snapshots:[row(100,1170000001),row(101,1170000007),row(500,1170000008,101)]},'imported.json');
assert.equal(imported.alignInstanceIds(onDisk),1,'only the row the save disagrees about moves');
assert.deepEqual(imported.rows.map(r=>r.instanceID),[100,901,500],'the moved row clears every id either side used');
assert.equal(imported.rows[2].furnitureInfo.attach_id,901,'what hung on the moved row moves with it');
assert.equal(imported.rows[0].furnitureInfo.cfg_item_id,1170000001,'an agreeing row keeps its id');
assert.equal(imported.alignInstanceIds(onDisk),0,'aligning again against the same save changes nothing');
imported.add(1170000005,{x:0,y:0,z:0});
assert.equal(imported.rows.at(-1).instanceID,902,'a row added afterwards clears the new ceiling');
console.log('PASS: an imported save is renumbered where the game already owns the id');
const {createQueue}=await import('../frontend/asset_loading.js');
const q=createQueue(1);let finish,unexpected=0;
const first=q(()=>new Promise(resolve=>{finish=resolve;}));await Promise.resolve();
const second=q(()=>{unexpected++;}).catch(e=>e.name);q.cancelPending();
assert.equal(await second,'AbortError');finish();await first;assert.equal(unexpected,0);
console.log('PASS: empty game collections round-trip; superseded queued requests are canceled');
