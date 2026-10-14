import * as T from 'three';

export function rectangleMatches(rect, bounds, crossing){
  if(!bounds)return false;
  return crossing?bounds.maxX>=rect.minX&&bounds.minX<=rect.maxX&&bounds.maxY>=rect.minY&&bounds.minY<=rect.maxY:bounds.minX>=rect.minX&&bounds.maxX<=rect.maxX&&bounds.minY>=rect.minY&&bounds.maxY<=rect.maxY;
}
// Mesh-local bounds retain authored offsets and rotations, including batched meshes.
export function projectedBounds(node,camera,width,height){
  node.updateMatrixWorld(true);camera.updateMatrixWorld(true);
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  const point=new T.Vector3(),view=new T.Vector3(),edges=[[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],[2,6],[3,7],[4,5],[4,6],[5,7],[6,7]];
  function include(p){point.copy(p).applyMatrix4(camera.projectionMatrix);const x=(point.x+1)*width/2,y=(1-point.y)*height/2;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
  node.traverse(mesh=>{if(!mesh.isMesh)return;const geometry=mesh.geometry;if(!geometry.boundingBox)geometry.computeBoundingBox();const b=geometry.boundingBox;if(!b)return;const corners=[];
    for(let i=0;i<8;i++){view.set(i&1?b.max.x:b.min.x,i&2?b.max.y:b.min.y,i&4?b.max.z:b.min.z).applyMatrix4(mesh.matrixWorld).applyMatrix4(camera.matrixWorldInverse);corners.push(view.clone());if(view.z<=-camera.near)include(view);}
    for(const [a,b] of edges){const p=corners[a],q=corners[b];if((p.z<=-camera.near)===(q.z<=-camera.near))continue;include(p.clone().lerp(q,(-camera.near-p.z)/(q.z-p.z)));}
  });
  return minX===Infinity?null:{minX,minY,maxX,maxY};
}

export function installWorkspaceSelection({canvas,panel,camera,controls,gizmo,nodes,onSelect,onClick}){
  controls.mouseButtons.LEFT=null;controls.mouseButtons.RIGHT=T.MOUSE.PAN;controls.mouseButtons.MIDDLE=T.MOUSE.PAN;
  const box=document.createElement('div');box.className='selection-marquee';box.hidden=true;panel.append(box);
  const label=document.createElement('span');box.append(label);
  // Suppress browser middle-button autoscroll; OrbitControls owns middle drags.
  canvas.addEventListener('mousedown',e=>{if(e.button===1)e.preventDefault();});
  canvas.addEventListener('auxclick',e=>{if(e.button===1)e.preventDefault();});
  let drag=null;
  // OrbitControls swaps PAN/ROTATE when Shift is held; RIGHT=PAN gives the desired rule.
  canvas.addEventListener('pointerdown',e=>{
    if(e.button!==0||gizmo.dragging||gizmo.axis||['preview','rotate','loading'].includes(panel.dataset.placement))return;
    const r=canvas.getBoundingClientRect();drag={id:e.pointerId,x:e.clientX-r.left,y:e.clientY-r.top,add:e.shiftKey||e.ctrlKey||e.metaKey,moved:false};canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;if(Math.hypot(x-drag.x,y-drag.y)<5&&!drag.moved)return;drag.moved=true;box.hidden=false;const crossing=x<drag.x;box.classList.toggle('crossing',crossing);box.style.left=Math.min(x,drag.x)+'px';box.style.top=Math.min(y,drag.y)+'px';box.style.width=Math.abs(x-drag.x)+'px';box.style.height=Math.abs(y-drag.y)+'px';label.textContent=crossing?'相交选择':'完整包含';});
  canvas.addEventListener('pointerup',e=>{if(!drag||drag.id!==e.pointerId)return;const d=drag;drag=null;box.hidden=true;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);if(!d.moved){onClick(e,d.add);return;}const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,rect={minX:Math.min(x,d.x),maxX:Math.max(x,d.x),minY:Math.min(y,d.y),maxY:Math.max(y,d.y)};const found=nodes().filter(n=>n.visible&&rectangleMatches(rect,projectedBounds(n,camera,r.width,r.height),x<d.x));onSelect(found,d.add,x<d.x);});
  const cancel=()=>{drag=null;box.hidden=true;};canvas.addEventListener('pointercancel',cancel);window.addEventListener('blur',cancel);window.addEventListener('keydown',e=>{if(e.key==='Escape')cancel();});
}
