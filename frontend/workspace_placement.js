import * as T from 'three';
import {preserveMaterialShader} from './foliage_material.js';

export function placementSupportPoints(nodes){
  const points=[];
  for(const node of nodes){node.updateMatrixWorld(true);node.traverse(object=>{
    if(!object.isMesh||!object.geometry)return;
    const geometry=object.geometry;if(!geometry.boundingBox)geometry.computeBoundingBox();
    const box=geometry.boundingBox;if(!box||box.isEmpty())return;
    // Retain the mesh's oriented bounds. A world-axis box adds empty space
    // around rotated meshes, which becomes a visible gap during face snapping.
    for(let i=0;i<8;i++)points.push(new T.Vector3(i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z).applyMatrix4(object.matrixWorld));
  });}
  return points;
}

export function surfaceContactOffset(bounds,normal,supportPoints=null){
  let min=Infinity;
  if(supportPoints?.length){for(const point of supportPoints)min=Math.min(min,normal.dot(point));return -min;}
  for(let i=0;i<8;i++)min=Math.min(min,normal.dot(new T.Vector3(i&1?bounds.max.x:bounds.min.x,i&2?bounds.max.y:bounds.min.y,i&4?bounds.max.z:bounds.min.z)));
  return -min;
}

export function surfacePlacementPosition(bounds,hit,sameModel=false,supportPoints=null){
  const normal=hit.placementNormal,position=hit.point.clone();
  if(sameModel&&hit.placementBounds){
    const center=hit.placementBounds.getCenter(new T.Vector3());
    // Move to the target center in the contact plane, preserving its surface height.
    const tangent=center.sub(position);tangent.addScaledVector(normal,-tangent.dot(normal));
    position.add(tangent);
    const localCenter=bounds.getCenter(new T.Vector3());
    localCenter.addScaledVector(normal,-localCenter.dot(normal));position.sub(localCenter);
  }
  return position.addScaledVector(normal,surfaceContactOffset(bounds,normal,supportPoints));
}

export function linearArrayLayout(points,delta,gap=0){
  const direction=delta.clone();direction.y=0;const distance=direction.length();
  if(distance<1e-6||!points.length)return {offsets:[],step:0};direction.divideScalar(distance);
  let min=Infinity,max=-Infinity;for(const p of points){const d=p.dot(direction);min=Math.min(min,d);max=Math.max(max,d);}
  const step=Math.max(.01,max-min+Math.max(0,gap)),count=Math.floor((distance+1e-8)/step);
  return {step,offsets:Array.from({length:count},(_,i)=>direction.clone().multiplyScalar(step*(i+1)))};
}

export function gridArrayLayout(points,{axes='x',counts={},gaps={},signs={}}={}){
  const bounds=new T.Box3().setFromPoints(points),size=bounds.getSize(new T.Vector3());
  const dimensions={x:'x',y:'z',z:'y'},n={},steps={};
  for(const axis of ['x','y','z']){
    n[axis]=axes.includes(axis)?Math.max(1,Math.floor(Number(counts[axis])||1)):1;
    steps[axis]=Math.max(.01,size[dimensions[axis]]+Math.max(0,Number(gaps[axis])||0)/100)*(Number(signs[axis])<0?-1:1);
  }
  const count=n.x*n.y*n.z-1;
  const offsets=[];
  for(let z=0;z<n.z;z++)for(let y=0;y<n.y;y++)for(let x=0;x<n.x;x++){
    if(x||y||z)offsets.push(new T.Vector3(x?x*steps.x:0,z?z*steps.z:0,y?y*steps.y:0));
  }
  return {offsets,count,steps};
}

export function localDragArrayLayout(points,quaternion,delta,axes='X'){
  const local=delta.clone().applyQuaternion(quaternion.clone().invert()),counts={},steps={},directions={};let count=1;
  for(const axis of ['X','Y','Z']){
    const key=axis.toLowerCase(),direction=new T.Vector3(key==='x'?1:0,key==='y'?1:0,key==='z'?1:0).applyQuaternion(quaternion);
    let min=Infinity,max=-Infinity;for(const p of points){const d=p.dot(direction);min=Math.min(min,d);max=Math.max(max,d);}
    const step=Math.max(.01,max-min);counts[axis]=axes.includes(axis)?1+Math.floor((Math.abs(local[key])+1e-8)/step):1;
    steps[axis]=step*(local[key]<0?-1:1);directions[axis]=direction;count*=counts[axis];
  }
  count--;
  const offsets=[];for(let z=0;z<counts.Z;z++)for(let y=0;y<counts.Y;y++)for(let x=0;x<counts.X;x++)if(x||y||z)offsets.push(new T.Vector3().addScaledVector(directions.X,x*steps.X).addScaledVector(directions.Y,y*steps.Y).addScaledVector(directions.Z,z*steps.Z));
  return {offsets,count,counts,steps,localDelta:local.toArray(),axes};
}

// Preview is outside the document and batching. Only confirmation creates records.
export function installWorkspacePlacement({scene,camera,canvas,panel,status,pickSurface,onFinish,onRotationStart=()=>{},onRotationEnd=()=>{}}){
  const root=new T.Group();scene.add(root);
  const ray=new T.Raycaster(),pointer=new T.Vector2(),point=new T.Vector3(),plane=new T.Plane(new T.Vector3(0,1,0),0);
  const hint=document.createElement('div');hint.hidden=true;hint.style.cssText='position:absolute;bottom:48px;left:50%;transform:translateX(-50%);padding:10px 16px;border-radius:12px;background:#173c36ee;color:#b8ffe4;pointer-events:none;z-index:20;white-space:nowrap';panel.append(hint);
  const rotationUi=document.createElement('div');rotationUi.className='placement-rotation-ui';rotationUi.hidden=true;
  const rotationLabel=document.createElement('span'),accept=document.createElement('button'),reject=document.createElement('button');
  accept.textContent='确认旋转 · R';reject.textContent='取消旋转';rotationUi.append(rotationLabel,accept,reject);panel.append(rotationUi);
  accept.onclick=()=>endRotation(false);reject.onclick=()=>endRotation(true);
  let rotation=null;
  function refreshBounds(){
    root.updateMatrixWorld(true);session.supportPoints=placementSupportPoints(session.nodes).map(p=>p.sub(root.position));
    session.bounds=new T.Box3().setFromPoints(session.supportPoints);
  }
  function endRotation(cancelled){
    if(!rotation)return;
    if(cancelled)rotation.transforms.forEach(({node,position,quaternion})=>{node.position.copy(position);node.quaternion.copy(quaternion);});
    onRotationEnd();rotation=null;pressed=false;rotationUi.hidden=true;refreshBounds();
    canvas.style.cursor='crosshair';panel.dataset.placement='preview';
    hint.textContent='抓取中 · 默认智能吸附 · Shift 暂停吸附 · R 旋转 · 左键放置 · 右键取消';status.textContent=hint.textContent;position();
  }
  function toggleRotation(){
    if(!session||session.array)return;
    if(rotation){endRotation(false);return;}
    if(!session.valid){status.textContent='先将鼠标移入场景，再按 R 旋转';return;}
    rotation={transforms:session.nodes.map(node=>({node,position:node.position.clone(),quaternion:node.quaternion.clone()}))};
    panel.dataset.placement='rotate';rotationUi.hidden=false;rotationLabel.textContent='三轴旋转';canvas.style.cursor='';
    onRotationStart(session.nodes);
    hint.textContent='旋转中 · 拖动旋转环 · Alt 精细调整 · R 确认 · 右键取消本次旋转';status.textContent=hint.textContent;
  }
  let session=null,lastPointer=null,generation=0,pressed=false,suppressContext=false;
  function stop(cancelled){
    if(rotation)onRotationEnd();rotation=null;rotationUi.hidden=true;
    generation++;pressed=false;panel.dataset.placement='idle';hint.hidden=true;canvas.style.cursor='';if(!session){root.clear();return;}
    const current=session;session=null;hint.hidden=true;canvas.style.cursor='';panel.dataset.placement='idle';
    current.array?.onEnd?.();
    for(const [object,material] of current.originals)object.material=material;
    for(const material of current.ghosts)material.dispose();
    root.updateMatrixWorld(true);
    if(cancelled)current.cancel?.();else current.commit(current.nodes,root.position.clone());
    root.clear();root.position.set(0,0,0);onFinish(cancelled);
  }
  function position(){
    if(rotation)return;
    if(!session||(!lastPointer&&!session.array?.settings&&!session.array?.layout))return;
    if(session.array){
      const array=session.array;let layout;
      if(array.layout)layout=array.layout(session.supportPoints);
      else if(array.settings)layout=gridArrayLayout(session.supportPoints,array.settings());
      else{
        const rect=canvas.getBoundingClientRect();pointer.set((lastPointer.x-rect.left)/rect.width*2-1,-(lastPointer.y-rect.top)/rect.height*2+1);ray.setFromCamera(pointer,camera);
        const target=ray.ray.intersectPlane(array.plane,point);if(!target){session.valid=false;root.visible=false;return;}
        layout=linearArrayLayout(session.supportPoints,target.clone().sub(array.anchor),Number(array.gap?.value??0)/100);
      }
      const signature=JSON.stringify(layout);if(signature===array.signature)return;array.signature=signature;
      while(array.groups.length<layout.offsets.length){
        const copies=array.templates.map(template=>array.clone(template));
        for(const copy of copies){root.add(copy);copy.traverse(o=>{if(o.isMesh)session.originals.push([o,Array.isArray(o.material)?o.material.map(m=>array.materials.get(m)??m):array.materials.get(o.material)??o.material]);});}
        array.groups.push(copies);
      }
      session.nodes=[];array.groups.forEach((copies,i)=>copies.forEach((copy,j)=>{copy.visible=i<layout.offsets.length;if(copy.visible){const rotation=new T.Quaternion().fromArray(layout.rotations?.[i]??[0,0,0,1]);copy.position.copy(array.templates[j].position).applyQuaternion(rotation).add(layout.offsets[i]);copy.quaternion.copy(rotation).multiply(array.templates[j].quaternion);array.prepareCopy?.(copy);session.nodes.push(copy);}}));
      session.valid=session.nodes.length>0;root.visible=session.valid;root.position.copy(array.anchor);
      panel.dataset.arrayCopies=String(layout.offsets.length);panel.dataset.arrayStep=String(layout.step);
      if(array.handle)panel.dataset.arrayLayout=JSON.stringify({axes:layout.axes,counts:layout.counts,steps:layout.steps,delta:layout.localDelta});
      hint.textContent=layout.error??array.hintText?.(layout)??`局部阵列 · 新增 ${layout.offsets.length} 组 / ${session.nodes.length} 件 · ${array.handle?'拖单轴或平面手柄 · 松开生成':array.settings?'调整 XYZ 数量和间距 · 确认生成':'左键拖动后松开放置，也可单击确认'} · 右键取消`;
      array.onPreview?.(layout,session.nodes.length);status.textContent=hint.textContent;
      return;
    }
    const rect=canvas.getBoundingClientRect();pointer.set((lastPointer.x-rect.left)/rect.width*2-1,-(lastPointer.y-rect.top)/rect.height*2+1);ray.setFromCamera(pointer,camera);
    const hit=lastPointer.shift?null:pickSurface(ray);
    const target=hit?.point??ray.ray.intersectPlane(plane,point);
    session.valid=Boolean(target);root.visible=session.valid;
    if(target){root.position.copy(target);
      if(hit?.placementNormal)root.position.copy(surfacePlacementPosition(session.bounds,hit,session.nodes.length===1&&String(session.nodes[0].userData.id)===String(hit.placementId),session.supportPoints));
      panel.dataset.placementPosition=[root.position.x,root.position.y,root.position.z].map(v=>v.toFixed(4)).join(',');
    }
  }
  async function begin(load,label,commit,cancel,arrayOptions=null){
    stop(true);const token=++generation;
    panel.dataset.placement='loading';status.textContent='正在拿起 '+label+'…';
    try{
      const nodes=await load();if(token!==generation)return;
      const bounds=new T.Box3();nodes.forEach(n=>{n.updateMatrixWorld(true);bounds.union(new T.Box3().setFromObject(n));});
      const anchor=bounds.isEmpty()?new T.Vector3():bounds.getCenter(new T.Vector3());if(!bounds.isEmpty())anchor.y=bounds.min.y;
      const supportPoints=placementSupportPoints(nodes).map(p=>p.sub(anchor));
      const originals=[],ghosts=[];
      nodes.forEach(node=>{
        node.position.sub(anchor);root.add(node);
        node.traverse(o=>{if(!o.isMesh)return;originals.push([o,o.material]);
          const materials=(Array.isArray(o.material)?o.material:[o.material]).map(m=>{const c=preserveMaterialShader(m,m.clone());c.transparent=true;c.opacity=.62;c.depthWrite=false;ghosts.push(c);return c;});
          o.material=Array.isArray(o.material)?materials:materials[0];o.castShadow=false;
        });
      });
      session={nodes,originals,ghosts,commit,cancel,supportPoints,bounds:new T.Box3(bounds.min.clone().sub(anchor),bounds.max.clone().sub(anchor)),valid:false};root.position.copy(anchor);root.visible=false;
      if(arrayOptions){
        const materials=new Map();for(const [object,material] of originals){const preview=Array.isArray(object.material)?object.material:[object.material],actual=Array.isArray(material)?material:[material];preview.forEach((m,i)=>materials.set(m,actual[i]));}
        nodes.forEach(n=>root.remove(n));session.nodes=[];session.array={...arrayOptions,templates:nodes,groups:[],materials,anchor:anchor.clone(),plane:new T.Plane(new T.Vector3(0,1,0),-anchor.y)};
      }
      hint.textContent='拿着 '+label+' · 默认智能吸附 · Shift 暂停吸附 · R 旋转 · 左键放置 · 右键取消';hint.hidden=false;canvas.style.cursor='crosshair';panel.dataset.placement='preview';status.textContent=hint.textContent;
      if(session.array){hint.textContent='阵列复制 · 拖动鼠标拉出排列 · 保持原高度 · 右键取消';status.textContent=hint.textContent;}position();
    }catch(error){if(token===generation){stop(true);status.textContent='拿起物品失败：'+error.message;}}
  }
  canvas.addEventListener('pointermove',e=>{lastPointer={x:e.clientX,y:e.clientY,shift:e.shiftKey};if(session)position();},{capture:true});
  canvas.addEventListener('pointerleave',()=>{if(rotation)return;lastPointer=null;if(session&&!session.array?.settings&&!session.array?.handle){session.valid=false;root.visible=false;}});
  window.addEventListener('keyup',e=>{if(e.key==='Shift'&&lastPointer){lastPointer.shift=false;position();}});
  canvas.addEventListener('pointerdown',e=>{if(!session||session.array?.handle||rotation||e.button!==0)return;e.preventDefault();e.stopImmediatePropagation();canvas.focus({preventScroll:true});pressed=true;position();},{capture:true});
  canvas.addEventListener('pointerup',e=>{if(rotation||!pressed||e.button!==0)return;pressed=false;e.preventDefault();e.stopImmediatePropagation();if(session?.valid)stop(false);},{capture:true});
  canvas.addEventListener('click',e=>{if(pressed||session){e.preventDefault();e.stopImmediatePropagation();}},{capture:true});
  window.addEventListener('keydown',e=>{if(e.target.closest?.('input,textarea,select,[contenteditable="true"]'))return;if(e.key==='Shift'&&lastPointer){lastPointer.shift=true;position();}if(session&&!session.array&&e.key.toLowerCase()==='r'&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();e.stopImmediatePropagation();if(!e.repeat)toggleRotation();}},{capture:true});
  window.addEventListener('pointerdown',e=>{suppressContext=false;if(e.button!==2||!(session||panel.dataset.placement==='loading'))return;
    e.preventDefault();e.stopImmediatePropagation();suppressContext=true;if(rotation){endRotation(true);return;}const text=session?.array?.cancelText??'已取消抓取，位置与存档保持原样';stop(true);status.textContent=text;
  },{capture:true});
  window.addEventListener('contextmenu',e=>{if(suppressContext){suppressContext=false;e.preventDefault();e.stopImmediatePropagation();}},{capture:true});
  return {begin,beginArray:(load,label,commit,options)=>begin(load,label,commit,null,options),confirm:()=>{if(session?.valid)stop(false);},cancel:()=>stop(true),update:position,get rotating(){return Boolean(rotation);},get active(){return Boolean(session)||panel.dataset.placement==='loading';}};
}
