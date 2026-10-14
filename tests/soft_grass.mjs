import assert from 'node:assert/strict';
import * as T from 'three';
import {createSoftGrass} from '../frontend/soft_grass.js';
// Drawing API stub: tests exercise placement and view geometry without a browser.
globalThis.document={createElement:()=>({getContext:()=>({
  createLinearGradient:()=>({addColorStop(){}}),beginPath(){},moveTo(){},
  bezierCurveTo(){},closePath(){},fill(){}
})})};
const lawn=createSoftGrass(),group=new T.Group();
const paving=new T.Mesh(new T.BoxGeometry(4,.1,4));paving.position.y=-.05;group.add(paving);
const camera=new T.PerspectiveCamera(),ground={visible:true},center=new T.Vector3();
lawn.fit(group);lawn.update(camera,'standard',ground,center);assert.equal(lawn.mesh.visible,false);
lawn.update(camera,'fine',ground,center);assert.equal(lawn.mesh.visible,true);
assert.ok(lawn.mesh.count>3000&&lawn.mesh.count<=65000);
const matrix=new T.Matrix4();
for(let i=0;i<lawn.mesh.count;i++){
  lawn.mesh.getMatrixAt(i,matrix);const x=matrix.elements[12],z=matrix.elements[14];
  assert.ok(!(Math.abs(x)<2.08&&Math.abs(z)<2.08),'Grass must not penetrate paving');
}
const original=Array.from(lawn.mesh.instanceMatrix.array);
const frustum=new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
let farTufts=0;
for(let i=0;i<lawn.mesh.count;i++){
  lawn.mesh.getMatrixAt(i,matrix);const p=new T.Vector3().setFromMatrixPosition(matrix);p.y+=.12;
  assert.ok(frustum.containsPoint(p),'Tuft roots should be inside the current view');
  if(p.length()>18)farTufts++;
}
assert.ok(farTufts>0,'Visible grass must extend beyond the old 18 metre radius');
lawn.update(camera,'light',ground,center);assert.equal(lawn.mesh.visible,false);
lawn.update(camera,'fine',ground,center);assert.deepEqual(Array.from(lawn.mesh.instanceMatrix.array),original);
// Batching hides a render mesh while its logical furniture owner stays visible.
const owner=new T.Group();group.remove(paving);owner.add(paving);group.add(owner);paving.visible=false;
lawn.fit(group);lawn.update(camera,'fine',ground,center);
for(let i=0;i<lawn.mesh.count;i++){
  lawn.mesh.getMatrixAt(i,matrix);assert.ok(!(Math.abs(matrix.elements[12])<2.35&&Math.abs(matrix.elements[14])<2.35));
}
ground.visible=false;lawn.update(camera,'fine',ground,center);assert.equal(lawn.mesh.visible,false);
console.log('PASS: fine-only grass, batched paving exclusion, stable positions, ground visibility; tufts='+lawn.mesh.count);
