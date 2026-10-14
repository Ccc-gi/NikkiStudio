import * as T from 'three';
import {GroundDetent} from './ground_detent.js';

export function transformSnapshot(object){return{position:object.position.clone(),quaternion:object.quaternion.clone(),scale:object.scale.clone()};}
// Work from incremental raw handle motion so toggling Alt never jumps back to
// a fraction of the entire drag. Quaternion deltas preserve local/world modes.
export function refineTransformDelta(previousRaw,raw,output,factor){
  return{
    position:output.position.clone().add(raw.position.clone().sub(previousRaw.position).multiplyScalar(factor)),
    scale:output.scale.clone().add(raw.scale.clone().sub(previousRaw.scale).multiplyScalar(factor)),
    quaternion:output.quaternion.clone().multiply(new T.Quaternion().slerp(previousRaw.quaternion.clone().invert().multiply(raw.quaternion),factor)).normalize()
  };
}
export function installTransformPrecision(gizmo,canvas,panel,groundHeight=null){
  let alt=false,keyboardAlt=false,previousRaw=null,output=null;
  const ground=new GroundDetent();let groundOffset=0,pointer=null,pixels=0,hintTimer=null;
  const groundHint=document.createElement('div');groundHint.className='transform-precision-hint ground-detent-hint';groundHint.hidden=true;groundHint.textContent='已贴近地平面 · Z = 0 · 继续拖动可越过地面';panel.append(groundHint);
  const indicator=document.createElement('div');indicator.className='transform-precision-hint';indicator.hidden=true;indicator.textContent='Alt 精细调整 · 速度 10%';panel.append(indicator);
  let lastFine=null;
  const show=()=>{const fine=!!(gizmo.dragging&&alt);if(fine===lastFine)return;lastFine=fine;indicator.hidden=!fine;panel.dataset.transformPrecision=fine?'0.1':'1';};
  const ownsAlt=()=>gizmo.object&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName??'')&&(document.activeElement===canvas||gizmo.dragging);
  canvas.addEventListener('pointerdown',e=>{pointer=[e.clientX,e.clientY];pixels=0;alt=keyboardAlt||e.altKey;show();},true);
  canvas.addEventListener('pointermove',e=>{pixels=pointer?Math.hypot(e.clientX-pointer[0],e.clientY-pointer[1]):0;pointer=[e.clientX,e.clientY];alt=keyboardAlt||e.altKey;show();},true);
  window.addEventListener('keydown',e=>{if(e.key==='Alt'){keyboardAlt=true;alt=true;if(ownsAlt())e.preventDefault();show();}});
  window.addEventListener('keyup',e=>{if(e.key==='Alt'){keyboardAlt=false;alt=false;if(ownsAlt())e.preventDefault();show();}});
  window.addEventListener('blur',()=>{keyboardAlt=false;alt=false;show();});
  gizmo.addEventListener('dragging-changed',e=>{
    const stoppedAtGround=!e.value&&ground.active;
    clearTimeout(hintTimer);hintTimer=null;
    previousRaw=e.value&&gizmo.object?transformSnapshot(gizmo.object):null;output=previousRaw;
    ground.reset();groundHint.hidden=!stoppedAtGround;panel.dataset.groundDetent='free';
    if(stoppedAtGround)hintTimer=setTimeout(()=>{groundHint.hidden=true;},1800);
    if(e.value&&groundHeight&&!gizmo.object.userData.arrayHandle)groundOffset=groundHeight()-gizmo.object.position.y;show();
  });
  gizmo.addEventListener('objectChange',()=>{
    if(!gizmo.dragging||!previousRaw||!gizmo.object)return;
    const raw=transformSnapshot(gizmo.object),previousY=output.position.y;output=refineTransformDelta(previousRaw,raw,output,alt?.1:1);previousRaw=raw;
    if(groundHeight&&gizmo.mode==='translate'&&!gizmo.object.userData.arrayHandle){
      output.position.y=ground.apply(previousY+groundOffset,output.position.y+groundOffset,pixels)-groundOffset;
      groundHint.hidden=!ground.active;panel.dataset.groundDetent=ground.active?'held':'free';
    }
    gizmo.object.position.copy(output.position);gizmo.object.quaternion.copy(output.quaternion);gizmo.object.scale.copy(output.scale);gizmo.object.updateMatrixWorld(true);
  });
}
