// Reconcile the output copy only. Cancelled/failed writes must not change editor
// nodes, undo history or the imported document's identities.
const rowsOf=data=>{const rows=Array.isArray(data)?data:data?.Snapshots??data?.PlaceInfo??[];return rows&&typeof rows==='object'&&!Array.isArray(rows)&&Object.keys(rows).length===0?[]:rows;};
const idOf=row=>Number(row.instanceID??row.InstanceID);
const typeOf=row=>Number(row.furnitureInfo?.cfg_item_id??row.ItemID);
export function prepareSaveIdentities(data,current,{floor=0}={}){
  const output=structuredClone(data),rows=rowsOf(output),existing=rowsOf(current);
  if(!Array.isArray(rows)||!Array.isArray(existing))throw Error('无法读取存档物品数组');
  const seen=new Set(),known=new Map();let top=floor;
  if(!Number.isSafeInteger(top)||top<0)throw Error('编号记录损坏，无法安全保存');
  for(const list of [rows,existing])for(const row of list){
    const id=idOf(row);
    if(!Number.isSafeInteger(id)||id<=0)throw Error('存档包含无效实例编号，无法安全保存');
    top=Math.max(top,id);
  }
  for(const row of existing){const id=idOf(row);if(known.has(id))throw Error('游戏存档包含重复实例编号');known.set(id,typeOf(row));}
  const moved=new Map();
  for(const row of rows){
    const id=idOf(row);
    if(seen.has(id))throw Error('导入存档包含重复实例编号，请先修复');seen.add(id);
    // Keep identities only when the selected current save confirms the type.
    // Missing ids may belong to deleted game objects, so do not reuse them.
    if(known.get(id)!==typeOf(row)){
      if(top>=2147483647)throw Error('实例编号超过支持范围，无法安全分配');
      moved.set(id,++top);
    }
  }
  for(const row of rows){
    const id=idOf(row);
    if(moved.has(id)){if(row.furnitureInfo)row.instanceID=moved.get(id);else row.InstanceID=moved.get(id);}
    for(const owner of [row,row.furnitureInfo])if(owner&&moved.has(Number(owner.attach_id)))owner.attach_id=moved.get(Number(owner.attach_id));
  }
  return {data:output,floor:top,changed:moved.size};
}
export function reserveSaveIdentities(storage,key,data,current){
  const name='nikki-studio-instance-ceiling:'+key;
  const raw=storage.getItem(name),floor=raw===null?0:Number(raw);
  const prepared=prepareSaveIdentities(data,current,{floor});
  // Reserve before writing/downloading; a failed write merely leaves a gap.
  storage.setItem(name,String(prepared.floor));
  return prepared;
}
