import assert from 'node:assert/strict';
import * as T from 'three';
import {previewCameraDistance} from '../frontend/preset_preview_geometry.js';
for(const size of [new T.Vector3(1,1,1),new T.Vector3(100,1,3),new T.Vector3(3,120,1),new T.Vector3(0,0,0)])for(const aspect of [.4,1,1.6,3]){
  const distance=previewCameraDistance(size,aspect),camera=new T.PerspectiveCamera(40,aspect,.001,distance*20);
  camera.position.copy(new T.Vector3(1,.65,1.15).normalize().multiplyScalar(distance));camera.lookAt(0,0,0);camera.updateMatrixWorld();
  for(const x of [-.5,.5])for(const y of [-.5,.5])for(const z of [-.5,.5]){
    const projected=new T.Vector3(size.x*x,size.y*y,size.z*z).project(camera);
    assert.ok(Math.abs(projected.x)<=1&&Math.abs(projected.y)<=1&&Math.abs(projected.z)<=1,'full assembly fits both viewport axes');
  }
}
console.log('PASS: preset framing covers tall, wide, degenerate and portrait assemblies');
