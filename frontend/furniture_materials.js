import * as T from 'three';
import {KTX2Loader} from 'three/addons/loaders/KTX2Loader.js';
import {textureQueue,textureBlob,textureBuffer} from './asset_loading.js';
import {applyFoliageShading} from './foliage_material.js';
import {applyRockGrass} from './rock_grass_material.js';
import {resolveDyePlan,resolveDyeDescriptor,applyDyeShader} from './furniture_dye.js';
import {applyTextureQuality} from './texture_quality.js';

let dyeManifest=fetch('/furniture_dye_manifest.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('染色映射加载失败');return r.json();});
export function updateDyeManifest(data){dyeManifest=Promise.resolve(data);}
export async function furnitureDyeConfig(id){return (await dyeManifest).configs[String(id)]??null;}
export async function furnitureDyeContext(id,colors,partIndex=0){
  const data=await dyeManifest,plan=resolveDyePlan(data.configs[String(id)],colors);
  return {...plan,offset:data.parts[String(id)]?.[partIndex]?.offset??0};
}

const textureCache = new Map(), materialCache = new Map();
export const materialDiagnostics = {errors: new Set(), textured: new Set(), fallback: new Set(), mipmapped:new Set()};
let manifestPromise = fetch('/scene_material_manifest.json').then(r => {
  if (!r.ok) throw new Error('材质映射加载失败');
  return r.json();
});
export function updateMaterialManifest(data){manifestPromise=Promise.resolve(data);}
const loader = new T.TextureLoader();
const gpuLoader=new KTX2Loader();let textureRenderer;
export function setTextureRenderer(renderer){textureRenderer=renderer;gpuLoader.detectSupport(renderer);}
async function loadTexture(url,quality){
  if(url.endsWith('.ktx2')){
    const buffer=await textureBuffer(url);
    const format=new DataView(buffer).getUint32(12,true);
    const extension=format===145?'EXT_texture_compression_bptc':format===139||format===141?'EXT_texture_compression_rgtc':'WEBGL_compressed_texture_s3tc';
    if(!textureRenderer?.extensions.has(extension))return loadTexture(url.replace('/asset/','/api/texture-png/').replace('.ktx2','.png'),quality);
    return new Promise((resolve,reject)=>gpuLoader.parse(buffer,t=>resolve(applyTextureQuality(t,quality)),reject));
  }
  const objectUrl=URL.createObjectURL(await textureBlob(url,quality));
  try{return await loader.loadAsync(objectUrl);}finally{URL.revokeObjectURL(objectUrl);}
}
export const clayMaterial = new T.MeshStandardMaterial({color:0xc9d5dc, roughness:.8, side:T.DoubleSide});
async function texture(url, color = false, quality='preview') {
  if (!url) return null;
  const key = url + ':' + color + ':' + quality;
  if (!textureCache.has(key)) textureCache.set(key, textureQueue(async()=>{
    return loadTexture(url,quality);
  }).then(t => {
    t.flipY = false;
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.colorSpace = color ? T.SRGBColorSpace : T.NoColorSpace;
    t.magFilter=T.LinearFilter;
    t.minFilter=!t.isCompressedTexture || t.mipmaps.length>1 ? T.LinearMipmapLinearFilter : T.LinearFilter;
    t.anisotropy=Math.min(8,textureRenderer?.capabilities.getMaxAnisotropy()??4);
    if(!t.isCompressedTexture || t.mipmaps.length>1)materialDiagnostics.mipmapped.add(url);
    return t;
  }).catch(() => {materialDiagnostics.errors.add(url); return null;}));
  return textureCache.get(key);
}
async function material(desc,quality) {
  const key = quality+':'+JSON.stringify(desc);
  if (!materialCache.has(key)) materialCache.set(key, (async () => {
    const [map, normalMap, orm, palette, dyeMask] = await Promise.all([
      texture(desc.color,true,quality), texture(desc.normal,false,quality), texture(desc.ormLayout === 'ORM' ? desc.orm : null,false,quality),
      texture(desc.dyePalette,true,quality),texture(desc.dyeMask,false,quality)
    ]);
    const water = desc.effect === 'water',glass=desc.effect==='glass';
    const m = new T.MeshStandardMaterial({name:desc.name, map, normalMap,
      normalScale:new T.Vector2(desc.foliage ? .55 : .7,desc.foliage ? -.55 : -.7), roughness:water ? .15 : desc.roughness ?? .8,
      metalness:0, side:desc.twoSided || desc.masked ? T.DoubleSide : T.FrontSide,
      alphaTest:desc.masked && !water && map ? desc.alphaTest : 0,
      transparent:water||glass, opacity:water ? .65 : glass ? .55 : 1,
      color:water ? 0x609caa : map ? 0xffffff : 0xc9d5dc});
    if (desc.tint) m.color.setRGB(...desc.tint);
    // Only explicitly identified ORM textures use standard glTF channel packing.
    if (orm) {m.aoMap=orm; m.aoMapIntensity=.75; m.roughnessMap=orm; m.metalnessMap=orm; m.roughness=1; m.metalness=1;}
    if(desc.foliage && map)applyFoliageShading(m);
    if(desc.topGrass){const grassMap=await texture(desc.topGrass,true,quality);if(grassMap)applyRockGrass(m,grassMap);}
    if(normalMap?.format===T.RED_GREEN_RGTC2_Format){
      const prior=m.onBeforeCompile,priorKey=m.customProgramCacheKey.bind(m);
      m.onBeforeCompile=shader=>{prior.call(m,shader);shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',T.ShaderChunk.normal_fragment_maps.replace('mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;','mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;\nmapN.z=sqrt(max(0.0,1.0-dot(mapN.xy,mapN.xy)));'));};
      m.customProgramCacheKey=()=>priorKey()+'|bc5-normal';
    }
    if(palette&&dyeMask)applyDyeShader(m,palette,dyeMask);
    m.userData.dyePalette=Boolean(palette&&dyeMask);
    m.userData.textured=Boolean(map);
    m.userData.resolved=Boolean(map||desc.effect||desc.tint);
    m.userData.approximation=Boolean(water || desc.inferredLocalTexture);
    if (map) materialDiagnostics.textured.add(key); else materialDiagnostics.fallback.add(key);
    return m;
  })());
  return materialCache.get(key);
}
export async function applyFurnitureMaterials(part,path,asset,quality='preview',dye={slots:{},missing:[],offset:0}) {
  const [manifest,dyeData]=await Promise.all([manifestPromise,dyeManifest]);let slots=manifest[path]??{};const meshes=[];
  if(path.startsWith('/asset/')&&!manifest[path]){try{const response=await fetch(path.replace('/asset/','/api/material/'));if(response.ok)slots=await response.json();else materialDiagnostics.errors.add(path+' · 材质解析失败');}catch(e){materialDiagnostics.errors.add(path+' · '+e.message);}}
  if(path.startsWith('/cached-asset/')){try{const response=await fetch(path.replace('/cached-asset/','/api/cached-material/'));if(response.ok)slots=await response.json();}catch(e){materialDiagnostics.errors.add(path+' · '+e.message);}}
  part.traverse(o=>{if(o.isMesh)meshes.push(o)});
  const counts={textured:0,fallback:0,dyeIssues:[...(dye.missing??[])],dyedSlots:0};
  let slotIndex=dye.offset??0;
  const meshOffsets=meshes.map(o=>{const start=slotIndex;slotIndex+=Array.isArray(o.material)?o.material.length:1;return start;});
  await Promise.all(meshes.map(async (o,meshIndex)=>{
    if(!o.userData.sourceMaterials)o.userData.sourceMaterials=Array.isArray(o.material)?o.material:[o.material];
    const originals=o.userData.sourceMaterials;
    const resolved=await Promise.all(originals.map((original,index)=>{
      let desc=slots[original.name];
      if(!desc && originals.length===1 && Object.keys(slots).length===1)desc=Object.values(slots)[0];
      if(!desc && asset.textures?.color)desc={name:original.name,...asset.textures,roughness:.9};
      if(!desc){
        // Texture-less exported glTF defaults to metallic=1, roughness=1.
        // A missing UE descriptor must stay a visible, explicitly unresolved placeholder.
        const fallback=original.clone();
        if(!fallback.map){fallback.color.set(0xc9d5dc);fallback.metalness=0;fallback.roughness=.8;}
        fallback.userData.textured=Boolean(fallback.map);
        fallback.userData.resolved=false;
        return Promise.resolve(fallback);
      }
      const choice=dye.slots[Number(dye.offset??0)+(desc.slotIndex??(meshOffsets[meshIndex]+index-Number(dye.offset??0)))],registry=desc.variants?desc:dyeData.materials[path]?.[original.name];
      const result=resolveDyeDescriptor(desc,registry,choice);
      if(choice&&(choice.pattern||choice.tint)){
        if(!result.issues.length&&(!result.desc.dyePalette||o.geometry.attributes.uv2))counts.dyedSlots++;
        counts.dyeIssues.push(...result.issues.map(issue=>original.name+' · '+issue));
      }
      if(result.desc.dyePalette&&!o.geometry.attributes.uv2){counts.dyeIssues.push(original.name+' · 缺少染色 UV');delete result.desc.dyePalette;}
      return material(result.desc,quality);
    }));
    for(const m of resolved){if(m.userData.textured)counts.textured++;else if(!m.userData.resolved)counts.fallback++;}
    if(o.geometry.attributes.uv && !o.geometry.attributes.uv1 && resolved.some(m=>m.aoMap))o.geometry.setAttribute('uv1',o.geometry.attributes.uv);
    o.userData.renderMaterial=Array.isArray(o.material)?resolved:resolved[0];
    o.material=o.userData.renderMaterial;
  }));
  return counts;
}
export function setClayMode(group,enabled){group.traverse(o=>{if(o.isMesh&&o.userData.renderMaterial)o.material=enabled?clayMaterial:o.userData.renderMaterial})}
