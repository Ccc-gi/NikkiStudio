// Color codes identify an area and a game preset, not an RGB color.
export const dyeColorsForRow=row=>row?.furnitureInfo?.colors??row?.ColorMap??row?.extra?.ColorMap;
export function setDyeArea(colors,area,index){
  const group=Number(area),value=Number(index);
  if(!Number.isInteger(group)||group<0||!Number.isInteger(value)||value<0||value>9)throw Error('无效染色方案');
  if(colors&&!Array.isArray(colors)&&typeof colors==='object'){
    const result={...colors};if(value)result[group]=group*10+value;else delete result[group];return result;
  }
  // Preserve other areas and unknown codes when changing one supported area.
  const result=(Array.isArray(colors)?colors:[]).filter(raw=>{
    const n=Number(raw);return !Number.isInteger(n)||n<0||(n<10?0:Math.floor(n/10))!==group;
  });
  if(value)result.push(group*10+value);
  const active=result.filter(n=>Number(n)!==0);return active.length?active:[0];
}
export function decodeDyeColors(colors){
  const groups=new Map();
  for(const [key,raw] of Object.entries(colors??{})){
    const n=Number(raw);if(!Number.isInteger(n)||n<=0)continue;
    const group=Array.isArray(colors)?(n<10?0:Math.floor(n/10)):Number(key);
    const index=n<10?n:n%10;if(index&&Number.isInteger(group))groups.set(group,index);
  }
  return groups;
}
export function resolveDyePlan(config,colors){
  const groups=decodeDyeColors(colors),slots={},missing=[];
  for(const [group,index] of groups)if(!config?.[group]?.[index])missing.push(`区域 ${group} 配色 ${index}`);
  for(const [group,choices] of Object.entries(config??{})){
    const entry=choices[groups.get(Number(group))??0];
    for(const [slot,pattern,tint] of entry?.cfg??[])slots[slot]={pattern,tint};
  }
  return {slots,missing,requested:groups.size>0,key:JSON.stringify(slots)};
}
export function resolveDyeDescriptor(base,registry,choice={pattern:0,tint:0}){
  if(!registry)return {desc:base,issues:choice.pattern||choice.tint?['缺少材质变体映射']:[]};
  const v=registry.variants,desc={...base},issues=[];
  if(registry.foliage&&!Object.keys(v.palette??{}).length&&v.color?.[choice.tint])choice={...choice,pattern:choice.tint};
  if(!choice.pattern&&!v.palette?.[choice.tint]&&v.color?.[choice.tint])choice={...choice,pattern:choice.tint};
  for(const field of ['color','normal','orm']){
    const table=v[field]??{}, selected=table[choice.pattern];
    if(selected)desc[field]=selected;
    else if(table[0])desc[field]=table[0];
    // A single fixed diffuse is shared by all palette presets (Momo falls back
    // to D0 too). Only an actual array needs a distinct pattern layer.
    if(field==='color'&&choice.pattern&&!selected&&Object.keys(table).length>1)issues.push(`缺少纹理 ${choice.pattern}`);
  }
  if(desc.orm?.includes('ORM'))desc.ormLayout='ORM';
  const palette=v.palette?.[choice.tint];
  if(palette){desc.dyePalette=palette;desc.dyeMask=desc.orm;if(!desc.dyeMask)issues.push('缺少染色遮罩');}
  else if(choice.tint&&!registry.foliage&&!(choice.pattern===choice.tint&&v.color?.[choice.pattern]))issues.push(`缺少调色贴图 ${choice.tint}`);
  // Foliage diffuse arrays contain the complete colored atlas already.
  return {desc,issues};
}
export function applyDyeShader(material,palette,mask){
  const prior=material.onBeforeCompile,priorKey=material.customProgramCacheKey.bind(material);
  material.onBeforeCompile=shader=>{
    prior.call(material,shader);
    shader.uniforms.nikkiDyePalette={value:palette};shader.uniforms.nikkiDyeMask={value:mask};
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute vec2 uv2;\nvarying vec2 nikkiDyeUV;\nvarying vec2 nikkiMaskUV;').replace('#include <begin_vertex>','#include <begin_vertex>\nnikkiDyeUV=uv2;\nnikkiMaskUV=uv;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform sampler2D nikkiDyePalette;\nuniform sampler2D nikkiDyeMask;\nvarying vec2 nikkiDyeUV;\nvarying vec2 nikkiMaskUV;').replace('#include <map_fragment>',`#include <map_fragment>
      vec3 nikkiTint=texture2D(nikkiDyePalette,nikkiDyeUV).rgb;
      float nikkiMask=texture2D(nikkiDyeMask,nikkiMaskUV).a;
      float nikkiBoost=1.0/max(dot(nikkiTint,vec3(0.299,0.587,0.114)),0.4);
      diffuseColor.rgb=mix(diffuseColor.rgb,clamp(diffuseColor.rgb*nikkiTint*nikkiBoost,0.0,1.0),nikkiMask);`);
  };
  material.customProgramCacheKey=()=>priorKey()+'|nikki-dye-v1';material.needsUpdate=true;
}
