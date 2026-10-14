import {textureQualityForLevel} from './texture_quality.js';
import {installWorkspaceSettings} from './workspace_settings.js';
installWorkspaceSettings();
import {installGameFiles} from './workspace_game_files.js';
import {prepareScene} from './scene_prepare.js';
import {updateDyeManifest,updateMaterialManifest} from './furniture_materials.js';
import {setTextureRenderer} from './furniture_materials.js';
import {installDyePanel} from './workspace_dye_panel.js';
import {decodeDyeColors,dyeColorsForRow,setDyeArea} from './furniture_dye.js';
import {installSceneOverview} from './scene_overview.js';
import {installCurveArray} from './workspace_curve_array.js';
import {installViewCube} from './workspace_view_cube.js';
import {installRenderQuality} from './render_quality.js';
import {installWorkspacePlacement,localDragArrayLayout} from './workspace_placement.js';
import {installBuildLegality} from './build_legality.js';
import {installSaveValidation} from './workspace_validation.js';
import {installPresets} from './workspace_presets.js';
import {NO_ANCHOR,groundAnchor,savePositionToScene,scenePositionToSave} from './preset_geometry.js';
import {cloneLoadedFurniture} from './scene_duplicate.js';
import {notify} from './notices.js';
import {TransformFrame,MultiTransformFrame} from './transform_frame.js';
import {installTransformPrecision} from './transform_precision.js';
import {installWorkspaceContextMenu} from './workspace_context_menu.js';
import {initWorkspacePanels} from './workspace_panels.js';
import {renderToolboxCategories,resourceButtonContents} from './resource_toolbox.js';

import * as T from 'three';import {createQueue,modelQueue,modelBuffer,loadingMetrics} from './asset_loading.js';import {FurnitureInstances} from './furniture_instances.js';import {createGrassGround} from './scene_ground.js';import{saveRotationToScene,unrealQuaternionToScene,furnitureModelRotationToScene,furnitureModelPositionToScene,componentMatrixToScene}from'/unreal_transform.js?v=all-transform-audit-3';import{clone as cloneSkeleton}from'three/addons/utils/SkeletonUtils.js';import{GLTFLoader}from'three/addons/loaders/GLTFLoader.js';import{OrbitControls}from'three/addons/controls/OrbitControls.js';
if(new URLSearchParams(location.search).has('item'))document.body.classList.add('single-preview');
const panel=document.querySelector('main'),status=document.querySelector('#status'),r=new T.WebGLRenderer({antialias:true,logarithmicDepthBuffer:true});r.setPixelRatio(Math.min(devicePixelRatio,2));r.toneMapping=T.ACESFilmicToneMapping;r.toneMappingExposure=.85;panel.prepend(r.domElement);const scene=new T.Scene();scene.background=new T.Color('#25313e');const hemisphere=new T.HemisphereLight(0xeaf4ff,0x7d7769,2);scene.add(hemisphere);const sun=new T.DirectionalLight(0xffffff,2);sun.position.set(20,40,30);scene.add(sun);const camera=new T.PerspectiveCamera(45,1,.1,10000);camera.position.set(10,10,15);const controls=new OrbitControls(camera,r.domElement);controls.enableDamping=true;let group=new T.Group(),grid=new T.GridHelper(100,100),entries=[],mapping={},furniture={},categories={};scene.add(group,grid);grid.visible=false;grid.position.y=.005;const grassGround=createGrassGround(scene,r);grassGround.ready.catch(e=>{document.querySelector("#summary").textContent="草地贴图加载失败："+e.message;});import {applyFurnitureMaterials,setClayMode,materialDiagnostics,clayMaterial,furnitureDyeContext,furnitureDyeConfig} from './furniture_materials.js';
const renderQuality=installRenderQuality({renderer:r,scene,camera,controls,sun,hemisphere,select:document.querySelector('#renderQuality'),note:document.querySelector('#renderQualityNote')});renderQuality.prepare(grassGround.ground);
setTextureRenderer(r);
const loader=new GLTFLoader(),cache=new Map();

function num(v,defaultValue=0){const x=Number(v);if(!Number.isFinite(x))throw Error('存档含有无效数字');return v===undefined?defaultValue:x}
function parse(raw){const rows=Array.isArray(raw)?raw:raw.Snapshots??raw.PlaceInfo;if(rows&&typeof rows==='object'&&!Array.isArray(rows)&&Object.keys(rows).length===0)return [];if(!Array.isArray(rows))throw Error('未识别到 Snapshots、PlaceInfo 或 BuildRecord 数组');return rows.map((a,i)=>{const f=a.furnitureInfo,t=f?.trans;return {id:num(f?.cfg_item_id??a.ItemID),instance:a.instanceID??a.InstanceID,position:t?{x:num(t.position?.x),y:num(t.position?.y),z:num(t.position?.z)}:{x:num(a.Location?.X),y:num(a.Location?.Y),z:num(a.Location?.Z)},rotation:t?{x:num(t.rotation?.x),y:num(t.rotation?.y),z:num(t.rotation?.z)}:{x:num(a.Rotation?.Pitch),y:num(a.Rotation?.Yaw),z:num(a.Rotation?.Roll)},scale:t?{x:num(t.scale?.x,1),y:num(t.scale?.y,1),z:num(t.scale?.z,1)}:{x:num(a.Scale?.X,1),y:num(a.Scale?.Y,1),z:num(a.Scale?.Z,1)},raw:a}})}
function fit(){const b=new T.Box3();group.children.filter(o=>o.visible).forEach(o=>b.union(new T.Box3().setFromObject(o)));if(b.isEmpty())return;const c=b.getCenter(new T.Vector3()),s=b.getSize(new T.Vector3()),angle=Math.min(T.MathUtils.degToRad(45),2*Math.atan(Math.tan(T.MathUtils.degToRad(22.5))*camera.aspect)),d=Math.max(1,Math.max(s.x,s.y,s.z)/2/Math.tan(angle/2)*1.1);controls.target.copy(c);camera.position.copy(c).add(new T.Vector3(.9,.35,1).normalize().multiplyScalar(d));camera.far=Math.max(5000,d*12);camera.updateProjectionMatrix();controls.update()}

const batches=new FurnitureInstances(scene),summary=document.querySelector('#summary');
const prepared=new Map(),materialQueue=createQueue(16);
const duplicateNodes=new Map();
let run=0,readyRun=0,geometrySeconds=0,qualityUpdate=0;
const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
function getModel(path){
  if(!cache.has(path))cache.set(path,modelQueue(async()=>loader.parseAsync(await modelBuffer(path),new URL('.',new URL(path,location.href)).href)).catch(error=>{cache.delete(path);throw error;}));
  return cache.get(path);
}
function materialQuality(){return textureQualityForLevel(renderQuality.level);}
async function prepareMaterial(path,asset,quality=materialQuality(),id=null,colors=null,partIndex=0){
  const dye=await furnitureDyeContext(id,colors,partIndex);
  const key=path+':'+JSON.stringify(asset.textures??{})+':'+quality+':'+dye.key+':'+dye.offset+':'+JSON.stringify(dye.missing);
  if(!prepared.has(key))prepared.set(key,materialQueue(async()=>{
    const g=await getModel(path),part=cloneSkeleton(g.scene),counts=await applyFurnitureMaterials(part,path,asset,quality,dye),meshes=[];
    part.traverse(o=>{if(o.isMesh)meshes.push({material:o.material,source:o.userData.sourceMaterials});});
    return {counts,meshes};
  }));
  return prepared.get(key);
}
function assignMaterials(part,resolved){let i=0;part.traverse(o=>{if(!o.isMesh)return;const data=resolved.meshes[i++];
  o.material=data.material;o.userData.renderMaterial=data.material;o.userData.sourceMaterials=data.source;
  const materials=Array.isArray(data.material)?data.material:[data.material];
  if(o.geometry.attributes.uv&&!o.geometry.attributes.uv1&&materials.some(m=>m.aoMap))o.geometry.setAttribute('uv1',o.geometry.attributes.uv);
});}
async function rebuild(preserveView=false){
  const started=performance.now();
  const requestRun=run;
  let sceneCompletion=null;
  if(entries.length&&!new URLSearchParams(location.search).has('recovery')){
    summary.dataset.phase='preparing';
    const resources=await prepareScene(entries,text=>{if(requestRun===run)summary.textContent=text;});
    if(requestRun!==run)return;
    Object.assign(mapping,resources.mapping);updateDyeManifest(resources.dye);
    summary.dataset.backendSeconds=resources.allSeconds.toFixed(2);
    sceneCompletion=resources.completion;
    if(sceneCompletion)sceneCompletion.catch(()=>{});else updateMaterialManifest(resources.materials);
  }
  if(!new URLSearchParams(location.search).has('recovery')){
    const ids=[...new Set(entries.map(a=>String(a.id)))].filter(id=>!mapping[id]);
    for(const id of ids){try{const response=await fetch('/api/item/'+encodeURIComponent(id));if(requestRun!==run)return;if(response.ok)mapping[id]=await response.json();}catch(e){if(requestRun!==run)return;status.textContent='家具配置解析失败：'+e.message;}}
  }
  if(requestRun!==run)return;
  gizmo.detach();outline.visible=false;selectedNodes.clear();selectionHighlighter.clear();clearSelectionOutlines();selectedIndex=-1;for(const id of ['exportSave','grab','arrayDuplicate','curveDuplicate','duplicate','delete','undo','redo'])$(id).disabled=true;
  const token=++run;readyRun=0;selectedNode=null;
  batches.clear();scene.remove(group);group=new T.Group();scene.add(group);
  let matched=0,missing=0,failed=0,partial=0,textured=0,materialFallback=0;const materialJobs=[];
  summary.dataset.loadSeconds='';summary.dataset.geometrySeconds='';summary.dataset.phase='geometry';
  materialDiagnostics.errors.clear();
  // Launch unique requests together, with at most six GLBs decoding concurrently.
  const paths=new Set(entries.flatMap(a=>{const asset=mapping[String(a.id)];return asset?.path?(asset.components??[{path:asset.path}]).map(c=>c.path):[];}));
  for(const path of paths)getModel(path).catch(()=>{});
  let yielded=performance.now();
  for(const a of entries){
    if(token!==run)return;
    const node=new T.Group(),asset=mapping[String(a.id)];let mesh;const parts=[];
    if(asset?.path)try{
      mesh=new T.Group();for(const component of asset.components??[{path:asset.path}]){
        const waiting=performance.now(),g=await getModel(component.path);yielded+=performance.now()-waiting;if(token!==run)return;
        const part=cloneSkeleton(g.scene),local=new T.Group();part.traverse(o=>{if(o.isMesh){o.userData.sourceMaterials=Array.isArray(o.material)?o.material:[o.material];o.material=clayMaterial;}});local.add(part);
        if(component.translation){const [x,y,z]=component.translation;local.position.set(x/100,z/100,y/100);}
        if(component.quaternion)local.quaternion.fromArray(unrealQuaternionToScene(component.quaternion));
        if(component.scale){const [x,y,z]=component.scale;local.scale.set(x,z,y);}
        if(component.matrix){local.matrix.fromArray(componentMatrixToScene(component.matrix));local.matrixAutoUpdate=false;}
        mesh.add(local);parts.push({part,path:component.path});
      }
      matched++;if(asset.complete===false)partial++;
    }catch(e){mesh=null;failed++;console.warn('物品模型加载失败',a.id,e);}
    if(token!==run)return;
    const unmatched=!mesh;
    if(unmatched){const dims=(furniture[String(a.id)]?.size??[100,100,100]).map(x=>x/100);
      mesh=new T.Mesh(new T.BoxGeometry(dims[0],dims[2],dims[1]),new T.MeshStandardMaterial({color:0xf2ad64,wireframe:true}));mesh.position.y=dims[2]/2;missing++;
    }else applyModelBasis(mesh,asset);
    node.add(mesh);node.position.set(a.position.x/100,a.position.z/100,a.position.y/100);node.quaternion.fromArray(saveRotationToScene(a.rotation));node.scale.set(a.scale.x,a.scale.z,a.scale.y);
    node.userData={...a,unmatched,materialCounts:{textured:0,fallback:0}};node.visible=!unmatched||document.querySelector('#missing').checked;group.add(node);
    if(!unmatched)materialJobs.push({node,parts,asset});
    if(performance.now()-yielded>12){summary.textContent=`模型 ${group.children.length}/${entries.length} · 贴图将在模型显示后补齐`;await nextFrame();yielded=performance.now();}
  }
  geometrySeconds=(performance.now()-started)/1000;summary.dataset.geometrySeconds=geometrySeconds.toFixed(2);
  const geometryReady=performance.now();grassGround.fitToFurniture(group);if(!preserveView)fit();refreshBatches();readyRun=token;renderWorkspace();await nextFrame();summary.dataset.geometrySetupMs=(performance.now()-geometryReady).toFixed(1);
  summary.dataset.phase='textures';let finished=0;
  if(sceneCompletion){const result=await sceneCompletion;if(token!==run)return;summary.dataset.backendSeconds=result.allSeconds.toFixed(2);updateMaterialManifest(result.materials);updateDyeManifest(result.dye);}
  const materialsStarted=performance.now(),quality=materialQuality();
  await Promise.all(materialJobs.map(async({node,parts,asset})=>{
    const results=await Promise.all(parts.map(({path},i)=>prepareMaterial(path,asset,quality,node.userData.id,dyeColorsForRow(node.userData.raw),i)));
    if(token!==run)return;
    const counts={textured:0,fallback:0};parts.forEach(({part},i)=>{assignMaterials(part,results[i]);counts.textured+=results[i].counts.textured;counts.fallback+=results[i].counts.fallback;});
    node.userData.textureQuality=quality;node.userData.materialCounts=counts;if(counts.textured)textured++;if(counts.fallback)materialFallback++;finished++;
    node.userData.dyeIssues=[...new Set(results.flatMap(x=>x.counts.dyeIssues??[]))];
    node.userData.dyedSlots=results.reduce((n,x)=>n+(x.counts.dyedSlots??0),0);
    summary.textContent=`模型 ${matched}/${entries.length} 已显示（${geometrySeconds.toFixed(1)} 秒） · 贴图 ${finished}/${materialJobs.length}`;
  })).catch(error=>{if(token===run)throw error;});
  if(token!==run)return;
  summary.dataset.materialsMs=(performance.now()-materialsStarted).toFixed(1);
  // Material identity determines batching, so rebuild after preview materials resolve.
  const batchesStarted=performance.now();refreshBatches();applyClay();readyRun=token;renderProperties();summary.dataset.finalBatchesMs=(performance.now()-batchesStarted).toFixed(1);
  const seconds=(performance.now()-started)/1000;
  const dyeRequested=group.children.filter(n=>decodeDyeColors(dyeColorsForRow(n.userData.raw)).size);
  const dyePending=dyeRequested.filter(n=>n.userData.dyeIssues?.length||!n.userData.dyedSlots).length;
  summary.dataset.dyeRestored=String(dyeRequested.length-dyePending);summary.dataset.dyePending=String(dyePending);
  summary.dataset.dyeIssues=JSON.stringify(dyePending?dyeRequested.filter(n=>n.userData.dyeIssues?.length||!n.userData.dyedSlots).map(n=>({id:n.userData.id,instance:n.userData.instance,issues:n.userData.dyeIssues,slots:n.userData.dyedSlots})):[]);
  const timings={};for(const e of performance.getEntriesByType('resource')){const type=e.name.includes('.glb')?'models':e.name.includes('.ktx2')?'textures':e.name.includes('/api/material/')?'materials':'other';const a=timings[type]??={count:0,bytes:0,totalMs:0,maxMs:0,lastMs:0};a.count++;a.bytes+=e.transferSize;a.totalMs+=e.duration;a.maxMs=Math.max(a.maxMs,e.duration);a.lastMs=Math.max(a.lastMs,e.responseEnd);}summary.dataset.resourceTimings=JSON.stringify(timings);
  Object.assign(summary.dataset,{loadSeconds:seconds.toFixed(2),phase:'complete',matched:String(matched),missing:String(missing),failed:String(failed),textured:String(textured),textureErrors:String(materialDiagnostics.errors.size),mipmappedTextures:String(materialDiagnostics.mipmapped.size)});
  summary.textContent=`物品 ${matched}/${entries.length} · 有贴图 ${textured} 件 · 含待补材质 ${materialFallback} 件 · 贴图加载失败 ${materialDiagnostics.errors.size} · 模型 ${geometrySeconds.toFixed(1)} 秒 / 全部预览 ${seconds.toFixed(1)} 秒`;
  renderWorkspace();
  updateSceneTextureQuality();
  summary.textContent+=` · 染色已匹配 ${dyeRequested.length-dyePending} / 待补 ${dyePending}`;
  status.textContent=`共 ${entries.length} 件物品 · 真实模型 ${matched} · 占位 ${missing} · 模型加载失败 ${failed} · 特殊物品待校准 ${partial} · 多轴旋转 ${entries.filter(isTilted).length}。模型和材质从当前游戏按需加载。存档染色已接入；缺少的分区配置或贴图保留默认外观，蓝图运行时姿态仍待校准。`;
}
function refreshBatches(){selectionHighlighter.clear();batches.clear();viewMenu.restoreMaterials();setClayMode(group,document.querySelector('#clay').checked);viewMenu.prepareMaterials();viewMenu.applyVisibility();renderQuality.prepare(group);grassGround.invalidate(group);if(document.querySelector('#batchRendering').checked)batches.rebuild(group);else batches.clear();updateOutline();}
document.querySelector('#batchRendering').onchange=()=>{refreshBatches();applyClay();};
function applyClay(){refreshBatches();}
let selectedNode=null;
async function updateSceneTextureQuality(){
  const request=++qualityUpdate,loadRun=run,quality=materialQuality();
  if(readyRun!==run||summary.dataset.phase!=='complete')return;
  const nodes=group.children.filter(n=>!n.userData.unmatched&&n.userData.textureQuality!==quality);
  const note=document.getElementById('textureQualityStatus');
  if(!nodes.length){note.textContent=quality==='original'?'原始高清贴图已就绪':quality==='light'?'轻量贴图已就绪':'预览贴图已就绪';note.dataset.quality=quality;return;}
  note.textContent='正在切换贴图质量…';
  try{
    const resolved=await Promise.all(nodes.map(async node=>{
      const asset=mapping[node.userData.id],colors=dyeColorsForRow(node.userData.raw),colorKey=JSON.stringify(colors);
      const results=await Promise.all((asset.components??[{path:asset.path}]).map((c,i)=>prepareMaterial(c.path,asset,quality,node.userData.id,colors,i)));
      return {node,results,colorKey};
    }));
    if(request!==qualityUpdate||loadRun!==run||quality!==materialQuality())return;
    selectionHighlighter.clear();batches.clear();viewMenu.restoreMaterials();
    for(const {node,results,colorKey} of resolved){
      if(node.parent!==group||JSON.stringify(dyeColorsForRow(node.userData.raw))!==colorKey)continue;
      node.children[0].children.forEach((local,i)=>assignMaterials(local.children[0],results[i]));
      node.userData.textureQuality=quality;
    }
    refreshBatches();note.textContent=quality==='original'?'原始高清贴图已就绪':quality==='light'?'轻量贴图已就绪':'预览贴图已就绪';
    note.dataset.quality=quality;
  }catch(e){if(request===qualityUpdate&&loadRun===run)note.textContent='贴图切换失败：'+e.message;}
}

document.querySelector('#save').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;e.target.value='';openDocument(JSON.parse(await file.text()),file.name);await rebuild();renderWorkspace()}catch(e){status.textContent='导入失败：'+e.message}};
document.querySelector('#fit').onclick=()=>{restoreVisibility();fit()};
document.querySelector('#missing').onchange=()=>restoreVisibility();
import {installSceneNavigation} from './scene_navigation.js?v=live-view-8';
const sceneNavigation=installSceneNavigation(camera,controls,r.domElement,ray=>ray.intersectObjects([...group.children,...batches.pool.children,...scene.children.filter(o=>o.userData?.isNavigationGround)],true).find(h=>{if(!h.object.isMesh)return false;for(let o=h.object;o;o=o.parent)if(!o.visible)return false;return true;}));
const ray=new T.Raycaster(),mouse=new T.Vector2();new ResizeObserver(()=>{r.setSize(panel.clientWidth,panel.clientHeight);camera.aspect=panel.clientWidth/panel.clientHeight;camera.updateProjectionMatrix()}).observe(panel);let lastMetrics=0,previousFrame=performance.now(),frameIntervals=[];r.setAnimationLoop(()=>{const now=performance.now();frameIntervals.push(now-previousFrame);previousFrame=now;if(frameIntervals.length>60)frameIntervals.shift();controls.update();sceneNavigation.update();renderQuality.update();placement.update();grassGround.update(camera,renderQuality.level,controls.target);r.render(scene,camera);if(performance.now()-lastMetrics>500){lastMetrics=performance.now();const p=document.querySelector('#performance');p.textContent=`每帧绘制 ${r.info.render.calls} 次 · 合批网格 ${batches.count} 个 / ${batches.batches.length} 批 · 缓存命中 ${loadingMetrics.cacheHits} / 下载 ${loadingMetrics.downloads} · 本地缓存${loadingMetrics.cacheState}`;p.dataset.frameIntervalMs=String(frameIntervals.reduce((a,b)=>a+b,0)/frameIntervals.length);p.dataset.frameMaxMs=String(Math.max(...frameIntervals));p.dataset.grassFlowers=String(grassGround.metrics.flowerCount??0);p.dataset.grassTall=String(grassGround.metrics.tallCount??0);p.dataset.flowerPalette=JSON.stringify(grassGround.metrics.flowerPalette??[]);p.dataset.grassTufts=String(grassGround.metrics.tuftCount??0);p.dataset.grassTiles=String(grassGround.metrics.visibleTiles??0);p.dataset.grassCpuMs=String(grassGround.metrics.cpuMs??0);p.dataset.grassPeakMs=String(grassGround.metrics.maxGenerationSliceMs??0);p.dataset.grassPending=String(grassGround.metrics.generationPending??false);p.dataset.drawCalls=String(r.info.render.calls);p.dataset.batched=String(batches.count);p.dataset.cacheHits=String(loadingMetrics.cacheHits);p.dataset.downloads=String(loadingMetrics.downloads);}});

function isTilted(a){return Math.abs(a.rotation.x)>.01||Math.abs(a.rotation.z)>.01}
function restoreVisibility(){viewMenu.applyVisibility();batches.sync(group)}
document.querySelector('#nearTop').onclick=()=>{if(!selectedNode)return;restoreVisibility();batches.sync(group);const c=selectedNode.position.clone();controls.target.copy(c);camera.position.copy(c).add(new T.Vector3(0,22,.001));camera.lookAt(c);controls.update();};
function applyModelBasis(mesh,asset){mesh.quaternion.fromArray(furnitureModelRotationToScene(asset,true,-90));mesh.position.fromArray(furnitureModelPositionToScene(asset,true,-90));}
document.querySelector('#isolate').onchange=()=>{restoreVisibility();renderList();};

document.querySelector("#clay").onchange=applyClay;
document.querySelector("#grassGround").onchange=e=>grassGround.ground.visible=e.target.checked;document.querySelector("#showGrid").onchange=e=>grid.visible=e.target.checked;

async function showBuildVersion(){
  const label=document.querySelector('#buildVersion');
  try{const response=await fetch('/preview_version.json',{cache:'no-store'});if(!response.ok)throw new Error(response.status);const version=await response.json();label.textContent='本地资源版本 '+version.mapping;}
  catch{label.textContent='变换审计 3 · 服务版本未确认';}
}
document.querySelector('#refreshMapping').onclick=async()=>{
  const button=document.querySelector('#refreshMapping');button.disabled=true;
  try{const response=await fetch('/scene_mapping.json',{cache:'no-store'});if(!response.ok)throw new Error(response.status);mapping=await response.json();await rebuild();await showBuildVersion();}
  catch(e){status.textContent='更新资源映射失败：'+e.message;}finally{button.disabled=false;}
};
showBuildVersion();

async function initial(){try{
  const state=await fetch('/api/status').then(r=>r.json());
  const recovery=new URLSearchParams(location.search).has('recovery');
  if((!state.ready||state.changed)&&!recovery){location.replace('/setup.html');return;}
  await buildLegality.ready;
  const loaded=await Promise.all(['/furniture_catalog.json','/scene_mapping.json','/furniture_categories.json'].map(u=>fetch(u,{cache:'no-store'}).then(r=>r.json())));
  [furniture,mapping]=loaded;categories=loaded[2].categories;
  const report=loaded[2].report??{},catalogStatus=document.getElementById('catalogStatus');
  catalogStatus.textContent=report.error??`当前游戏目录 · 名称 ${report.named??0} 款 · 已分类 ${report.classified??0} 款${report.missingItems?.length?` · ${report.missingItems.length} 款缺少目录记录，保留 ID 显示`:''}`;
  if(report.error)catalogStatus.style.color='#edb68c';
  if(recovery){mapping=await fetch('/api/recovery-mapping').then(r=>r.json());notify('旧缓存恢复视图：只显示已有模型，不代表当前游戏版本。',{key:'recovery',level:'warn'});}
  openDocument({PlaceInfo:[]},'新家园存档.json');await rebuild();renderWorkspace();
}catch(e){status.textContent='初始化失败：'+e.message}};

import {categoryLabel,matchesCategory,populateCategories} from './furniture_categories.js';
import {SelectionHighlight} from './selection_highlight.js';
import {installWorkspaceSelection} from './workspace_selection.js';
import {SaveDocument} from './save_document.js';
import {TransformControls} from 'three/addons/controls/TransformControls.js';

let saveDocument=null,selectedIndex=-1,libraryMode=false,editorMode='select',dragStart=null,suppressPickUntil=0,presetPanel=null;
const selectionHighlighter=new SelectionHighlight(()=>renderQuality.level);
const sceneRows=new Map();
const selectedNodes=new Set(),selectionOutlines=new T.Group();scene.add(selectionOutlines);
renderQuality.onLevelChange(()=>{selectionHighlighter.apply(selectedNodes,batches);updateSceneTextureQuality();});
const $=id=>document.getElementById(id);
const dyePanel=installDyePanel({host:$('dyePanel'),configFor:furnitureDyeConfig,onChange:changeSelectedDye});
const gizmo=new TransformControls(camera,r.domElement);scene.add(gizmo.getHelper());gizmo.setSize(.85);installTransformPrecision(gizmo,r.domElement,panel,()=>Math.min(...[...selectedNodes].map(node=>node.position.y)));
// Compile every handle before the first interaction, including hidden axes.
r.compileAsync(gizmo.getHelper(),camera,scene).then(()=>{panel.dataset.gizmoWarm='ready';}).catch(()=>{panel.dataset.gizmoWarm='failed';});
const arrayFrame=new T.Object3D();arrayFrame.userData.arrayHandle=true;scene.add(arrayFrame);let arrayState=null;
const transformFrame=new TransformFrame();scene.add(transformFrame.object);
const multiTransformFrame=new MultiTransformFrame();scene.add(multiTransformFrame.object);
function legalRotationFrame(){
  const restricted=buildLegality.enabled&&editorMode==='rotate'&&[...selectedNodes].some(n=>{const c=buildLegality.constraint(n.userData.id);return c&&(!c.rotationAllowed.x||!c.rotationAllowed.y);});
  return restricted?new T.Quaternion().fromArray(saveRotationToScene({x:0,y:selectedNode.userData.rotation.y,z:0})):null;
}
function syncLegalHandleVisibility(workingQuaternion,nodes=selectedNodes){
  gizmo.showX=gizmo.showY=gizmo.showZ=true;
  if(workingQuaternion){
    const basis=gizmo.space==='local'?workingQuaternion:new T.Quaternion(),axes=[new T.Vector3(1,0,0),new T.Vector3(0,1,0),new T.Vector3(0,0,1)].map(v=>v.applyQuaternion(basis));
    const blocked=[];
    for(const n of nodes){const c=buildLegality.constraint(n.userData.id);if(!c)continue;const q=new T.Quaternion().fromArray(saveRotationToScene({x:0,y:readNodeTransform(n).rotation.y,z:0}));if(!c.rotationAllowed.x)blocked.push(new T.Vector3(1,0,0).applyQuaternion(q));if(!c.rotationAllowed.y)blocked.push(new T.Vector3(0,0,1).applyQuaternion(q));}
    [gizmo.showX,gizmo.showY,gizmo.showZ]=axes.map(axis=>blocked.every(b=>Math.abs(axis.dot(b))<1e-6));
  }
  panel.dataset.legalHandleAxes=['X','Y','Z'].filter(axis=>gizmo['show'+axis]).join('');
}
function attachTransformHandle(){const workingQuaternion=selectedNode?legalRotationFrame():null;syncLegalHandleVisibility(workingQuaternion);if(buildLegality.enabled&&(!buildLegality.available&&['scale','rotate'].includes(editorMode))){gizmo.detach();return;}if(buildLegality.enabled&&editorMode==='scale'&&selectedNode){const c=buildLegality.constraint(selectedNode.userData.id);if(c&&c.scaleRange[0]===c.scaleRange[1]){gizmo.detach();return;}}if(!selectedNode||editorMode==='select'||(selectedNodes.size>1&&editorMode==='scale')){gizmo.detach();return;}if(selectedNodes.size>1){gizmo.attach(multiTransformFrame.attach(selectedNodes,workingQuaternion));panel.dataset.transformFrame='selection-center';}else{gizmo.attach(editorMode==='scale'?selectedNode:transformFrame.attach(selectedNode,workingQuaternion));panel.dataset.transformFrame=editorMode==='scale'?'actor':'calibrated-model';}}
const outline=new T.Box3Helper(new T.Box3(),0x78dfc6);scene.add(outline);outline.visible=false;
function openDocument(raw,name){const nextDocument=new SaveDocument(raw,name),nextEntries=parse(nextDocument.data);run++;modelQueue.cancelPending();materialQueue.cancelPending();prepared.clear();placement.cancel();duplicateNodes.clear();viewMenu.reset(true);saveDocument=nextDocument;viewMenu.loadVisibility(name+':'+saveDocument.rows.map(row=>row.instanceID??row.InstanceID).join(','));entries=nextEntries;selectedIndex=-1;selectedNodes.clear();selectionHighlighter.clear();clearSelectionOutlines();gizmo.detach();outline.visible=false;}
function clearSelectionOutlines(){for(const child of selectionOutlines.children){child.geometry.dispose();child.material.dispose();}selectionOutlines.clear();}
function selectEditorNode(node,add=false,navigate=false){if(placement.active)placement.cancel();if(gizmo.dragging||performance.now()<suppressPickUntil)return;applySelection(node?[node]:[],add);if(navigate&&node)revealSceneSelection();}
function applySelection(nodes,add=false,crossing=false){const started=performance.now();if(!add)selectedNodes.clear();for(const node of nodes)selectedNodes.add(node);selectedNode=[...selectedNodes].at(-1)??null;selectedIndex=selectedNode?group.children.indexOf(selectedNode):-1;if($('isolate').checked)restoreVisibility();attachTransformHandle();renderProperties();updateListSelection();updateOutline();panel.dataset.selectionCpuMs=(performance.now()-started).toFixed(2);panel.dataset.selectionCount=String(selectedNodes.size);status.textContent=selectedNodes.size?`已选择 ${selectedNodes.size} 件物品${nodes.length>1?' · '+(crossing?'相交框选':'包含框选'):''} · 可移动、旋转、复制、删除或聚焦`:'未选择物品';}
function updateOutline(){outline.visible=false;clearSelectionOutlines();selectionHighlighter.apply(selectedNodes,batches);panel.dataset.selectionHighlight='model';}
installWorkspaceSelection({canvas:r.domElement,panel,camera,controls,gizmo,nodes:()=>group.children,onSelect:(nodes,add,crossing)=>{applySelection(nodes,add,crossing);if(nodes.length)revealSceneSelection();},onClick:(e,add)=>{if(performance.now()<suppressPickUntil)return;const b=r.domElement.getBoundingClientRect();mouse.set((e.clientX-b.left)/b.width*2-1,-(e.clientY-b.top)/b.height*2+1);ray.setFromCamera(mouse,camera);const hit=ray.intersectObjects([...group.children,...batches.pool.children],true).find(h=>batches.owner(h,group));if(!hit)setMode('select');selectEditorNode(hit?batches.owner(hit,group):null,add,true);}});
initWorkspacePanels();
installViewCube({panel,camera,controls,onHome:()=>fit()});
const viewMenu=installWorkspaceContextMenu({canvas:r.domElement,panel,nodes:()=>group.children,selection:()=>selectedNodes,catalog:()=>furniture,refresh:()=>{refreshBatches();applyClay();},onVisibility:()=>renderList(),syncVisibility:()=>{viewMenu.applyVisibility();batches.sync(group);updateOutline();},onChange:text=>status.textContent=text,editAction:action=>{if(['translate','rotate','scale'].includes(action))setMode(action);else document.getElementById(action).click();},canEdit:action=>readyRun===run&&!gizmo.dragging&&selectedNodes.size>0&&(action!=='scale'||selectedNodes.size===1),select:(node,add)=>selectEditorNode(node,add,true),pick:e=>{const b=r.domElement.getBoundingClientRect();mouse.set((e.clientX-b.left)/b.width*2-1,-(e.clientY-b.top)/b.height*2+1);ray.setFromCamera(mouse,camera);const hit=ray.intersectObjects([...group.children,...batches.pool.children],true).find(h=>batches.owner(h,group));return hit?batches.owner(hit,group):null;}});
function placementSurface(ray){return ray.intersectObjects([...group.children,...batches.pool.children],true).find(h=>{
  const owner=batches.owner(h,group);if(!owner?.visible||!h.face)return false;
  const matrix=h.object.matrixWorld.clone();if(h.object.isInstancedMesh){const instance=new T.Matrix4();h.object.getMatrixAt(h.instanceId,instance);matrix.multiply(instance);}
  const normal=h.face.normal.clone().applyNormalMatrix(new T.Matrix3().getNormalMatrix(matrix));
   h.placementNormal=normal;h.placementId=owner.userData.id;h.placementBounds=new T.Box3().setFromObject(owner);h.placementQuaternion=owner.getWorldQuaternion(new T.Quaternion()).multiply(owner.children[0]?.quaternion??new T.Quaternion());return true;
});}
let grabRotation=null;
const grabSingleFrame=new TransformFrame(),grabMultiFrame=new MultiTransformFrame();
function attachGrabRotation(){
  const nodes=grabRotation.nodes,active=nodes.at(-1),restricted=grabRotation.operation==='rotate'&&buildLegality.enabled&&nodes.some(n=>{const c=buildLegality.constraint(n.userData.id);return c&&(!c.rotationAllowed.x||!c.rotationAllowed.y);});
  const working=restricted?new T.Quaternion().fromArray(saveRotationToScene({x:0,y:readNodeTransform(active).rotation.y,z:0})):null;
  syncLegalHandleVisibility(working,nodes);
  if(grabRotation.operation==='rotate'&&buildLegality.enabled&&!buildLegality.available){gizmo.detach();return;}
  const frame=nodes.length>1?grabMultiFrame:grabSingleFrame,parent=active.parent;
  parent.add(frame.object);frame.attach(nodes.length>1?nodes:active,working);
  if(nodes.length>1)frame.object.position.sub(parent.position);
  frame.object.updateMatrixWorld(true);grabRotation.frame=frame;gizmo.attach(frame.object);
  panel.dataset.transformFrame=nodes.length>1?'grab-selection-center':'grab-calibrated-model';
}
function startPlacementTransform(nodes,operation){
  grabRotation={nodes,mode:gizmo.mode,operation,start:null};gizmo.setMode(operation);attachGrabRotation();
}
function endPlacementTransform(){
  gizmo.detach();gizmo.dragging=false;gizmo.axis=null;controls.enabled=true;
  grabSingleFrame.object.removeFromParent();grabMultiFrame.object.removeFromParent();
  gizmo.setMode(grabRotation?.mode??editorMode);grabRotation=null;
}
const placement=installWorkspacePlacement({scene,camera,canvas:r.domElement,panel,status,pickSurface:placementSurface,
  onRotationStart:nodes=>startPlacementTransform(nodes,'rotate'),onRotationEnd:endPlacementTransform,
  onMoveStart:nodes=>startPlacementTransform(nodes,'translate'),onMoveEnd:endPlacementTransform,
  onFinish:cancelled=>{if(cancelled){attachTransformHandle();updateOutline();}}});
async function loadPlacementItem(id){
  const quality=materialQuality();
  const asset=mapping[id];if(!asset?.path)throw Error('此物品尚无模型');
  const node=new T.Group(),mesh=new T.Group();node.add(mesh);
  for(const component of asset.components??[{path:asset.path}]){
    const part=cloneSkeleton((await getModel(component.path)).scene),local=new T.Group();local.add(part);
    if(component.translation){const [x,y,z]=component.translation;local.position.set(x/100,z/100,y/100);}
    if(component.quaternion)local.quaternion.fromArray(unrealQuaternionToScene(component.quaternion));
    if(component.scale){const [x,y,z]=component.scale;local.scale.set(x,z,y);}
    if(component.matrix){local.matrix.fromArray(componentMatrixToScene(component.matrix));local.matrixAutoUpdate=false;}
    assignMaterials(part,await prepareMaterial(component.path,asset,quality));mesh.add(local);
  }
  applyModelBasis(mesh,asset);node.userData={id:Number(id),unmatched:false,textureQuality:quality,materialCounts:{textured:1,fallback:0}};
  renderQuality.prepare(node);return node;
}
function placementPositions(nodes,offset){return nodes.map(node=>({x:(node.position.x+offset.x)*100,y:(node.position.z+offset.z)*100,z:(node.position.y+offset.y)*100}));}
function renderProperties(){$('nearTop').disabled=!selectedNode||readyRun!==run;$('isolate').disabled=!selectedNode;dyePanel.render([...selectedNodes]);const a=selectedNode?.userData;$('properties').hidden=!a;$('emptySelection').hidden=!!a;for(const id of ['grab','arrayDuplicate','curveDuplicate','duplicate','delete','focusSelection'])$(id).disabled=!a||readyRun!==run;presetPanel?.setSaveEnabled(!!a&&readyRun===run);if(!a)return;if(selectedNodes.size>1){$('selectedName').textContent=`${selectedNodes.size} 件物品`;$('selectedMeta').textContent='多选模式 · 共用中心移动、旋转 · 局部轴参考最后选中物品';for(const kind of ['position','rotation','scale'])$(kind+'Fields').replaceChildren();$('applyProperties').disabled=true;buildLegality.decorate([...selectedNodes].map(n=>n.userData.id));return;}$('applyProperties').disabled=false;$('selectedName').textContent=furniture[a.id]?.name??'物品';$('selectedMeta').textContent=`物品 ID ${a.id} · 实例 ${a.instance} · ${a.unmatched?'模型未匹配':'真实模型'}`;
  const colors=dyeColorsForRow(a.raw);
  if(decodeDyeColors(colors).size)$('selectedMeta').textContent+=` · 存档配色 ${JSON.stringify(colors)} · ${a.dyeIssues?.length?'染色待补：'+a.dyeIssues.join('；'):'染色已匹配'}`;
  for(const kind of ['position','rotation','scale']){const host=$(kind+'Fields');host.replaceChildren();const axes=kind==='rotation'?[['z','Roll'],['x','Pitch'],['y','Yaw']]:[['x','X'],['y','Y'],['z','Z']];for(const [axis,label] of axes){const wrap=document.createElement('label');wrap.textContent=label;const input=document.createElement('input');input.type='number';input.step=kind==='scale'?'0.01':'1';input.value=Number(a[kind][axis].toFixed(4));input.dataset.field=kind+'.'+axis;input.onchange=()=>{const value=Number(input.value);if(!Number.isFinite(value)||(kind==='scale'&&value<=0)){renderProperties();return;}const transform=structuredClone({position:a.position,rotation:a.rotation,scale:a.scale});transform[kind][axis]=value;saveDocument.transform(selectedIndex,buildLegality.constrain(a.id,transform,kind));syncDocumentTransforms();};wrap.append(input);host.append(wrap);}}
  buildLegality.decorate([a.id]);
}
function updateListSelection(){if(!libraryMode)sceneOverview.syncSelection();}
function revealSceneSelection(){
  if(selectedIndex<0)return;
  if(libraryMode)document.getElementById('sceneTab').click();
  if(!sceneOverview.reveal(selectedIndex)){
    clearTimeout(searchTimer);
    document.getElementById('sceneSearch').value='';
    document.getElementById('majorCategory').value='';
    document.getElementById('minorCategory').value='';
    renderList();sceneOverview.reveal(selectedIndex);
  }
}
const sceneOverview=installSceneOverview({list:$('sceneList'),isVisible:row=>Boolean(group.children[row.index]?.visible),selected:row=>selectedNodes.has(group.children[row.index]),setVisibility:(ids,visible)=>{viewMenu.setVisibility(ids,visible);status.textContent=`已${visible?'显示':'隐藏'} ${ids.length} 件物品`;},makePreview:(button,item)=>{resourceButtonContents(button,item,true,furniture,categories);button.title=item.name+' · ID '+item.id;},locate:(row,add)=>{
  const node=group.children[row.index];if(!node)return;selectEditorNode(node,add);
  const bounds=new T.Box3().setFromObject(node),center=bounds.getCenter(new T.Vector3()),distance=Math.max(1,bounds.getSize(new T.Vector3()).length()*1.6);
  controls.target.copy(center);camera.position.copy(center).add(new T.Vector3(.8,.6,1).normalize().multiplyScalar(distance));camera.far=Math.max(5000,distance*12);camera.updateProjectionMatrix();controls.update();
  if(!node.visible){outline.box.copy(bounds);outline.visible=true;status.textContent='已定位隐藏物品 · 实例 '+row.instance+' · 可点击“显示并定位”恢复显示';}
  panel.dataset.locatedInstance=String(row.instance);
},onRender:(count,groups)=>{$('objectCount').textContent=`${groups} 款 / ${count} 件`;$('listTitle').textContent='场景物品总览';$('listNote').textContent='同款展开管理 · 点击实例定位 · 眼睛切换显示';}});
function renderList(){const term=$('sceneSearch').value.trim().toLowerCase(),list=$('sceneList'),scroll=list.scrollTop;const existing=new Map([...list.children].map(b=>[b.dataset.rowKey,b]));sceneRows.clear();const source=libraryMode?Object.entries(furniture).filter(([id])=>mapping[id]?.path).map(([id,f])=>({id,name:f.name})):entries.map((a,index)=>({...a,index,name:furniture[a.id]?.name??'物品'}));populateCategories($('majorCategory'),$('minorCategory'),source,furniture,categories);renderToolboxCategories($('majorCategory'),$('minorCategory'),categories,renderList);list.classList.toggle('resource-grid',libraryMode);const filtered=source.filter(a=>matchesCategory(furniture[a.id]?.categoryId,$('majorCategory').value,$('minorCategory').value,categories)&&`${a.name} ${a.id} ${a.instance??''}`.toLowerCase().includes(term));$('objectCount').textContent=`${filtered.length} / ${source.length}`;$('listTitle').textContent=libraryMode?'挑选你的物品':'家园里的物品';$('listNote').textContent=libraryMode?'点击拿起物品 · 鼠标移动预览 · 左键放置 · 右键取消':'单击选择 · 双击聚焦';if(!libraryMode){sceneOverview.render(filtered,source,term);return;}sceneOverview.hide();const desired=[];for(const a of filtered){const key=libraryMode?'resource:'+a.id:'instance:'+a.instance;let b=existing.get(key);const fresh=!b;if(fresh)b=document.createElement('button');b.dataset.rowKey=key;b.dataset.index=String(a.index??'');b.className='object-row'+(!libraryMode&&selectedNodes.has(group.children[a.index])?' active':'');if(!libraryMode)sceneRows.set(a.index,b);if(fresh)resourceButtonContents(b,a,libraryMode,furniture,categories);b.onclick=e=>libraryMode?addFurniture(a.id):selectEditorNode(group.children[Number(b.dataset.index)],e.shiftKey||e.ctrlKey||e.metaKey);b.ondblclick=()=>{if(!libraryMode){selectEditorNode(group.children[Number(b.dataset.index)]);focusEditor();}};desired.push(b);}const keep=new Set(desired);for(const b of [...list.children])if(!keep.has(b))b.remove();desired.forEach((b,i)=>{if(list.children[i]!==b)list.insertBefore(b,list.children[i]??null);});list.scrollTop=scroll;}
function renderWorkspace(refreshList=true){if(!saveDocument)return;saveValidation.schedule();$('documentName').textContent=saveDocument.name;$('dirtyBadge').textContent=saveDocument.dirty?'● 未保存修改':'已载入';$('undo').disabled=!saveDocument.undoStack.length;$('redo').disabled=!saveDocument.redoStack.length;$('exportSave').disabled=readyRun!==run;gameFiles.refresh();if(refreshList)renderList();renderProperties();}
function syncDocumentTransforms(){const started=performance.now(),indices=saveDocument.changedIndices??group.children.map((_,i)=>i),owners=[];for(const i of indices){const node=group.children[i];if(!node)continue;const a=parse([saveDocument.rows[i]])[0];entries[i]=a;node.userData={...node.userData,...a};node.position.set(a.position.x/100,a.position.z/100,a.position.y/100);node.quaternion.fromArray(saveRotationToScene(a.rotation));node.scale.set(a.scale.x,a.scale.z,a.scale.y);owners.push(node);}batches.syncOwners(owners);grassGround.invalidate(group);attachTransformHandle();renderWorkspace(false);panel.dataset.transformCommitCpuMs=(performance.now()-started).toFixed(2);panel.dataset.transformCommitOwners=String(owners.length);}
let dyeUpdate=0;
async function changeSelectedDye(area,index,nodes){
  if(readyRun!==run||placement.active||gizmo.dragging)return;
  const config=await furnitureDyeConfig(nodes[0]?.userData.id);
  if(index!==0&&!config?.[area]?.[index])return;
  const changes=nodes.map(node=>({index:group.children.indexOf(node),colors:setDyeArea(dyeColorsForRow(node.userData.raw),area,index)})).filter(x=>x.index>=0);
  if(!saveDocument.dyeMany(changes))return;
  await syncDocumentDyes();
}
async function syncDocumentDyes(){
  const token=++dyeUpdate,loadRun=run,quality=materialQuality();
  const nodes=(saveDocument.changedIndices??[]).map(i=>group.children[i]).filter(Boolean);
  for(const node of nodes){const i=group.children.indexOf(node),a=parse([saveDocument.rows[i]])[0];entries[i]=a;node.userData={...node.userData,...a};}
  renderWorkspace(false);status.textContent=`正在更新 ${nodes.length} 件物品的配色…`;
  try{
    const resolved=await Promise.all(nodes.map(async node=>{
      const asset=mapping[node.userData.id];if(!asset?.path)return {node,results:[]};
      const results=await Promise.all((asset.components??[{path:asset.path}]).map((c,i)=>prepareMaterial(c.path,asset,quality,node.userData.id,dyeColorsForRow(node.userData.raw),i)));
      return {node,results};
    }));
    if(token!==dyeUpdate||loadRun!==run)return;
    if(quality!==materialQuality()){await updateSceneTextureQuality();return;}
    // Keep the old appearance until replacements are ready; never rebuild GLBs.
    selectionHighlighter.clear();batches.clear();viewMenu.restoreMaterials();
    for(const {node,results} of resolved){
      if(!results.length)continue;node.userData.textureQuality=quality;
      node.children[0].children.forEach((local,i)=>assignMaterials(local.children[0],results[i]));
      node.userData.dyeIssues=[...new Set(results.flatMap(x=>x.counts.dyeIssues??[]))];
      node.userData.dyedSlots=results.reduce((sum,x)=>sum+(x.counts.dyedSlots??0),0);
    }
    refreshBatches();renderWorkspace(false);
    const pending=nodes.filter(n=>n.userData.dyeIssues?.length).length;
    status.textContent=`已更新 ${nodes.length} 件物品的配色 · 可撤销${pending?` · ${pending} 件部分染色资源待补`:''}`;
    const requested=group.children.filter(n=>decodeDyeColors(dyeColorsForRow(n.userData.raw)).size),remaining=requested.filter(n=>n.userData.dyeIssues?.length||!n.userData.dyedSlots).length;
    summary.dataset.dyeRestored=String(requested.length-remaining);summary.dataset.dyePending=String(remaining);
    summary.textContent=summary.textContent.replace(/ · 染色已匹配 .*$/,'')+` · 染色已匹配 ${requested.length-remaining} / 待补 ${remaining}`;
  }catch(error){if(token===dyeUpdate)status.textContent='配色预览更新失败：'+error.message+'；存档配色已记录，可撤销。';}
}
async function rebuildEditor(index){gizmo.detach();outline.visible=false;entries=parse(saveDocument.data);await rebuild(true);if(index>=0&&group.children[index])selectEditorNode(group.children[index]);else{selectedIndex=-1;selectedNode=null;}renderWorkspace();}
// A preset is the selection kept as a save fragment: the same items with their
// transforms measured from the group's ground anchor, so it can be dropped
// anywhere. Positions use the save axis order the rest of the editor writes.
function presetSelection(){
  const picked=[...selectedNodes].map(node=>({node,index:group.children.indexOf(node)})).filter(entry=>entry.index>=0&&saveDocument.rows[entry.index]);
  if(!picked.length)return null;
  const box=new T.Box3();
  for(const {node} of picked){node.updateMatrixWorld(true);box.union(new T.Box3().setFromObject(node));}
  if(box.isEmpty())throw Error('选中的物品还没有可用模型');
  const anchor=groundAnchor(box);
  return picked.map(({node,index})=>{
    const row=saveDocument.rows[index],transform=readNodeTransform(node);
    return {cfg_item_id:Number(node.userData.id),
      attach_id:Number(row.furnitureInfo?.attach_id??0),
      colors:structuredClone(dyeColorsForRow(row)??[0]),
      trans:{position:scenePositionToSave(node.position,anchor),rotation:transform.rotation,scale:transform.scale}};
  });
}
function presetSuggestedName(){
  const names=[...selectedNodes].map(node=>furniture[node.userData.id]?.name).filter(Boolean);
  if(!names.length)return '';
  return names.length===1?names[0]:`${names[0]} 等 ${names.length} 件`;
}
async function placePreset(items,name){
  if(!saveDocument||readyRun!==run)throw Error('工作区还没准备好');
  gizmo.detach();
  await placement.begin(async()=>{
    const nodes=[];
    for(const item of items){
      const node=await loadPlacementItem(item.cfg_item_id),p=savePositionToScene(item.trans.position,NO_ANCHOR);
      node.position.set(p.x,p.y,p.z);
      node.quaternion.fromArray(saveRotationToScene(item.trans.rotation));
      node.scale.set(item.trans.scale.x,item.trans.scale.z,item.trans.scale.y);
      nodes.push(node);
    }
    return nodes;
  },name,(nodes,offset)=>{
    const started=performance.now(),positions=placementPositions(nodes,offset);
    const rows=items.map((item,k)=>{
      const transform=readNodeTransform(nodes[k]);
      return {bIsAdd:true,instanceID:0,extra:{TempInfo:{}},
        furnitureInfo:{group_id:0,attach_id:item.attach_id??0,cfg_item_id:item.cfg_item_id,
          colors:structuredClone(item.colors??[0]),
          trans:{position:positions[k],rotation:transform.rotation,scale:transform.scale}}};
    });
    const indices=saveDocument.addItems(rows);
    indices.forEach((index,k)=>{const a=parse([saveDocument.rows[index]])[0],node=nodes[k];
      setNodeEntry(node,a);entries.push(a);group.add(node);duplicateNodes.set(String(a.instance),node);renderQuality.prepare(node);});
    finishDuplicateUpdate(nodes,started);
    status.textContent=`已放置「${name}」· ${indices.length} 件`;
    if(items.some(item=>(item.colors??[]).some(code=>code>0))){saveDocument.changedIndices=indices;syncDocumentDyes();}
  });
}
presetPanel=installPresets({tab:$('presetTab'),panel:document.querySelector('.left-panel'),
  selectionName:presetSuggestedName,saveSelection:presetSelection,placeItems:placePreset,
  missingItems:items=>[...new Set(items.filter(item=>!furniture[item.cfg_item_id]).map(item=>item.cfg_item_id))],notify});
async function addFurniture(id){if(!saveDocument||readyRun!==run)return;gizmo.detach();await placement.begin(async()=>[await loadPlacementItem(id)],furniture[id]?.name??'物品',(nodes,offset)=>{
  const started=performance.now(),node=nodes[0],index=saveDocument.add(id,placementPositions(nodes,offset)[0],readNodeTransform(node).rotation),a=parse([saveDocument.rows[index]])[0];
  setNodeEntry(node,a);entries.push(a);group.add(node);duplicateNodes.set(String(a.instance),node);renderQuality.prepare(node);finishDuplicateUpdate([node],started);status.textContent='已放置 '+(furniture[id]?.name??'物品');
});}
function focusEditor(){if(selectedNodes.size>1){const b=new T.Box3();for(const n of selectedNodes)b.union(new T.Box3().setFromObject(n));const c=b.getCenter(new T.Vector3()),d=Math.max(1,b.getSize(new T.Vector3()).length()*1.3);controls.target.copy(c);camera.position.copy(c).add(new T.Vector3(.8,.6,1).normalize().multiplyScalar(d));controls.update();return;}if(!selectedNode)return;const b=new T.Box3().setFromObject(selectedNode),c=b.getCenter(new T.Vector3()),d=Math.max(1,b.getSize(new T.Vector3()).length()*1.6);controls.target.copy(c);camera.position.copy(c).add(new T.Vector3(.8,.6,1).normalize().multiplyScalar(d));camera.far=Math.max(5000,d*12);camera.updateProjectionMatrix();controls.update();}
function setMode(mode){if(placement.active)placement.cancel();editorMode=mode;document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));if(mode==='select')gizmo.detach();else{gizmo.setMode(mode);attachTransformHandle();}r.domElement.focus();}
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
gizmo.setSpace($('space').value);
$('space').onchange=e=>{if(placement.active)placement.cancel();gizmo.setSpace(e.target.value);attachTransformHandle();};
$('snap').onchange=e=>{gizmo.setTranslationSnap(e.target.checked?.1:null);gizmo.setRotationSnap(e.target.checked?T.MathUtils.degToRad(15):null);gizmo.setScaleSnap(e.target.checked?.1:null);};
function readNodeTransform(node){const q=node.quaternion,ue=new T.Quaternion(-q.x,-q.z,-q.y,q.w),m=new T.Matrix4().makeRotationFromQuaternion(ue).elements;const pitch=Math.asin(T.MathUtils.clamp(m[2],-1,1));let yaw,roll;if(Math.abs(Math.cos(pitch))>1e-7){yaw=Math.atan2(m[1],m[0]);roll=Math.atan2(-m[6],m[10]);}else{yaw=Math.atan2(-m[4],m[5]);roll=0;}return{position:{x:node.position.x*100,y:node.position.z*100,z:node.position.y*100},rotation:{x:T.MathUtils.radToDeg(pitch),y:T.MathUtils.radToDeg(yaw),z:T.MathUtils.radToDeg(roll)},scale:{x:node.scale.x,y:node.scale.z,z:node.scale.y}};}
const buildLegality=installBuildLegality({onChange:()=>{if(gizmo.dragging)gizmo.reset();if(grabRotation)attachGrabRotation();else attachTransformHandle();renderProperties();}});
function enforceDragLegality(){
  if(!buildLegality.enabled||!dragStart||!['rotate','scale'].includes(editorMode))return;
  const changes=dragStart.map(({node})=>{const value=readNodeTransform(node);return{node,value,limited:buildLegality.constrain(node.userData.id,value,editorMode)};});
  // Reject a forbidden group rotation as a whole, keeping all relative positions intact.
  const blocked=editorMode==='rotate'&&changes.some(({value,limited})=>['x','z'].some(axis=>Math.abs(value.rotation[axis]-limited.rotation[axis])>1e-6));
  if(blocked&&changes.length>1){for(const start of dragStart){start.node.position.copy(start.position);start.node.quaternion.copy(start.quaternion);}status.textContent='建造合法性：组合内有物品禁止此方向旋转';return;}
  for(const {node,value,limited} of changes){if(editorMode==='rotate'){node.quaternion.fromArray(saveRotationToScene(limited.rotation));}else node.scale.set(limited.scale.x,limited.scale.z,limited.scale.y);node.updateMatrixWorld(true);}
}
function changeGrabRotation(){
  if(!grabRotation?.start)return;
  const {nodes,frame,start,operation}=grabRotation;frame.apply(operation);
  if(operation==='translate'){
    for(const node of nodes)node.updateMatrixWorld(true);
    panel.dataset.placementMove=JSON.stringify(nodes.map(node=>readNodeTransform(node).position));return;
  }
  if(buildLegality.enabled){
    const values=nodes.map(node=>({node,value:readNodeTransform(node)}));
    const changes=values.map(({node,value})=>({node,value,limited:buildLegality.constrain(node.userData.id,value,'rotate')}));
    const blocked=changes.some(({value,limited})=>['x','z'].some(axis=>Math.abs(value.rotation[axis]-limited.rotation[axis])>1e-6));
    if(blocked&&nodes.length>1){for(const before of start){before.node.position.copy(before.position);before.node.quaternion.copy(before.quaternion);}status.textContent='建造合法性：组合内有物品禁止此方向旋转';}
    else for(const {node,limited} of changes)node.quaternion.fromArray(saveRotationToScene(limited.rotation));
  }
  for(const node of nodes)node.updateMatrixWorld(true);
  panel.dataset.placementRotation=JSON.stringify(nodes.map(node=>readNodeTransform(node).rotation));
}
gizmo.addEventListener('dragging-changed',e=>{controls.enabled=!e.value;if(grabRotation){if(e.value){grabRotation.start=grabRotation.nodes.map(node=>({node,position:node.position.clone(),quaternion:node.quaternion.clone()}));if(grabRotation.frame===grabMultiFrame)grabMultiFrame.begin();}else{grabRotation.start=null;suppressPickUntil=performance.now()+200;attachGrabRotation();}return;}if(arrayState&&gizmo.object===arrayFrame){if(e.value){arrayState.axes=gizmo.axis??'X';panel.dataset.arrayDragAxis=arrayState.axes;}else{placement.update();suppressPickUntil=performance.now()+200;placement.confirm();if(arrayState){arrayFrame.position.copy(arrayState.start);placement.update();}}return;}if(e.value){dragStart=[...selectedNodes].map(node=>({node,index:group.children.indexOf(node),position:node.position.clone(),quaternion:node.quaternion.clone()}));if(gizmo.object===multiTransformFrame.object)multiTransformFrame.begin();}else if(dragStart&&selectedNode){const changes=dragStart.map(({node,index})=>{const value=readNodeTransform(node);if(editorMode!=='rotate')value.rotation=structuredClone(entries[index].rotation);if(editorMode!=='scale')value.scale=structuredClone(entries[index].scale);for(const kind of ['position','rotation','scale'])for(const axis of ['x','y','z'])if(Math.abs(value[kind][axis]-entries[index][kind][axis])<1e-6)value[kind][axis]=entries[index][kind][axis];return{index,value};});if(changes.length===1)saveDocument.transform(changes[0].index,changes[0].value);else saveDocument.transformMany(changes);dragStart=null;suppressPickUntil=performance.now()+200;syncDocumentTransforms();}});
gizmo.addEventListener('objectChange',()=>{if(grabRotation){changeGrabRotation();return;}if(arrayState&&gizmo.object===arrayFrame){placement.update();return;}if(!selectedNode)return;const started=performance.now();if(gizmo.object===transformFrame.object)transformFrame.apply(editorMode);if(gizmo.object===multiTransformFrame.object)multiTransformFrame.apply(editorMode);enforceDragLegality();const writes=batches.syncOwners(selectedNodes);panel.dataset.transformCpuMs=(performance.now()-started).toFixed(2);panel.dataset.transformInstanceWrites=String(writes);});
$('sceneTab').onclick=()=>{presetPanel?.leave();libraryMode=false;$('sceneTab').classList.add('active');$('libraryTab').classList.remove('active');renderList();};
$('libraryTab').onclick=()=>{presetPanel?.leave();libraryMode=true;$('libraryTab').classList.add('active');$('sceneTab').classList.remove('active');renderList();};
$('majorCategory').onchange=()=>{$('minorCategory').value='';renderList();};$('minorCategory').onchange=renderList;
let searchTimer;$('sceneSearch').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(renderList,120);};
$('importSave').onclick=()=>$('save').click();
$('applyProperties').onclick=()=>{if(!selectedNode||readyRun!==run)return;const value=structuredClone({position:selectedNode.userData.position,rotation:selectedNode.userData.rotation,scale:selectedNode.userData.scale});for(const input of $('properties').querySelectorAll('[data-field]')){const [kind,axis]=input.dataset.field.split('.'),number=Number(input.value);if(!Number.isFinite(number)||(kind==='scale'&&number<=0)){status.textContent='请填写有效数字，缩放倍率需要大于 0。';return;}value[kind][axis]=number;}saveDocument.transform(selectedIndex,buildLegality.constrain(selectedNode.userData.id,value,'properties'));syncDocumentTransforms();};
function downloadValidatedSave(data,corrected=false){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=saveDocument.name.replace(/\.json$/i,'')+(corrected?'_validated':'_edited')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent=corrected?'已按 Momo 规则修正导出；工作区保持原样。':'已导出当前数据；工作区保持原样。';}
const saveValidation=installSaveValidation({getDocument:()=>saveDocument,selectIndices:indices=>{restoreVisibility();applySelection(indices.map(i=>group.children[i]).filter(Boolean));focusEditor();},exportData:downloadValidatedSave});
const gameFiles=installGameFiles({getDocument:()=>saveDocument,isReady:()=>readyRun===run&&!!saveDocument,loadDocument:async(raw,name)=>{openDocument(raw,name);await rebuild();renderWorkspace();},validate:(callback,title)=>saveValidation.open({callback,title}),notify:message=>notify(message),onSaved:(doc,revision,corrected,name)=>{if(doc===saveDocument&&doc.revision===revision&&!corrected){doc.savedRevision=revision;doc.name=name;renderWorkspace(false);}}});
function setNodeEntry(node,a){node.userData={...node.userData,...a};node.position.set(a.position.x/100,a.position.z/100,a.position.y/100);node.quaternion.fromArray(saveRotationToScene(a.rotation));node.scale.set(a.scale.x,a.scale.z,a.scale.y);}
function finishDuplicateUpdate(nodes,started){
  grassGround.invalidate(group);
  viewMenu.prepareMaterials();viewMenu.applyVisibility();
  applySelection(nodes);renderWorkspace(false);queueStructureListRefresh();
  if(nodes.some(n=>n.userData.textureQuality!==materialQuality()))updateSceneTextureQuality();
  summary.textContent=`物品 ${entries.length} 件 · 局部更新，复用已有模型和贴图`;
  panel.dataset.structureUpdate='incremental';panel.dataset.structureCpuMs=(performance.now()-started).toFixed(2);panel.dataset.sceneGeneration=String(run);
}
function syncDuplicateHistory(){
  const next=parse(saveDocument.data),current=new Map(group.children.map(n=>[String(n.userData.instance),n]));
  if(next.some(a=>!current.has(String(a.instance))&&!duplicateNodes.has(String(a.instance))))return false;
  const started=performance.now(),selected=[...selectedNodes].map(n=>String(n.userData.instance));
  selectionHighlighter.clear();viewMenu.restoreMaterials();gizmo.detach();
  const keep=new Set(next.map(a=>String(a.instance))),removed=[];
  for(const node of [...group.children])if(!keep.has(String(node.userData.instance))){duplicateNodes.set(String(node.userData.instance),node);node.visible=false;removed.push(node);group.remove(node);}
  batches.syncOwners(removed);
  const nextIndex=new Map(next.map((a,i)=>[String(a.instance),i])),restored=[];
  for(const a of next){const key=String(a.instance);if(!current.has(key)){const node=duplicateNodes.get(key);group.add(node);restored.push(node);}setNodeEntry(current.get(key)??duplicateNodes.get(key),a);}
  group.children.sort((a,b)=>nextIndex.get(String(a.userData.instance))-nextIndex.get(String(b.userData.instance)));
  entries=next;
  const byId=new Map(group.children.map(n=>[String(n.userData.instance),n]));
  finishDuplicateUpdate(restored.length?restored:selected.map(id=>byId.get(id)).filter(Boolean),started);
  batches.syncOwners(restored);return true;
}
$('duplicate').onclick=()=>{
  placement.cancel();
  if(selectedIndex<0||readyRun!==run||gizmo.dragging)return;
  const started=performance.now(),sources=[...selectedNodes];
  selectionHighlighter.clear();viewMenu.restoreMaterials();
  const clones=sources.map(source=>cloneLoadedFurniture(source,cloneSkeleton,batches.ownerIndex.get(source)??[]));
  gizmo.detach();placement.begin(async()=>clones,`${clones.length} 件复制物品`,(nodes,offset)=>{
    const added=saveDocument.duplicateMany(sources.map(n=>group.children.indexOf(n)),placementPositions(nodes,offset),nodes.map(n=>readNodeTransform(n).rotation));
    added.forEach((index,i)=>{const a=parse([saveDocument.rows[index]])[0],node=nodes[i];setNodeEntry(node,a);entries.push(a);group.add(node);duplicateNodes.set(String(a.instance),node);renderQuality.prepare(node);});
    finishDuplicateUpdate(nodes,performance.now());status.textContent=`已放置 ${nodes.length} 件复制物品 · 已复用模型和贴图`;
  });
};
$('arrayDuplicate').onclick=async()=>{
  placement.cancel();if(selectedIndex<0||readyRun!==run||gizmo.dragging)return;
  const sources=[...selectedNodes];selectionHighlighter.clear();viewMenu.restoreMaterials();gizmo.detach();
  const bounds=new T.Box3();sources.forEach(n=>bounds.union(new T.Box3().setFromObject(n)));
  const start=bounds.getCenter(new T.Vector3()),quaternion=selectedNode.quaternion.clone().multiply(selectedNode.children[0]?.quaternion??new T.Quaternion());
  const previous={mode:gizmo.mode,space:gizmo.space,snap:gizmo.translationSnap};
  arrayFrame.position.copy(start);arrayFrame.quaternion.copy(quaternion);arrayFrame.scale.set(1,1,1);arrayFrame.updateMatrixWorld(true);
  arrayState={start,quaternion,axes:''};
  await placement.beginArray(async()=>sources.map(source=>cloneLoadedFurniture(source,cloneSkeleton,batches.ownerIndex.get(source)??[])),`${sources.length} 件阵列物品`,(nodes,offset)=>{
    const indices=nodes.map((_,i)=>group.children.indexOf(sources[i%sources.length]));
    const added=saveDocument.duplicateMany(indices,placementPositions(nodes,offset),nodes.map(n=>readNodeTransform(n).rotation));
    added.forEach((index,i)=>{const a=parse([saveDocument.rows[index]])[0],node=nodes[i];setNodeEntry(node,a);entries.push(a);group.add(node);duplicateNodes.set(String(a.instance),node);renderQuality.prepare(node);});
    finishDuplicateUpdate(nodes,performance.now());status.textContent=`已阵列复制 ${nodes.length/sources.length} 组 / ${nodes.length} 件物品 · 可一次撤销`;
  },{clone:node=>cloneLoadedFurniture(node,cloneSkeleton),handle:true,layout:points=>localDragArrayLayout(points,quaternion,arrayFrame.position.clone().sub(start),arrayState?.axes??''),onEnd:()=>{
    arrayState=null;gizmo.dragging=false;gizmo.axis=null;gizmo.detach();gizmo.setMode(previous.mode);gizmo.setSpace(previous.space);gizmo.setTranslationSnap(previous.snap);controls.enabled=true;
  }});
  if(placement.active&&arrayState){gizmo.setMode('translate');gizmo.setSpace('local');gizmo.setTranslationSnap(null);gizmo.showX=gizmo.showY=gizmo.showZ=true;gizmo.attach(arrayFrame);panel.dataset.transformFrame='local-array';}
};

const curveArray=installCurveArray({scene,camera,canvas:r.domElement,panel,status,controls,placement,begin:options=>{
  const sources=[...selectedNodes];selectionHighlighter.clear();viewMenu.restoreMaterials();gizmo.detach();
  return placement.beginArray(async()=>sources.map(source=>cloneLoadedFurniture(source,cloneSkeleton,batches.ownerIndex.get(source)??[])),`${sources.length} 件曲线阵列物品`,(nodes,offset)=>{
    const added=saveDocument.duplicateMany(nodes.map((_,i)=>group.children.indexOf(sources[i%sources.length])),placementPositions(nodes,offset),nodes.map(n=>readNodeTransform(n).rotation));
    added.forEach((index,i)=>{const a=parse([saveDocument.rows[index]])[0],node=nodes[i];setNodeEntry(node,a);entries.push(a);group.add(node);duplicateNodes.set(String(a.instance),node);renderQuality.prepare(node);});
    finishDuplicateUpdate(nodes,performance.now());status.textContent=`已沿曲线生成 ${nodes.length/sources.length} 组 / ${nodes.length} 件物品 · 可一次撤销`;
  },{...options,clone:node=>cloneLoadedFurniture(node,cloneSkeleton),prepareCopy:node=>{if(buildLegality.enabled){const limited=buildLegality.constrain(node.userData.id,readNodeTransform(node),'rotate');node.quaternion.fromArray(saveRotationToScene(limited.rotation));}}});
}});
$('curveDuplicate').onclick=()=>{
  if(selectedIndex<0||readyRun!==run||gizmo.dragging)return;
  const bounds=new T.Box3();for(const node of selectedNodes)bounds.union(new T.Box3().setFromObject(node));
  const anchor=bounds.getCenter(new T.Vector3());anchor.y=bounds.min.y;
  const size=bounds.getSize(new T.Vector3());curveArray.start(anchor,Math.max(.1,size.x,size.z),selectedNode.quaternion.clone().multiply(selectedNode.children[0]?.quaternion??new T.Quaternion()));
};

$('grab').onclick=()=>{
  if(selectedIndex<0||readyRun!==run||gizmo.dragging)return;
  placement.cancel();const sources=[...selectedNodes],visibility=sources.map(n=>n.visible);
  selectionHighlighter.clear();viewMenu.restoreMaterials();gizmo.detach();
  const restore=()=>{sources.forEach((n,i)=>n.visible=visibility[i]);batches.syncOwners(sources);};
  placement.begin(async()=>{
    const clones=sources.map(source=>cloneLoadedFurniture(source,cloneSkeleton,batches.ownerIndex.get(source)??[]));
    sources.forEach(n=>n.visible=false);batches.syncOwners(sources);return clones;
  },sources.length===1?(furniture[sources[0].userData.id]?.name??'物品'):`${sources.length} 件物品`,(nodes,offset)=>{
    const positions=placementPositions(nodes,offset);restore();
    saveDocument.transformMany(sources.map((node,i)=>({index:group.children.indexOf(node),value:{position:positions[i],rotation:readNodeTransform(nodes[i]).rotation,scale:structuredClone(node.userData.scale)}})));
    syncDocumentTransforms();status.textContent=`已重新放置 ${sources.length} 件物品 · 可撤销`;
  },restore);
};
let structureListDirty=false;
function queueStructureListRefresh(){structureListDirty=true;if(!document.querySelector('.left-panel').classList.contains('panel-collapsed')){requestAnimationFrame(()=>{if(structureListDirty){renderList();structureListDirty=false;}});}}
new MutationObserver(()=>{if(structureListDirty&&!document.querySelector('.left-panel').classList.contains('panel-collapsed')){renderList();structureListDirty=false;}}).observe(document.querySelector('.left-panel'),{attributes:true,attributeFilter:['class']});
$('delete').onclick=()=>{
  placement.cancel();
  if(selectedIndex<0||readyRun!==run||gizmo.dragging)return;
  const started=performance.now(),removed=[...selectedNodes],indices=removed.map(n=>group.children.indexOf(n));
  saveDocument.removeMany(indices);selectionHighlighter.clear();viewMenu.restoreMaterials();gizmo.detach();
  for(const node of removed){duplicateNodes.set(String(node.userData.instance),node);node.visible=false;group.remove(node);}
  batches.syncOwners(removed);for(const i of indices.sort((a,b)=>b-a))entries.splice(i,1);
  finishDuplicateUpdate([],started);status.textContent=`已删除 ${removed.length} 件物品 · 其余模型和贴图保持加载状态`;
};
$('undo').onclick=async()=>{if(placement.active){placement.cancel();return;}if(!saveDocument?.undoStack.length||readyRun!==run)return;const label=saveDocument.undo();if(label==='修改变换')syncDocumentTransforms();else if(label==='修改染色')await syncDocumentDyes();else if(['添加物品','复制物品','删除物品'].includes(label)&&syncDuplicateHistory()){}else await rebuildEditor(Math.min(selectedIndex,saveDocument.rows.length-1));};
$('redo').onclick=async()=>{if(placement.active)return;if(!saveDocument?.redoStack.length||readyRun!==run)return;const label=saveDocument.redo();if(label==='修改变换')syncDocumentTransforms();else if(label==='修改染色')await syncDocumentDyes();else if(['添加物品','复制物品','删除物品'].includes(label)&&syncDuplicateHistory()){}else await rebuildEditor(Math.min(selectedIndex,saveDocument.rows.length-1));};
$('focusSelection').onclick=focusEditor;
window.addEventListener('keydown',e=>{
  if(e.target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])')||e.isComposing)return;
  const key=e.key.toLowerCase();
  if(e.ctrlKey||e.metaKey){
    const id={z:e.shiftKey?'redo':'undo',y:'redo',s:e.shiftKey?'exportSave':'saveGame',d:'duplicate',c:'duplicate',v:'duplicate'}[key];
    if(id){e.preventDefault();if(!e.repeat&&!gizmo.dragging&&(!placement.active||id==='undo')&&!$(id).disabled)$(id).click();}
    return;
  }
  if(e.altKey)return;
  const mode={m:'translate',r:'rotate',v:'scale'}[key],id={t:'grab',delete:'delete'}[key];
  if(!mode&&!id)return;e.preventDefault();
  if(e.repeat||gizmo.dragging||placement.active||readyRun!==run)return;
  if(mode)setMode(mode);else if(!$(id).disabled)$(id).click();
});
// Browser Edit/Copy commands can dispatch a copy event without a keydown.
r.domElement.addEventListener('copy',e=>{e.preventDefault();if(!gizmo.dragging&&!placement.active&&!$('duplicate').disabled)$('duplicate').click();});
window.addEventListener('beforeunload',e=>{if(saveDocument?.dirty){e.preventDefault();e.returnValue='';}});

$('importSave').disabled=true;initial().finally(()=>$('importSave').disabled=false);
