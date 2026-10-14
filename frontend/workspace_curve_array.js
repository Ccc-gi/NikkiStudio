import * as T from 'three';
import {TransformControls} from 'three/addons/controls/TransformControls.js';

// Keep the source's bank about its own forward axis, rather than a world Euler Roll.
export function curveSourceBank(reference){
  const q=new T.Quaternion().fromArray(reference).normalize(),forward=new T.Vector3(0,0,1).applyQuaternion(q);
  const swing=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,0,1),forward);
  const twist=swing.invert().multiply(q);twist.x=0;twist.y=0;
  return twist.lengthSq()>1e-12?twist.normalize():new T.Quaternion();
}
function curveFrames(curve){
  const frames=[],steps=1024;
  let tangent=curve.getTangentAt(0).normalize(),normal=Math.abs(tangent.y)>.999?new T.Vector3(0,0,1):new T.Vector3(0,1,0);
  normal.addScaledVector(tangent,-normal.dot(tangent)).normalize();
  for(let i=0;i<=steps;i++){
    const next=curve.getTangentAt(i/steps).normalize();
    normal.applyQuaternion(new T.Quaternion().setFromUnitVectors(tangent,next));
    normal.addScaledVector(next,-normal.dot(next)).normalize();
    const right=new T.Vector3().crossVectors(normal,next).normalize();
    normal.crossVectors(next,right).normalize();
    frames.push(new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(right,normal,next)));tangent=next;
  }
  return t=>{
    const u=t*steps,i=Math.min(steps-1,Math.floor(u)),q=frames[i].clone().slerp(frames[i+1],u-i),forward=curve.getTangentAt(t).normalize();
    const up=new T.Vector3(0,1,0).applyQuaternion(q);up.addScaledVector(forward,-up.dot(forward)).normalize();
    const right=new T.Vector3().crossVectors(up,forward).normalize();up.crossVectors(forward,right);
    return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(right,up,forward));
  };
}
// Sample by arc length, not spline parameter, so bends do not change density.
export function curveArrayLayout(points,anchor,{spacing=1,count=10,mode='spacing',turn=true,reference=[0,0,0,1]}={}){
  if(points.length<2)return {offsets:[],rotations:[],length:0};
  const curve=new T.CatmullRomCurve3(points,false,'centripetal');
  curve.arcLengthDivisions=Math.min(4096,Math.max(1024,points.length*128));
  const length=curve.getLength();if(length<1e-6)return {offsets:[],rotations:[],length:0};
  const requested=mode==='count'?Math.max(1,Math.floor(count)):Math.floor((length+1e-8)/Math.max(.01,spacing));
  const n=requested,offsets=[],rotations=[];
  const inverseReference=new T.Quaternion().fromArray(reference).invert();
  const bank=curveSourceBank(reference),frameAt=turn?curveFrames(curve):null;
  for(let i=1;i<=n;i++){
    const distance=mode==='count'?length*i/requested:i*Math.max(.01,spacing),t=Math.min(1,distance/length);
    offsets.push(curve.getPointAt(t).sub(anchor));
    rotations.push(turn?frameAt(t).multiply(bank).multiply(inverseReference).toArray():[0,0,0,1]);
  }
  return {offsets,rotations,length,requested};
}

export function installCurveArray({scene,camera,canvas,panel,status,controls,placement,begin}){
  let state=null,drag=null,pressed=null;
  const ray=new T.Raycaster(),pointer=new T.Vector2(),plane=new T.Plane(),point=new T.Vector3();
  const ui=document.createElement('div');ui.className='curve-array-ui';ui.hidden=true;ui.setAttribute('aria-label','曲线阵列设置');
  ui.innerHTML='<strong>曲线阵列</strong><span class="curve-count"></span><label>排列方式 <select aria-label="曲线排列方式"><option value="spacing">按间距</option><option value="count">按数量</option></select></label><label class="curve-spacing">间距 / cm <input aria-label="曲线间距" type="number" min="1" step="10"></label><label class="curve-number" hidden>副本组数 <input aria-label="曲线副本组数" type="number" min="1" value="10"></label><label><input class="curve-turn" type="checkbox" checked>沿曲线转向</label><div><button class="curve-finish">完成绘制</button><button class="curve-append" hidden>继续绘制</button><button class="curve-pop">撤回末点</button><button class="curve-confirm primary" disabled>确认生成</button><button class="curve-cancel">取消</button></div><small>从原物品出发 · 点击添加路径点 · 双击结束 · 拖动圆点调整曲线 · 右键取消</small>';
  panel.append(ui);
  const coordinates=document.createElement('div');coordinates.className='curve-point-coordinates';coordinates.hidden=true;
  coordinates.innerHTML='<strong>控制点</strong><label>X <input aria-label="曲线点 X" type="number" step="10"></label><label>Y <input aria-label="曲线点 Y" type="number" step="10"></label><label>Z <input aria-label="曲线点 Z" type="number" step="10"></label><small>游戏坐标 / cm · 拖动 XYZ 手柄调整空间位置</small>';ui.append(coordinates);
  const pointFrame=new T.Object3D();scene.add(pointFrame);
  const pointGizmo=new TransformControls(camera,canvas);pointGizmo.setMode('translate');pointGizmo.setSpace('world');pointGizmo.setSize(.8);scene.add(pointGizmo.getHelper());
  let selectedPoint=-1;
  const fields=['X','Y','Z'].map(axis=>coordinates.querySelector(`[aria-label="曲线点 ${axis}"]`));
  function refreshCoordinates(){if(!state||selectedPoint<0)return;const p=state.points[selectedPoint];[p.x,p.z,p.y].forEach((v,i)=>fields[i].value=(v*100).toFixed(2));}
  function selectPoint(index){selectedPoint=index;coordinates.hidden=index<0;if(index<0){pointGizmo.detach();return;}pointFrame.position.copy(state.points[index]);pointFrame.updateMatrixWorld(true);pointGizmo.attach(pointFrame);refreshCoordinates();}
  fields.forEach(input=>input.oninput=()=>{if(!state||selectedPoint<0)return;const values=fields.map(f=>Number(f.value));if(!values.every(Number.isFinite))return;state.points[selectedPoint].set(values[0]/100,values[2]/100,values[1]/100);pointFrame.position.copy(state.points[selectedPoint]);redraw();});
  pointGizmo.addEventListener('dragging-changed',e=>{controls.enabled=!e.value;});
  pointGizmo.addEventListener('objectChange',()=>{if(!state||selectedPoint<0)return;state.points[selectedPoint].copy(pointFrame.position);refreshCoordinates();redraw();});
  const mode=ui.querySelector('select'),spacing=ui.querySelector('[aria-label="曲线间距"]'),count=ui.querySelector('[aria-label="曲线副本组数"]'),turn=ui.querySelector('.curve-turn'),info=ui.querySelector('.curve-count');
  function currentLayout(){
    if(!state)return {offsets:[]};
    const options={spacing:Number(spacing.value)/100,count:Number(count.value),mode:mode.value,turn:turn.checked,reference:state.reference};
    const key=JSON.stringify([state.points.map(p=>p.toArray()),options]);
    if(state.layoutKey!==key){state.layoutKey=key;state.layout=curveArrayLayout(state.points,state.anchor,options);}
    return state.layout;
  }
  const visual=new T.Group(),markers=new T.Group();visual.add(markers);scene.add(visual);visual.visible=false;
  const geometry=new T.SphereGeometry(.1,12,8),material=new T.MeshBasicMaterial({color:0x50f0cf,depthTest:false,depthWrite:false,transparent:true});
  const lineMaterial=new T.LineBasicMaterial({color:0x1bcda7,depthTest:false,depthWrite:false,transparent:true}),line=new T.Line(new T.BufferGeometry(),lineMaterial);line.renderOrder=1001;visual.add(line);
  function screenRay(e){const rect=canvas.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(pointer,camera);}
  function hitPlane(e){screenRay(e);return ray.ray.intersectPlane(plane,point)?.clone();}
  function redraw(){
    while(markers.children.length<state.points.length){const mesh=new T.Mesh(geometry,material);mesh.renderOrder=1002;markers.add(mesh);}
    markers.children.forEach((mesh,i)=>{mesh.visible=i<state.points.length;if(mesh.visible){mesh.position.copy(state.points[i]);mesh.scale.setScalar(Math.max(.5,camera.position.distanceTo(mesh.position)*.09));}});
    const samples=state.points.length>1?new T.CatmullRomCurve3(state.points,false,'centripetal').getPoints(200):state.points;
    line.geometry.dispose();line.geometry=new T.BufferGeometry().setFromPoints(samples);line.visible=state.points.length>1;
    panel.dataset.curvePoints=String(state.points.length);placement.update();
  }
  function finish(){if(!state||state.points.length<2)return;state.drawing=false;ui.querySelector('.curve-finish').hidden=true;ui.querySelector('.curve-append').hidden=false;status.textContent='拖动路径控制点调整曲线，确认后生成副本';}
  ui.querySelector('.curve-finish').onclick=finish;
  ui.querySelector('.curve-append').onclick=()=>{state.drawing=true;ui.querySelector('.curve-finish').hidden=false;ui.querySelector('.curve-append').hidden=true;};
  ui.querySelector('.curve-pop').onclick=()=>{if(state.points.length>1){state.points.pop();if(selectedPoint>=state.points.length)selectPoint(-1);redraw();}};
  ui.querySelector('.curve-confirm').onclick=()=>placement.confirm();ui.querySelector('.curve-cancel').onclick=()=>placement.cancel();
  for(const input of [mode,spacing,count,turn])input.oninput=()=>{ui.querySelector('.curve-spacing').hidden=mode.value!=='spacing';ui.querySelector('.curve-number').hidden=mode.value!=='count';placement.update();};
  function cleanup(){selectPoint(-1);pointGizmo.dragging=false;pointGizmo.axis=null;state=null;drag=null;pressed=null;ui.hidden=true;visual.visible=false;controls.enabled=true;panel.dataset.curvePoints='0';}
  canvas.addEventListener('pointerdown',e=>{if(!state||e.button!==0||pointGizmo.axis)return;e.preventDefault();e.stopImmediatePropagation();canvas.focus();screenRay(e);const hit=ray.intersectObjects(markers.children.filter(m=>m.visible))[0];drag=hit?markers.children.indexOf(hit.object):null;if(drag!==null)selectPoint(drag);else selectPoint(-1);pressed={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);if(drag!==null)controls.enabled=false;},true);
  canvas.addEventListener('pointermove',e=>{if(!state||drag===null)return;const p=hitPlane(e);if(p){p.y=state.points[drag].y;state.points[drag].copy(p);pointFrame.position.copy(p);refreshCoordinates();redraw();}e.stopImmediatePropagation();},true);
  canvas.addEventListener('pointerup',e=>{if(!state||e.button!==0||!pressed)return;e.preventDefault();e.stopImmediatePropagation();if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);if(drag===null&&state.drawing&&Math.hypot(e.clientX-pressed.x,e.clientY-pressed.y)<5){const p=hitPlane(e);if(p&&p.distanceTo(state.points.at(-1))>.01){state.points.push(p);redraw();}}drag=null;pressed=null;controls.enabled=true;},true);
  canvas.addEventListener('dblclick',e=>{if(state){e.preventDefault();e.stopImmediatePropagation();finish();}},true);
  canvas.addEventListener('pointercancel',()=>{drag=null;pressed=null;controls.enabled=true;});
  return {async start(anchor,defaultSpacing,reference=new T.Quaternion()){
    placement.cancel();state={anchor:anchor.clone(),points:[anchor.clone()],drawing:true,reference:reference.toArray()};plane.set(new T.Vector3(0,1,0),-anchor.y);
    spacing.value=String(Math.max(1,Math.round(defaultSpacing*100)));ui.hidden=false;visual.visible=true;mode.value='spacing';turn.checked=true;
    ui.querySelector('.curve-spacing').hidden=false;ui.querySelector('.curve-number').hidden=true;ui.querySelector('.curve-finish').hidden=false;ui.querySelector('.curve-append').hidden=true;
    await begin({handle:true,cancelText:'已取消曲线阵列，存档保持原样',hintText:layout=>`曲线阵列 · 预览 ${layout.offsets.length} 组 · 选择圆点后拖动 XYZ · 确认生成 · 右键取消`,layout:currentLayout,onEnd:cleanup,onPreview:(layout,total)=>{
      info.textContent=`路径 ${(layout.length??0).toFixed(2)} m · ${layout.offsets.length} 组 / ${total} 件`;
      ui.querySelector('.curve-confirm').disabled=!total;panel.dataset.curveCopies=String(layout.offsets.length);
    }});
    if(state){redraw();status.textContent='曲线阵列：点击场景添加路径点，双击结束，拖动圆点调整';}
  }};
}
