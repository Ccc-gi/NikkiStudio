import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {FurnitureInstances} from './furniture_instances.js';
import {previewCameraDistance} from './preset_preview_geometry.js';

export function installPresetPreview({loadItems,isReady,editorState=()=>null}){
  const dialog=document.createElement('dialog');dialog.id='presetModelDialog';dialog.className='preset-model-dialog';dialog.setAttribute('aria-labelledby','presetModelTitle');
  dialog.innerHTML='<header><div><strong id="presetModelTitle">预设模型</strong><small id="presetModelMeta"></small></div><button id="closePresetModel" aria-label="关闭预设模型预览">✕</button></header><div id="presetModelViewport"></div><footer><span id="presetModelStatus" role="status"></span><button id="fitPresetModel">查看整体</button></footer><p>左键旋转 · 右键平移 · 滚轮缩放 · 预览不会修改当前场景</p>';
  document.body.append(dialog);dialog.addEventListener('keydown',e=>e.stopPropagation());
  const viewport=dialog.querySelector('#presetModelViewport'),status=dialog.querySelector('#presetModelStatus');
  let renderer,scene,camera,controls,batches,root,floor,sun,idleTimer,editorBefore,shaderError=false,owned=new Set(),libraryActive=false,viewerActive=false,revision=0,controller,chain=Promise.resolve(),pumping=false,raf=0,lastFrame=0;
  const pending=[],jobs=new Map(),urls=new Map(),listeners=new Set();
  function ensureRenderer(){
    clearTimeout(idleTimer);
    if(renderer)return;
    renderer=new T.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true,logarithmicDepthBuffer:true});
    renderer.setPixelRatio(1);renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
    // Fine editor mode patches the global raw-depth shadow shader. Basic uses
    // that extension safely; PCF defines the same sampling helper a second time.
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.BasicShadowMap;
    renderer.debug.onShaderError=(gl,program,vertex,fragment)=>{shaderError=true;console.error('预设预览材质编译失败：'+gl.getShaderInfoLog(fragment));};
    scene=new T.Scene();scene.background=new T.Color('#e9edf0');
    const room=new RoomEnvironment(),pmrem=new T.PMREMGenerator(renderer);scene.environment=pmrem.fromScene(room,.04).texture;room.dispose();pmrem.dispose();
    scene.add(new T.HemisphereLight(0xf6f8ff,0xb1ad9e,2));
    sun=new T.DirectionalLight(0xfff5e6,2.3);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.bias=-.00015;sun.shadow.intensity=.35;scene.add(sun,sun.target);
    const fill=new T.DirectionalLight(0xdceaff,.7);fill.position.set(-20,15,-10);scene.add(fill);
    camera=new T.PerspectiveCamera(40,1,.01,10000);
    controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.enablePan=true;controls.enabled=false;
    batches=new FurnitureInstances(scene);
  }
  function release(){
    if(!renderer)return;batches.clear();
    if(root){scene.remove(root);root.traverse(o=>{if(o.userData.previewOwnedGeometry)o.geometry.dispose();});root=null;}
    for(const material of owned)material.dispose();owned.clear();
    if(floor){scene.remove(floor);floor.geometry.dispose();floor.material.dispose();floor=null;}
    renderer.renderLists.dispose();clearTimeout(idleTimer);
    idleTimer=setTimeout(()=>{if(viewerActive||pumping)return;
      viewport.replaceChildren();controls.dispose();scene.environment?.dispose();sun.shadow.dispose();renderer.dispose();renderer.forceContextLoss();renderer=null;scene=null;
    },5000);
  }
  function sizeRenderer(width,height){renderer.setSize(Math.max(1,width),Math.max(1,height),false);camera.aspect=width/height;camera.updateProjectionMatrix();}
  function fit(){
    if(!root)return;root.updateMatrixWorld(true);
    const box=root.userData.previewBounds,size=box.getSize(new T.Vector3()),center=box.getCenter(new T.Vector3()),distance=previewCameraDistance(size,camera.aspect);
    camera.near=Math.max(.01,distance/10000);camera.far=Math.max(100,distance*20);camera.updateProjectionMatrix();
    controls.target.copy(center);camera.position.copy(center).add(new T.Vector3(1,.65,1.15).normalize().multiplyScalar(distance));
    controls.minDistance=distance*.03;controls.maxDistance=distance*8;controls.update();renderer.render(scene,camera);
  }
  function attach(result){
    release();shaderError=false;root=result.group;scene.add(root);
    const materialCopies=new Map();
    root.traverse(o=>{if(!o.isMesh)return;
      const clone=m=>{if(!materialCopies.has(m)){const copy=m.clone();copy.onBeforeCompile=m.onBeforeCompile;copy.customProgramCacheKey=m.customProgramCacheKey;copy.envMapIntensity=.45;materialCopies.set(m,copy);owned.add(copy);}return materialCopies.get(m);};
      const original=o.material;
      o.material=Array.isArray(o.material)?o.material.map(clone):clone(o.material);
      if(o.userData.previewOwnedMaterial)original.dispose();
      o.castShadow=result.total<=200&&!o.userData.previewOwnedGeometry;o.receiveShadow=true;
    });
    root.updateMatrixWorld(true);const box=new T.Box3().setFromObject(root);if(box.isEmpty())throw Error('这个预设没有可预览的模型');root.userData.previewBounds=box;
    const size=box.getSize(new T.Vector3()),center=box.getCenter(new T.Vector3()),extent=Math.max(size.x,size.y,size.z,1);
    floor=new T.Mesh(new T.PlaneGeometry(extent*30,extent*30),new T.MeshStandardMaterial({color:0xcbd3d6,roughness:1,metalness:0}));floor.rotation.x=-Math.PI/2;floor.position.set(center.x,box.min.y-extent*.002,center.z);floor.receiveShadow=true;scene.add(floor);
    sun.position.copy(center).add(new T.Vector3(.6,1,.5).multiplyScalar(extent*2));sun.target.position.copy(center);
    const shadow=extent*.85;Object.assign(sun.shadow.camera,{left:-shadow,right:shadow,top:shadow,bottom:-shadow,near:.01,far:extent*8});sun.shadow.camera.updateProjectionMatrix();sun.shadow.normalBias=extent*.0004;
    renderer.shadowMap.enabled=result.total<=200;batches.rebuild(root);fit();
    return result;
  }
  async function exclusive(work){const task=chain.catch(()=>{}).then(work);chain=task;return task;}
  async function load(document_,signal,onProgress){
    const result=await loadItems(document_.items,{signal,onProgress});
    if(signal.aborted){result.group.traverse(o=>{if(o.userData.previewOwnedGeometry)o.geometry.dispose();if(o.userData.previewOwnedMaterial)o.material.dispose();});throw new DOMException('预览已取消','AbortError');}
    ensureRenderer();return attach(result);
  }
  async function saveThumbnail(preset,result){
    if(!preset.previewKey||result.missing.length)return null;
    if(shaderError)throw Error('预览材质编译失败，未缓存缩略图');
    const oldPosition=camera.position.clone(),oldTarget=controls.target.clone(),oldSize=renderer.getSize(new T.Vector2());
    controls.enabled=false;sizeRenderer(512,320);fit();
    const blob=await new Promise(resolve=>renderer.domElement.toBlob(resolve,'image/png'));
    sizeRenderer(oldSize.x,oldSize.y);camera.position.copy(oldPosition);controls.target.copy(oldTarget);controls.update();
    if(viewerActive)controls.enabled=true;
    if(!blob)throw Error('预览图生成失败');
    const image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(Error('预览图编码失败'));reader.readAsDataURL(blob);});
    const session=await fetch('/api/session',{cache:'no-store'}).then(r=>r.json());
    const response=await fetch('/api/presets/preview',{method:'POST',headers:{'Content-Type':'application/json','X-Nikki-Token':session.token},body:JSON.stringify({id:preset.id,key:preset.previewKey,image})});
    const value=await response.json();if(!response.ok)throw Error(value.error??'预览图保存失败');
    urls.set(preset.previewKey,value.url);for(const listener of listeners)listener(preset.previewKey,value.url);return value.url;
  }
  async function pump(){
    if(pumping||viewerActive||!libraryActive)return;pumping=true;
    try{while(pending.length&&libraryActive&&!viewerActive){
      if(!isReady()){setTimeout(pump,500);break;}
      const job=pending.shift();controller=new AbortController();const signal=controller.signal;
      try{const url=await exclusive(async()=>{
        const response=await fetch('/api/presets/'+encodeURIComponent(job.preset.id),{cache:'no-store'});if(!response.ok)throw Error('预设无法读取');const document_=await response.json();
        const result=await load(document_,signal,()=>{});sizeRenderer(512,320);fit();
        if(result.missing.length)throw Error('部分模型缺失，点击查看');
        return saveThumbnail(job.preset,result);
      });job.resolve(url);}catch(error){jobs.delete(job.preset.previewKey);job.reject(error);}finally{if(!viewerActive)release();}
    }}finally{pumping=false;}
  }
  function thumbnail(preset){
    if(preset.previewUrl)return Promise.resolve(preset.previewUrl);
    if(urls.has(preset.previewKey))return Promise.resolve(urls.get(preset.previewKey));
    if(!preset.previewKey)return Promise.reject(Error(preset.previewError??'预设无法读取'));
    if(!jobs.has(preset.previewKey)){const task=new Promise((resolve,reject)=>pending.push({preset,resolve,reject}));jobs.set(preset.previewKey,task);pump();}
    return jobs.get(preset.previewKey);
  }
  function animate(time){if(!viewerActive)return;raf=requestAnimationFrame(animate);if(time-lastFrame<33||document.hidden)return;lastFrame=time;controls?.update();if(root){renderer.render(scene,camera);dialog.dataset.drawCalls=String(renderer.info.render.calls);dialog.dataset.frames=String(Number(dialog.dataset.frames??0)+1);}}
  function close(){viewerActive=false;revision++;controller?.abort();cancelAnimationFrame(raf);if(dialog.open)dialog.close();if(controls)controls.enabled=false;
    dialog.dataset.editorPreserved=String(editorBefore===JSON.stringify(editorState()));
    exclusive(()=>release()).finally(()=>pump());
  }
  async function open(document_,preset){
    if(!viewerActive)editorBefore=JSON.stringify(editorState());
    viewerActive=true;const token=++revision;controller?.abort();controller=new AbortController();const signal=controller.signal;
    dialog.querySelector('#presetModelTitle').textContent=document_.name;dialog.querySelector('#presetModelMeta').textContent=document_.items.length+' 件物品';status.textContent='正在准备模型与材质…';
    if(!dialog.open)dialog.showModal();cancelAnimationFrame(raf);
    try{await exclusive(async()=>{
      if(token!==revision)return;
      const result=await load(document_,signal,(done,total)=>{if(token===revision)status.textContent=`正在载入 ${done} / ${total} 件物品…`;});
      if(token!==revision)return;viewport.replaceChildren(renderer.domElement);
      const rect=viewport.getBoundingClientRect();sizeRenderer(rect.width,rect.height);fit();controls.enabled=true;
      status.textContent=result.missing.length?`已显示 ${result.total-result.failed} / ${result.total} 件 · 缺失 ID：${result.missing.slice(0,10).join('、')}（预设已保留）`:`${result.total} 件物品 · 可旋转、缩放查看`;
      dialog.dataset.items=String(result.total);dialog.dataset.missing=JSON.stringify(result.missing);
      dialog.dataset.editorPreserved=String(editorBefore===JSON.stringify(editorState()));
      raf=requestAnimationFrame(animate);
      try{await saveThumbnail(preset,result);}catch(error){if(token===revision)status.textContent+=' · '+error.message;}
    });}catch(error){if(token===revision&&!signal.aborted)status.textContent='预览失败：'+error.message;}
  }
  const resize=new ResizeObserver(()=>{if(viewerActive&&renderer&&root){const rect=viewport.getBoundingClientRect();sizeRenderer(rect.width,rect.height);renderer.render(scene,camera);}});resize.observe(viewport);
  dialog.querySelector('#closePresetModel').onclick=close;dialog.querySelector('#fitPresetModel').onclick=fit;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  return {open,thumbnail,subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},setLibraryActive(value){libraryActive=value;if(value)pump();else if(!viewerActive)controller?.abort();}};
}
