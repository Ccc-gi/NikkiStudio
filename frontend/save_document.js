// Own the complete save document. Rendering is a projection, never the export source.
const copy = value => structuredClone(value);
export class SaveDocument {
  constructor(raw, name='家园存档.json') {
    const empty=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===0;
    this.key=Array.isArray(raw)?null:['Snapshots','PlaceInfo'].find(k=>Array.isArray(raw?.[k])||empty(raw?.[k]));
    if(!Array.isArray(raw)&&!this.key)throw Error('存档需要 Snapshots 或 PlaceInfo 数组');
    this.emptyObjectCollection=!!this.key&&empty(raw[this.key]);
    this.data=copy(raw);this.name=name;this.undoStack=[];this.redoStack=[];this.revision=0;this.savedRevision=0;this.nextRevision=1;
  }
  get data(){return this.emptyObjectCollection&&this.rows.length===0?{...this._data,[this.key]:{}}:this._data;}
  set data(value){this._data=value;if(this.key&&value[this.key]!==null&&!Array.isArray(value[this.key])&&Object.keys(value[this.key]).length===0)value[this.key]=[];}
  get rows(){return this.key?this._data[this.key]:this._data;}
  get dirty(){return this.revision!==this.savedRevision;}
  dyeMany(changes){
    const patches=changes.map(({index,colors})=>{
      const before=copy(this.rows[index]),after=copy(before);
      if(after.furnitureInfo)after.furnitureInfo.colors=copy(colors);
      else if(after.extra?.ColorMap!==undefined&&after.ColorMap===undefined)after.extra.ColorMap=copy(colors);
      else after.ColorMap=copy(colors);
      return {index,before,after};
    }).filter(p=>JSON.stringify(p.before)!==JSON.stringify(p.after));
    if(!patches.length)return false;
    const revision=this.nextRevision++;
    for(const p of patches)this.rows[p.index]=copy(p.after);
    this.undoStack.push({label:'修改染色',patches,from:this.revision,to:revision});
    if(this.undoStack.length>30)this.undoStack.shift();
    this.changedIndices=patches.map(p=>p.index);this.revision=revision;this.redoStack=[];return true;
  }
  commit(label, mutate){const before=copy(this.data);mutate(this.rows);const after=copy(this.data);if(JSON.stringify(before)===JSON.stringify(after))return false;const revision=this.nextRevision++;this.undoStack.push({label,before,after,from:this.revision,to:revision});if(this.undoStack.length>30)this.undoStack.shift();this.revision=revision;this.redoStack=[];return true;}
  undo(){const c=this.undoStack.pop();if(!c)return;if(c.splices)this.applySplices(c.splices,true);else if(c.patches)for(const p of c.patches)this.rows[p.index]=copy(p.before);else if(c.index!==undefined)this.rows[c.index]=copy(c.before);else this.data=copy(c.before);this.changedIndices=c.patches?c.patches.map(p=>p.index):c.index!==undefined?[c.index]:null;this.revision=c.from;this.redoStack.push(c);return c.label;}
  redo(){const c=this.redoStack.pop();if(!c)return;if(c.splices)this.applySplices(c.splices,false);else if(c.patches)for(const p of c.patches)this.rows[p.index]=copy(p.after);else if(c.index!==undefined)this.rows[c.index]=copy(c.after);else this.data=copy(c.after);this.changedIndices=c.patches?c.patches.map(p=>p.index):c.index!==undefined?[c.index]:null;this.revision=c.to;this.undoStack.push(c);return c.label;}
  transform(index, value){const before=copy(this.rows[index]),row=copy(before);if(row.furnitureInfo){const t=row.furnitureInfo.trans??={};for(const k of ['position','rotation','scale'])t[k]={...t[k],...value[k]};}else{row.Location={...row.Location,X:value.position.x,Y:value.position.y,Z:value.position.z};row.Rotation={...row.Rotation,Pitch:value.rotation.x,Yaw:value.rotation.y,Roll:value.rotation.z};row.Scale={...row.Scale,X:value.scale.x,Y:value.scale.y,Z:value.scale.z};}if(JSON.stringify(before)===JSON.stringify(row))return false;const revision=this.nextRevision++;this.rows[index]=row;this.undoStack.push({label:'修改变换',index,before,after:copy(row),from:this.revision,to:revision});if(this.undoStack.length>30)this.undoStack.shift();this.changedIndices=[index];this.revision=revision;this.redoStack=[];return true;}
  transformMany(changes){
    // Prepare all patches before modifying the document; one gesture is one undo.
    const patches=changes.map(({index,value})=>{
      const before=copy(this.rows[index]),after=copy(before);
      if(after.furnitureInfo){const t=after.furnitureInfo.trans??={};for(const k of ['position','rotation','scale'])t[k]={...t[k],...value[k]};}
      else{after.Location={...after.Location,X:value.position.x,Y:value.position.y,Z:value.position.z};after.Rotation={...after.Rotation,Pitch:value.rotation.x,Yaw:value.rotation.y,Roll:value.rotation.z};after.Scale={...after.Scale,X:value.scale.x,Y:value.scale.y,Z:value.scale.z};}
      return{index,before,after};
    }).filter(p=>JSON.stringify(p.before)!==JSON.stringify(p.after));
    if(!patches.length)return false;
    const revision=this.nextRevision++;
    for(const p of patches)this.rows[p.index]=copy(p.after);
    this.undoStack.push({label:'修改变换',patches,from:this.revision,to:revision});
    if(this.undoStack.length>30)this.undoStack.shift();this.changedIndices=patches.map(p=>p.index);this.revision=revision;this.redoStack=[];return true;
  }
  nextId(){return Math.max(0,...this.rows.map(r=>Number(r.instanceID??r.InstanceID)||0))+1;}
  duplicate(index){return this.duplicateMany([index])[0];}
  add(item,position,rotation={x:0,y:0,z:0}){const id=this.nextId();this.commit('添加物品',rows=>{rows.push(this.key==='PlaceInfo'?{ItemID:Number(item),InstanceID:id,Location:{X:position.x,Y:position.y,Z:position.z},Rotation:{Pitch:rotation.x,Yaw:rotation.y,Roll:rotation.z},Scale:{X:1,Y:1,Z:1}}:{bIsAdd:false,instanceID:id,furnitureInfo:{group_id:0,attach_id:0,cfg_item_id:Number(item),colors:[0],trans:{position:copy(position),rotation:copy(rotation),scale:{x:1,y:1,z:1}}},extra:{TempInfo:{}}});});return this.rows.length-1;}
  applySplices(splices,undo=false){
    const ordered=[...splices].sort((a,b)=>undo?a.index-b.index:b.index-a.index);
    for(const p of ordered)this.rows.splice(p.index,(undo?p.added:p.removed).length,...copy(undo?p.removed:p.added));
  }
  commitSplices(label,splices){
    if(!splices.length)return false;
    this.applySplices(splices);const revision=this.nextRevision++;
    this.undoStack.push({label,splices,from:this.revision,to:revision});
    if(this.undoStack.length>30)this.undoStack.shift();this.revision=revision;this.redoStack=[];this.changedIndices=null;return true;
  }
  remove(index){return this.removeMany([index]);}
  removeMany(indices){return this.commitSplices('删除物品',[...new Set(indices)].sort((a,b)=>a-b).map(index=>({index,removed:[copy(this.rows[index])],added:[]})));}
  duplicateMany(indices,positions=null,rotations=null){
    let id=this.nextId();const start=this.rows.length;
    const added=indices.map((index,i)=>{const row=copy(this.rows[index]);if(row.furnitureInfo){row.instanceID=id++;if(positions)row.furnitureInfo.trans.position={...row.furnitureInfo.trans.position,...positions[i]};else row.furnitureInfo.trans.position.x+=100;row.furnitureInfo.attach_id=0;row.furnitureInfo.group_id=0;}else{row.InstanceID=id++;if(positions)row.Location={...row.Location,X:positions[i].x,Y:positions[i].y,Z:positions[i].z};else row.Location.X+=100;}if(rotations){const r=rotations[i];if(row.furnitureInfo)row.furnitureInfo.trans.rotation=copy(r);else row.Rotation={...row.Rotation,Pitch:r.x,Yaw:r.y,Roll:r.z};}return row;});
    this.commitSplices('复制物品',added.length?[{index:start,removed:[],added}]:[]);return added.map((_,i)=>start+i);
  }
  serialize(){return JSON.stringify(this.data,null,2);}
}
