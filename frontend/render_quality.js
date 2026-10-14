import * as T from 'three';
import {pcss} from './drei_pcss.js';
import {applyLegacyLighting,applyDaylightLighting,applyDaylightShadow} from './lighting_profiles.js';
import {installSkyDome} from './sky_dome.js';
import {DAY_HOURS,wrapHours,sampleDaylight} from './daylight_cycle.js';

export const RENDER_LEVELS = {
  light: {label:'轻量', pixels:1, shadow:0, radius:60},
  standard: {label:'标准', pixels:1.5, shadow:2048, radius:60},
  fine: {label:'精细', pixels:2, shadow:4096, radius:60}
};

const DEFAULT_HOURS=13,DEFAULT_CYCLE_MINUTES=3;
const SLIDER_MAX=DAY_HOURS-.25;
// Both legacy levels keep the authored noon sky.
const NOON_WEIGHT=sampleDaylight(13).skyWeight;
const LEGACY_FOG_COLOR=0xe8e6d8,LEGACY_FOG_DENSITY=.00015;
// A source exactly on the horizon makes the shadow frustum degenerate, so the
// light is nudged up while the reported elevation stays honest.
const MIN_LIGHT_ELEVATION=2;
const KELVIN_MIN=2200,KELVIN_MAX=9000;
// A long stall (tab switch, model load) must not teleport the clock.
const MAX_STEP_MS=250;

// Blackbody approximation, used only to drive the warmth slider.
export function kelvinToHex(kelvin){
  const t=Math.min(40000,Math.max(1000,kelvin))/100;
  const clamp=v=>Math.round(Math.max(0,Math.min(255,v)));
  const r=t<=66?255:329.698727446*Math.pow(t-60,-.1332047592);
  const g=t<=66?99.4708025861*Math.log(t)-161.1195681661:288.1221695283*Math.pow(t-60,-.0755148492);
  const b=t>=66?255:t<=19?0:138.5177312231*Math.log(t-10)-305.0447927307;
  return (clamp(r)<<16)|(clamp(g)<<8)|clamp(b);
}

// Nearest blackbody to an authored light colour, so switching to manual does not
// jump the sun.
export function closestKelvin(hex){
  let best=KELVIN_MIN,bestDistance=Infinity;
  for(let k=KELVIN_MIN;k<=KELVIN_MAX;k+=50){
    const c=kelvinToHex(k);
    const d=((c>>16&255)-(hex>>16&255))**2+((c>>8&255)-(hex>>8&255))**2+((c&255)-(hex&255))**2;
    if(d<bestDistance){bestDistance=d;best=k;}
  }
  return Math.min(KELVIN_MAX,Math.max(KELVIN_MIN,Math.round(best/100)*100));
}

// Sparse overrides: anything the user has not touched keeps following the clock,
// so switching to manual never moves a value on its own. They edit whichever
// beam is the direct light right now — the sun by day, the moon by night — and
// its counterpart is kept as the mirror image, so the controls always do
// something visible.
export function manualState(base,overrides){
  const night=base.sunElevation<0;
  const azimuth=overrides.azimuth??base.lightAzimuth;
  const elevation=overrides.elevation??base.lightElevation;
  const intensity=overrides.intensity??base.lightIntensity;
  const color=overrides.kelvin===undefined?base.lightColor:kelvinToHex(overrides.kelvin);
  return {...base,
    lightAzimuth:azimuth,lightElevation:elevation,lightColor:color,lightIntensity:intensity,
    sunAzimuth:night?(azimuth+180)%360:azimuth,
    sunElevation:night?-elevation:elevation,
    sunColor:night?base.sunColor:color,
    sunIntensity:night?base.sunIntensity:intensity,
    moonAzimuth:night?azimuth:(azimuth+180)%360,
    moonElevation:night?elevation:-elevation,
    moonColor:night?color:base.moonColor,
    moonIntensity:night?intensity:base.moonIntensity,
    fogDensity:base.fogDensity*(overrides.fog??1)};
}

function formatClock(hours){
  const total=Math.round(hours*60)%(DAY_HOURS*60);
  return String(Math.floor(total/60)).padStart(2,'0')+':'+String(total%60).padStart(2,'0');
}

function rangeRow(label,min,max,step){
  const row=document.createElement('label');row.className='environment-brightness';
  const input=document.createElement('input'),output=document.createElement('output');
  input.type='range';input.min=String(min);input.max=String(max);input.step=String(step);
  input.value=String(min);input.setAttribute('aria-label',label);
  row.append(label+' ',input,output);
  return {row,input,output};
}

// Presentation only. Furniture transforms and document data never enter this module.
export function installRenderQuality({renderer,scene,camera,controls,sun,hemisphere,select,note}){
  const legacyDirection=new T.Vector3(-.5,.7,.45).normalize();
  const sunDirection=new T.Vector3().copy(legacyDirection);
  const moonDirection=new T.Vector3(0,1,0);
  let level='standard',levelListener=()=>{};
  const sky=installSkyDome({renderer,scene});
  // Legacy baseline: restored verbatim whenever the fine level is left.
  scene.environmentIntensity=1.15;
  hemisphere.color.set(0xeff5ff);hemisphere.groundColor.set(0xe4d3ae);hemisphere.intensity=2.15;
  sun.color.set(0xffedcf);sun.intensity=1.5;
  const fill=new T.DirectionalLight(0xe6efff,.55);
  fill.position.set(-35,25,-40);fill.castShadow=false;scene.add(fill);
  // The moon takes over the direct light after sunset, and with it the shadows.
  const moon=new T.DirectionalLight(0xa8c4e8,0);
  moon.castShadow=false;moon.position.set(0,100,0);
  moon.shadow.bias=-.000025;moon.shadow.radius=3;
  scene.add(moon,moon.target);
  scene.fog=new T.FogExp2(LEGACY_FOG_COLOR,LEGACY_FOG_DENSITY);
  scene.add(sun.target);sun.shadow.bias=-.000025;sun.shadow.radius=3;
  sun.shadow.normalBias=.012;
  sun.shadow.intensity=.48;sun.shadow.radius=3;
  renderer.shadowMap.type=T.PCFShadowMap;
  renderer.toneMappingExposure=1.1;

  const lighting={scene,sun,moon,hemisphere,fill,renderer};

  // Exposure applies to both the legacy presets and the daylight clock, so it
  // stays outside the fine-only block.
  const brightnessRow=document.createElement('label');brightnessRow.className='environment-brightness';
  const brightness=document.createElement('input'),brightnessValue=document.createElement('output');
  brightness.type='range';brightness.min='.75';brightness.max='1.5';brightness.step='.05';brightness.value='1';
  brightness.setAttribute('aria-label','环境亮度');brightnessRow.append('环境亮度 ',brightness,brightnessValue);

  // --- time of day ---------------------------------------------------------
  const timeControls=document.createElement('div');timeControls.className='natural-sun-controls';

  const timeRow=document.createElement('label');timeRow.className='environment-brightness';
  const timeInput=document.createElement('input'),timeValue=document.createElement('output');
  timeInput.type='range';timeInput.min='0';timeInput.max=String(SLIDER_MAX);
  timeInput.step='.25';timeInput.setAttribute('aria-label','时间');
  timeRow.append('时间 ',timeInput,timeValue);

  const autoRow=document.createElement('label');autoRow.className='settings-check';
  const autoInput=document.createElement('input');autoInput.type='checkbox';
  const autoLabel=document.createElement('span');
  autoLabel.append('自动调整',Object.assign(document.createElement('small'),{textContent:'时间自行循环。关闭后可手动选择时刻并调整下列参数。'}));
  autoRow.append(autoInput,autoLabel);

  const cycleRow=document.createElement('label');cycleRow.className='environment-brightness';
  const cycleInput=document.createElement('input'),cycleValue=document.createElement('output');
  cycleInput.type='range';cycleInput.min='1';cycleInput.max='10';cycleInput.step='1';
  cycleInput.setAttribute('aria-label','循环时长');
  cycleRow.append('循环时长 ',cycleInput,cycleValue);

  const advanced=document.createElement('details');advanced.className='settings-diagnostics';
  advanced.append(Object.assign(document.createElement('summary'),{textContent:'高级'}));
  const advancedHint=document.createElement('p');advancedHint.className='settings-hint';
  // The sliders follow whichever beam is the direct light, so they are labelled
  // for the light rather than for the sun.
  const azimuth=rangeRow('光源方位',0,360,5),elevation=rangeRow('光源高度',1,85,1);
  const power=rangeRow('光源强度',0,6,.1),warmth=rangeRow('光源色温',KELVIN_MIN,KELVIN_MAX,100);
  const haze=rangeRow('雾浓度',0,2,.05);
  advanced.append(advancedHint,azimuth.row,elevation.row,power.row,warmth.row,haze.row);
  // The panel scrolls, so expanding the block has to bring it into view.
  advanced.addEventListener('toggle',()=>{if(advanced.open)advanced.scrollIntoView({block:'nearest'});});
  // Clock controls first, then the exposure shared with the legacy levels, then
  // the collapsed manual block.
  timeControls.append(timeRow,autoRow,cycleRow);
  note.after(timeControls);timeControls.after(brightnessRow);brightnessRow.after(advanced);

  // Manual edits are sparse overrides: anything untouched keeps following the
  // clock, and switching auto back on clears the lot.
  const overrides={};
  const CONTROLS=[
    {key:'azimuth',control:azimuth,read:state=>state.lightAzimuth,format:v=>Math.round(v)+'°'},
    {key:'elevation',control:elevation,read:state=>state.lightElevation,format:v=>Math.round(v)+'°'},
    {key:'intensity',control:power,read:state=>state.lightIntensity,format:v=>Number(v).toFixed(2)},
    {key:'kelvin',control:warmth,read:state=>closestKelvin(state.lightColor),format:v=>(v/1000).toFixed(1)+'K'},
    {key:'fog',control:haze,read:()=>1,format:v=>Math.round(v*100)+'%'}
  ];

  let hours=DEFAULT_HOURS,automatic=false,cycleMinutes=DEFAULT_CYCLE_MINUTES;
  let lastFrame=0,state=null;
  try{
    const savedHours=Number(localStorage.getItem('nikki.daylightHours'));
    if(savedHours>=0&&savedHours<DAY_HOURS)hours=savedHours;
    automatic=localStorage.getItem('nikki.daylightAuto')==='1';
    const savedCycle=Number(localStorage.getItem('nikki.daylightCycle'));
    if(savedCycle>=1&&savedCycle<=10)cycleMinutes=savedCycle;
  }catch{}
  const persist=()=>{try{
    localStorage.setItem('nikki.daylightHours',String(hours));
    localStorage.setItem('nikki.daylightAuto',automatic?'1':'0');
    localStorage.setItem('nikki.daylightCycle',String(cycleMinutes));
  }catch{}};

  function currentState(){
    return manualState(sampleDaylight(hours),overrides);
  }

  function syncControls(){
    if(level!=='fine')return;
    timeInput.value=String(hours);
    timeValue.textContent=formatClock(hours);
    cycleRow.hidden=!automatic;
    cycleValue.textContent=cycleMinutes+' 分钟/天';
    autoInput.checked=automatic;
    for(const item of CONTROLS){
      const manual=overrides[item.key];
      const value=manual??item.read(state);
      item.control.input.value=String(value);
      item.control.output.textContent=item.format(Number(value));
      item.control.input.disabled=automatic;
    }
    advancedHint.textContent=automatic
      ?'时间自动循环，参数随光照计算。关闭自动调整后可自行修改。'
      :Object.keys(overrides).length
        ?'已手动覆盖部分参数；切回自动调整即恢复。'
        :'时间停在当前时刻，可拖动时间，或直接调整下列参数。';
  }

  let lastCenter=new T.Vector3(Infinity,Infinity,Infinity),lastRadius=0,lastCaster=null;
  let restoreShadows,shadowsEnabled=false;
  function updateDirection(){
    if(level==='fine'&&state){
      const sunElevation=T.MathUtils.degToRad(Math.max(MIN_LIGHT_ELEVATION,state.sunElevation));
      const sunAzimuth=T.MathUtils.degToRad(state.sunAzimuth);
      sunDirection.set(Math.sin(sunAzimuth)*Math.cos(sunElevation),Math.sin(sunElevation),Math.cos(sunAzimuth)*Math.cos(sunElevation));
      const moonElevation=T.MathUtils.degToRad(Math.max(MIN_LIGHT_ELEVATION,state.moonElevation));
      const moonAzimuth=T.MathUtils.degToRad(state.moonAzimuth);
      moonDirection.set(Math.sin(moonAzimuth)*Math.cos(moonElevation),Math.sin(moonElevation),Math.cos(moonAzimuth)*Math.cos(moonElevation));
    }else{
      sunDirection.copy(legacyDirection);
      moonDirection.copy(legacyDirection);
    }
    lastCenter.set(Infinity,Infinity,Infinity);renderer.shadowMap.needsUpdate=true;
  }

  // Exactly one light casts at a time. Keeping the count at one means
  // `numDirLightShadows` never changes, so three has no reason to recompile the
  // scene's materials when the sun hands the shadow over to the moon.
  function updateShadowCaster(){
    const caster=!shadowsEnabled?null:level==='fine'&&state.moonIntensity>state.sunIntensity?moon:sun;
    sun.castShadow=caster===sun;moon.castShadow=caster===moon;
    if(caster!==lastCaster){
      // The incoming caster's shadow camera may be stale; force a full rebuild.
      lastCaster=caster;lastCenter.set(Infinity,Infinity,Infinity);lastRadius=0;
    }
  }

  // Fades the shadow out where the two beams balance, which is exactly the
  // moment the caster changes over, so the swap is never visible.
  function shadowFade(){
    if(level!=='fine')return 1;
    const total=state.sunIntensity+state.moonIntensity;
    if(total<=0)return 0;
    return T.MathUtils.clamp(Math.abs(state.sunIntensity-state.moonIntensity)/total/.3,0,1);
  }

  // Lighting is cheap enough for every frame; only the reflected environment is
  // worth gating, and only when something actually changes the sky. A closed
  // settings dialog is display:none, so a clock tick has no reason to rewrite
  // its controls more than sixty times a second.
  const settingsDialog=note.closest('dialog');
  const dialogVisible=()=>!settingsDialog||settingsDialog.open;
  function applyLighting(environment,fromClock){
    state=currentState();
    const exposure=Number(brightness.value);
    brightnessValue.textContent=Math.round(exposure*100)+'%';
    if(level==='fine'){
      applyDaylightLighting(state,lighting,exposure);
      applyDaylightShadow(sun,moon,shadowFade());
      sky.setMoon(state);
      if(environment){sky.setWeight(state.skyWeight);sky.refreshEnvironment(performance.now());}
    }else{
      applyLegacyLighting(lighting,exposure);
      moon.intensity=0;
      scene.fog.color.setHex(LEGACY_FOG_COLOR);scene.fog.density=LEGACY_FOG_DENSITY;
      if(environment){sky.setWeight(NOON_WEIGHT);sky.refreshEnvironment(performance.now(),true);}
    }
    updateShadowCaster();
    if(!fromClock||dialogVisible())syncControls();
  }

  function apply(value){
    level=Object.hasOwn(RENDER_LEVELS,value)?value:'standard';const settings=RENDER_LEVELS[level];
    restoreShadows?.();restoreShadows=undefined;
    if(level==='fine')restoreShadows=pcss({size:10,samples:8});
    timeControls.hidden=level!=='fine';advanced.hidden=level!=='fine';
    // r183 uses comparison depth samplers for PCF. PCSS blocker search needs
    // the raw depth texture supplied by BasicShadowMap, filtered by our helper.
    renderer.shadowMap.type=level==='fine'?T.BasicShadowMap:T.PCFShadowMap;
    select.value=level;
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio||1,settings.pixels));
    renderer.shadowMap.enabled=shadowsEnabled=Boolean(settings.shadow);
    // Both lights are configured identically; which one actually casts is decided
    // per frame by updateShadowCaster().
    for(const light of [sun,moon]){
      light.shadow.map?.dispose();light.shadow.map=null;
      light.shadow.mapSize.setScalar(Math.min(settings.shadow||512,renderer.capabilities.maxTextureSize));
      const c=light.shadow.camera;c.left=c.bottom=-settings.radius;c.right=c.top=settings.radius;c.near=1;c.far=240;c.updateProjectionMatrix();
    }
    lastCenter.set(Infinity,Infinity,Infinity);lastRadius=0;lastCaster=null;
    // Existing and future meshes use the same shadow shader when a level changes.
    scene.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])m.needsUpdate=true;});
    renderer.shadowMap.needsUpdate=true;
    applyLighting(true);updateDirection();
    note.textContent=settings.shadow?'温馨庭院 · 云朵天空与远山 · '+sun.shadow.mapSize.x+' 柔和阴影':'温馨庭院 · 云朵天空与远山 · 关闭投影，适合大型场景编辑';
    if(level==='fine')note.textContent='自然庭院 · 24 小时昼夜与太阳弧线 · '+sun.shadow.mapSize.x+' 柔和阴影';
    note.textContent+=level==='light'?' · 关闭立体草':level==='fine'?' · 庭院野草与零星小花（可视范围 / 距离分级）':' · 原有地面';
    if(level==='fine')note.textContent+=' · PCSS 接触软阴影';
    note.dataset.level=level;
    note.dataset.sunIntensity=String(sun.intensity);note.dataset.moonIntensity=String(moon.intensity);
    note.dataset.ambientIntensity=String(hemisphere.intensity);
    try{localStorage.setItem('nikki.renderQuality',level);}catch{}
    levelListener(level);
  }

  brightness.oninput=()=>{applyLighting(false);try{localStorage.setItem('nikki.environmentBrightness',brightness.value);}catch{};};
  timeInput.oninput=()=>{hours=wrapHours(Number(timeInput.value));applyLighting(true);updateDirection();persist();};
  cycleInput.oninput=()=>{cycleMinutes=Number(cycleInput.value);syncControls();persist();};
  autoInput.onchange=()=>{
    automatic=autoInput.checked;
    // Returning to automatic hands the whole rig back to the clock.
    if(automatic)for(const key of Object.keys(overrides))delete overrides[key];
    applyLighting(false);updateDirection();persist();
  };
  for(const item of CONTROLS)item.control.input.oninput=()=>{
    overrides[item.key]=Number(item.control.input.value);
    applyLighting(false);updateDirection();
  };

  try{const saved=Number(localStorage.getItem('nikki.environmentBrightness'));if(saved>=.75&&saved<=1.5)brightness.value=String(saved);}catch{}
  cycleInput.value=String(cycleMinutes);
  select.onchange=()=>apply(select.value);
  let savedLevel;try{savedLevel=localStorage.getItem('nikki.renderQuality');}catch{}
  apply(savedLevel||'standard');

  return {
    prepare(root){let casters=0;root.traverse(o=>{if(!o.isMesh||o.userData.unmatched)return;const materials=Array.isArray(o.material)?o.material:[o.material];o.castShadow=!materials.some(m=>m.transparent||m.wireframe);o.receiveShadow=!materials.some(m=>m.wireframe);if(o.castShadow)casters++;});note.dataset.casters=String(casters);},
    update(){
      const now=performance.now();
      sky.sync(camera);
      if(level==='fine'&&automatic){
        const elapsed=lastFrame?Math.min(now-lastFrame,MAX_STEP_MS):0;
        // The keyframes wrap through midnight, so the clock simply runs forward.
        hours=wrapHours(hours+elapsed*DAY_HOURS/(cycleMinutes*60000));
        if(elapsed){applyLighting(true,true);updateDirection();}
      }
      lastFrame=now;
      if(!shadowsEnabled)return;
      const caster=moon.castShadow?moon:sun;
      note.dataset.shadowReady=String(Boolean(caster.shadow.map));
      const center=new T.Vector3(controls.target.x,0,controls.target.z);
      const radius=Math.ceil(Math.max(level==='fine'?12:20,Math.min(60,camera.position.distanceTo(controls.target)*.8))/2)*2;
      if(center.distanceToSquared(lastCenter)<4&&radius===lastRadius)return;
      // Keep texels stable while orbiting and cover the area being edited.
      center.x=Math.round(center.x/2)*2;center.z=Math.round(center.z/2)*2;
      lastCenter.copy(center);
      sun.target.position.copy(center);sun.position.copy(center).addScaledVector(sunDirection,100);
      moon.target.position.copy(center);moon.position.copy(center).addScaledVector(moonDirection,100);
      if(radius!==lastRadius){const c=caster.shadow.camera;c.left=c.bottom=-radius;c.right=c.top=radius;c.updateProjectionMatrix();lastRadius=radius;}
      sun.target.updateMatrixWorld();moon.target.updateMatrixWorld();
    },
    get level(){return level;},
    onLevelChange(callback){levelListener=callback;}
  };
}
