import * as T from 'three';
import {createStorybookSky} from './storybook_environment.js';
import {pcss} from './drei_pcss.js';

export const RENDER_LEVELS = {
  light: {label:'轻量', pixels:1, shadow:0, radius:60},
  standard: {label:'标准', pixels:1.5, shadow:2048, radius:60},
  fine: {label:'精细', pixels:2, shadow:4096, radius:60}
};

// Presentation only. Furniture transforms and document data never enter this module.
export function installRenderQuality({renderer,scene,camera,controls,sun,hemisphere,select,note}){
  const direction=new T.Vector3(-.5,.7,.45).normalize();
  const skyBackground=createStorybookSky();
  const pmrem=new T.PMREMGenerator(renderer);
  // Three.js environment-map pattern: the reflected world matches the visible sky.
  // Painted clouds form broad light sources instead of a tiny HDR sun highlight.
  const environment=pmrem.fromEquirectangular(skyBackground);
  const previous=scene.environment;scene.environment=environment.texture;previous?.dispose();
  // Keep the visible sky blue: HDR lighting values otherwise wash out under exposure.
  scene.background=skyBackground;
  scene.backgroundIntensity=1;
  scene.backgroundBlurriness=0;
  pmrem.dispose();
  // Broad sky illumination and restrained direct light preserve bright texture details.
  scene.environmentIntensity=1.15;
  hemisphere.color.set(0xeff5ff);hemisphere.groundColor.set(0xe4d3ae);hemisphere.intensity=2.15;
  sun.color.set(0xffedcf);sun.intensity=1.5;
  const fill=new T.DirectionalLight(0xe6efff,.55);
  fill.position.set(-35,25,-40);fill.castShadow=false;scene.add(fill);
  // Very light distance haze adds depth without obscuring the editing foreground.
  scene.fog=new T.FogExp2(0xe8e6d8,.00015);
  scene.add(sun.target);sun.shadow.bias=-.000025;sun.shadow.normalBias=.012;
  sun.shadow.intensity=.48;sun.shadow.radius=3;
  renderer.shadowMap.type=T.PCFShadowMap;
  renderer.toneMappingExposure=1.1;
  const brightnessRow=document.createElement('label');brightnessRow.className='environment-brightness';
  const brightness=document.createElement('input'),brightnessValue=document.createElement('output');
  brightness.type='range';brightness.min='.75';brightness.max='1.5';brightness.step='.05';brightness.value='1';
  brightness.setAttribute('aria-label','环境亮度');brightnessRow.append('环境亮度 ',brightness,brightnessValue);
  note.after(brightnessRow);
  const setBrightness=()=>{const value=Number(brightness.value);renderer.toneMappingExposure=1.1*value;
    brightnessValue.textContent=Math.round(value*100)+'%';
    try{localStorage.setItem('nikki.environmentBrightness',brightness.value);}catch{}
  };
  brightness.oninput=setBrightness;
  try{const saved=Number(localStorage.getItem('nikki.environmentBrightness'));if(saved>=.75&&saved<=1.5)brightness.value=String(saved);}catch{}
  setBrightness();
  let level='standard',lastCenter=new T.Vector3(Infinity,Infinity,Infinity),lastRadius=0,restoreShadows;
  function apply(value){
    level=Object.hasOwn(RENDER_LEVELS,value)?value:'standard';const settings=RENDER_LEVELS[level];
    restoreShadows?.();restoreShadows=undefined;
    if(level==='fine')restoreShadows=pcss({size:16,samples:8});
    // r183 uses comparison depth samplers for PCF. PCSS blocker search needs
    // the raw depth texture supplied by BasicShadowMap, filtered by our helper.
    renderer.shadowMap.type=level==='fine'?T.BasicShadowMap:T.PCFShadowMap;
    select.value=level;
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio||1,settings.pixels));
    renderer.shadowMap.enabled=Boolean(settings.shadow);sun.castShadow=Boolean(settings.shadow);
    sun.shadow.map?.dispose();sun.shadow.map=null;
    sun.shadow.mapSize.setScalar(Math.min(settings.shadow||512,renderer.capabilities.maxTextureSize));
    const c=sun.shadow.camera;c.left=c.bottom=-settings.radius;c.right=c.top=settings.radius;c.near=1;c.far=240;c.updateProjectionMatrix();
    lastCenter.set(Infinity,Infinity,Infinity);lastRadius=0;
    // Existing and future meshes use the same shadow shader when a level changes.
    scene.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])m.needsUpdate=true;});
    renderer.shadowMap.needsUpdate=true;
    note.textContent=settings.shadow?'温馨庭院 · 云朵天空与远山 · '+sun.shadow.mapSize.x+' 柔和阴影':'温馨庭院 · 云朵天空与远山 · 关闭投影，适合大型场景编辑';
    note.textContent+=level==='light'?' · 关闭立体草':level==='fine'?' · 高密度立体草（14米）':' · 立体草（10米）';
    if(level==='fine')note.textContent+=' · PCSS 接触软阴影';
    note.dataset.level=level;
    try{localStorage.setItem('nikki.renderQuality',level);}catch{}
  }
  select.onchange=()=>apply(select.value);
  let saved;try{saved=localStorage.getItem('nikki.renderQuality');}catch{}
  apply(saved||'standard');
  return {
    prepare(root){let casters=0;root.traverse(o=>{if(!o.isMesh||o.userData.unmatched)return;const materials=Array.isArray(o.material)?o.material:[o.material];o.castShadow=!materials.some(m=>m.transparent||m.wireframe);o.receiveShadow=!materials.some(m=>m.wireframe);if(o.castShadow)casters++;});note.dataset.casters=String(casters);},
    update(){
      if(!sun.castShadow)return;
      note.dataset.shadowReady=String(Boolean(sun.shadow.map));
      const center=new T.Vector3(controls.target.x,0,controls.target.z);
      const radius=Math.ceil(Math.max(level==='fine'?12:20,Math.min(60,camera.position.distanceTo(controls.target)*.8))/2)*2;
      if(center.distanceToSquared(lastCenter)<4&&radius===lastRadius)return;
      // Keep texels stable while orbiting and cover the area being edited.
      center.x=Math.round(center.x/2)*2;center.z=Math.round(center.z/2)*2;
      lastCenter.copy(center);sun.target.position.copy(center);sun.position.copy(center).addScaledVector(direction,100);
      if(radius!==lastRadius){const c=sun.shadow.camera;c.left=c.bottom=-radius;c.right=c.top=radius;c.updateProjectionMatrix();lastRadius=radius;}
      sun.target.updateMatrixWorld();
    },
    get level(){return level;}
  };
}
