import assert from 'node:assert/strict';
import * as T from 'three';
import {createSoftGrass} from '../frontend/soft_grass.js';
import {createGrassGround} from '../frontend/scene_ground.js';
import './canvas_stub.mjs';
const lawn=createSoftGrass(),group=new T.Group();
const paving=new T.Mesh(new T.BoxGeometry(4,.1,4));paving.position.y=-.05;group.add(paving);
const camera=new T.PerspectiveCamera(),ground={visible:true},center=new T.Vector3();
lawn.fit(group);lawn.update(camera,'standard',ground,center);assert.equal(lawn.mesh.visible,false);
lawn.update(camera,'fine',ground,center);lawn.flush();assert.equal(lawn.mesh.visible,true);
assert.ok(lawn.mesh.count>1000&&lawn.mesh.count<=24000);
assert.ok(lawn.mesh.userData.flowerCount>0&&lawn.mesh.userData.flowerCount<=400);
assert.ok(lawn.mesh.userData.tallCount>0,'Garden should have some taller sheltered grass');
const matrix=new T.Matrix4();
for(let i=0;i<lawn.mesh.count;i++){
  lawn.mesh.getMatrixAt(i,matrix);const x=matrix.elements[12],z=matrix.elements[14];
  assert.equal(matrix.elements[13],0,'Grass and flower roots align with save Z=0');
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
lawn.fit(group);lawn.update(camera,'fine',ground,center);lawn.flush();
for(let i=0;i<lawn.mesh.count;i++){
  lawn.mesh.getMatrixAt(i,matrix);assert.ok(!(Math.abs(matrix.elements[12])<2.35&&Math.abs(matrix.elements[14])<2.35));
}
ground.visible=false;lawn.update(camera,'fine',ground,center);assert.equal(lawn.mesh.visible,false);
const scene=new T.Scene(),preview=createGrassGround(scene);
const plants=scene.getObjectByName('ProceduralSoftGrass');
preview.fitToFurniture(group);assert.equal(preview.ground.position.y,0);
preview.update(camera,'fine',center);assert.equal(plants.visible,true);
preview.setVegetationVisible(false);
assert.equal(plants.visible,false,'Vegetation hides immediately');
for(const level of ['fine','standard','light']){
  preview.update(camera,level,center);
  assert.equal(preview.ground.visible,true,'Ground remains visible at every quality');
  assert.equal(preview.ground.position.y,0);
  assert.equal(plants.visible,false,'Disabled vegetation stays hidden across quality changes');
}
preview.setVegetationVisible(true);preview.update(camera,'fine',center);
assert.equal(plants.visible,true,'Vegetation can be enabled again');
console.log('PASS: fine-only grass, batched paving exclusion, stable positions, ground visibility; tufts='+lawn.mesh.count);
