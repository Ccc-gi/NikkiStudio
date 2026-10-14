import * as T from 'three';
import assert from 'node:assert/strict';
import {createSoftGrass} from '../frontend/soft_grass.js';
globalThis.document={createElement:()=>({getContext:()=>({createLinearGradient:()=>({addColorStop(){}}),beginPath(){},moveTo(){},bezierCurveTo(){},closePath(){},fill(){}})})};
const group=new T.Group(),geometry=new T.BoxGeometry(2,.1,2);
for(let i=0;i<700;i++){const m=new T.Mesh(geometry);m.position.set((i%35)*3-52,0,Math.floor(i/35)*3-30);group.add(m);}
const lawn=createSoftGrass(),ground={visible:true,position:new T.Vector3(),scale:new T.Vector3(4000,4000,1)};
const camera=new T.PerspectiveCamera(45,1.8,.1,5000);camera.position.set(0,2,35);camera.lookAt(0,2,-100);
lawn.fit(group);const times=[];
for(let i=0;i<20;i++){camera.position.x+=.4;camera.updateMatrixWorld();const start=performance.now();lawn.update(camera,'fine',ground);times.push(performance.now()-start);}
lawn.flush();
assert.ok(lawn.mesh.userData.visitedNodes<4000,'Horizon view must not scan every 8 metre tile');
assert.ok(lawn.mesh.count<=24000,'Alpha cards must stay within the grass budget');
assert.ok(times.slice(1).every(t=>t<30),'Camera movement must not synchronously rebuild the complete lawn');
console.log(JSON.stringify({maxMs:Math.max(...times),averageMs:times.reduce((a,b)=>a+b,0)/times.length,tufts:lawn.mesh.count,tiles:lawn.mesh.userData.visibleTiles,visitedNodes:lawn.mesh.userData.visitedNodes}));
