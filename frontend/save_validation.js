// Core rules adapted from BuildingMomo (MIT, ChanIok 2025).
// See BuildingMomo-LICENSE.txt. All values here are SAVE coordinates, in cm.
import {dyeColorsForRow} from './furniture_dye.js';
export const EPSILON=1e-6;
export function saveRows(data){const rows=Array.isArray(data)?data:data.Snapshots??data.PlaceInfo;if(rows&&typeof rows==='object'&&!Array.isArray(rows)&&Object.keys(rows).length===0)return [];if(!Array.isArray(rows))throw Error('存档需要 Snapshots 或 PlaceInfo 数组');return rows;}
export function validationItem(row,index){
  const f=row.furnitureInfo,t=f?.trans;
  return {index,id:Number(f?.cfg_item_id??row.ItemID),instance:row.instanceID??row.InstanceID,group:Number(f?.group_id??row.GroupID??0),
    position:t?[t.position?.x??0,t.position?.y??0,t.position?.z??0]:[row.Location?.X??0,row.Location?.Y??0,row.Location?.Z??0],
    rotation:t?[t.rotation?.z??0,t.rotation?.x??0,t.rotation?.y??0]:[row.Rotation?.Roll??0,row.Rotation?.Pitch??0,row.Rotation?.Yaw??0],
    scale:t?[t.scale?.x??1,t.scale?.y??1,t.scale?.z??1]:[row.Scale?.X??1,row.Scale?.Y??1,row.Scale?.Z??1],
    colors:dyeColorsForRow(row)};
}
// A dye code packs the area and the preset the player chose: area 1 preset 8 is 18.
export function dyeCodes(colors){
  const values=Array.isArray(colors)?colors:Object.values(colors??{});
  return values.map(Number).filter(v=>Number.isInteger(v)&&v>0&&v%10);
}
export function pointInPolygon([x,y],polygon){let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const [xi,yi]=polygon[i],[xj,yj]=polygon[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside;}return inside;}
export function validateItems(items,rules,{name=''}={}){
  const result={duplicates:[],bounds:[],scale:[],rotation:[],colors:[],groups:[],unknown:[],malformed:[],instanceIds:[],count:items.length};
  const exact=new Map(),groups=new Map(),instances=new Map(),polygons=Object.values(rules.polygons),world=name.startsWith('WORLDBUILD_');
  for(const a of items){
    if(!Number.isFinite(a.id)||a.id<=0||![...a.position,...a.rotation,...a.scale].every(v=>typeof v==='number'&&Number.isFinite(v))){result.malformed.push(a.index);continue;}
    const key=JSON.stringify([a.id,...a.position,...a.rotation,...a.scale]);if(!exact.has(key))exact.set(key,[]);exact.get(key).push(a.index);
    if(a.group>0){if(!groups.has(a.group))groups.set(a.group,[]);groups.get(a.group).push(a.index);}
    const instance=String(a.instance);if(a.instance==null||!Number.isFinite(Number(a.instance)))result.instanceIds.push(a.index);else{if(!instances.has(instance))instances.set(instance,[]);instances.get(instance).push(a.index);}
    if(!world&&(a.position[2]<-3500||a.position[2]>10200||polygons.length&&!polygons.some(p=>pointInPolygon(a.position,p))))result.bounds.push(a.index);
    // Colors are checked before the build limit, so an item with no scale or
    // rotation rule still gets its dye validated.
    const codes=dyeCodes(a.colors),schemes=rules.dyeSchemes?.[String(a.id)];
    if(schemes&&codes.length){
      if(codes.some(code=>!schemes.includes(code)))result.colors.push({index:a.index,problem:'invalid'});
      const areas=codes.map(code=>Math.trunc(code/10));if(new Set(areas).size!==areas.length)result.colors.push({index:a.index,problem:'conflict'});
    }
    const c=rules.constraints[String(a.id)];if(!c){result.unknown.push(a.index);continue;}
    const [min,max]=c.scaleRange;if(a.scale.some(s=>s<min-EPSILON||s>max+EPSILON))result.scale.push(a.index);
    if((!c.rotationAllowed.x&&Math.abs(a.rotation[0])>EPSILON)||(!c.rotationAllowed.y&&Math.abs(a.rotation[1])>EPSILON))result.rotation.push(a.index);
  }
  result.duplicates=[...exact.values()].filter(g=>g.length>1);
  result.groups=[...groups].filter(([,g])=>g.length>50).map(([id,indices])=>({id,indices}));
  for(const g of instances.values())if(g.length>1)result.instanceIds.push(...g);
  result.instanceIds=[...new Set(result.instanceIds)];return result;
}
export function validateSave(data,rules,options){return validateItems(saveRows(data).map(validationItem),rules,options);}
// Export corrections only affect a copy. Unknown fields and root metadata survive.
// Keep one valid preset per area and drop the rest, matching how the game
// writes a colour map back out.
export function cleanedDye(colors,schemes){
  const kept=new Map();
  for(const code of dyeCodes(colors))if(schemes.includes(code))kept.set(Math.trunc(code/10),code);
  const values=[...kept.values()].sort((a,b)=>a-b);
  return Array.isArray(colors)?(values.length?values:[0]):Object.fromEntries(values.map(code=>[Math.trunc(code/10),code]));
}
export function correctedSave(data,rules,result,{removeDuplicates=false}={}){
  if(result.malformed.length||result.instanceIds.length)throw Error('请先修复无效数值或实例 ID 冲突，无法自动安全修正。');
  const output=structuredClone(data),rows=saveRows(output),drop=new Set(result.bounds);
  if(removeDuplicates)for(const g of result.duplicates)for(const i of g.slice(1))drop.add(i);
  const scales=new Set(result.scale),rotations=new Set(result.rotation),groups=new Set(result.groups.map(g=>g.id)),
        colorIssues=new Set(result.colors.map(issue=>issue.index));
  rows.forEach((row,index)=>{
    const a=validationItem(row,index),c=rules.constraints[String(a.id)],t=row.furnitureInfo?.trans;
    if(groups.has(a.group)){if(row.furnitureInfo)row.furnitureInfo.group_id=0;else row.GroupID=0;}
    if(scales.has(index)){const keys=t?['x','y','z']:['X','Y','Z'],s=t?(t.scale??={}):(row.Scale??={});keys.forEach((k,i)=>s[k]=Math.max(c.scaleRange[0],Math.min(c.scaleRange[1],a.scale[i])));}
    if(rotations.has(index)){const r=t?(t.rotation??={}):(row.Rotation??={});if(!c.rotationAllowed.x)r[t?'z':'Roll']=0;if(!c.rotationAllowed.y)r[t?'x':'Pitch']=0;}
    if(colorIssues.has(index)){
      const cleaned=cleanedDye(a.colors,rules.dyeSchemes?.[String(a.id)]??[]);
      if('colors' in (row.furnitureInfo??{}))row.furnitureInfo.colors=cleaned;
      else if('ColorMap' in row)row.ColorMap=cleaned;
      else if('ColorMap' in (row.extra??{}))row.extra.ColorMap=cleaned;
    }
  });
  const kept=rows.filter((_,i)=>!drop.has(i));if(Array.isArray(output))return kept;const key='Snapshots' in output?'Snapshots':'PlaceInfo';if(Array.isArray(output[key])||kept.length)output[key]=kept;return output;
}
