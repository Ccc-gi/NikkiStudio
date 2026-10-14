import * as T from 'three';
import {createMeadowTexture} from './storybook_environment.js';
// Code-generated preview ground; no game art dependencies.
export function createGrassGround(scene,renderer){
const map=createMeadowTexture();
const material=new T.MeshStandardMaterial({color:0xffffff,map,roughness:1,
  polygonOffset:true,polygonOffsetFactor:2,polygonOffsetUnits:4});
const ground=new T.Mesh(new T.PlaneGeometry(1,1),material);ground.name='PreviewGrassGround';ground.userData.isNavigationGround=true;ground.rotation.x=-Math.PI/2;ground.position.y=-.12;scene.add(ground);
function fitToFurniture(group){group.updateMatrixWorld(true);const b=new T.Box3().setFromObject(group);if(b.isEmpty()){ground.scale.set(2000,2000,1);ground.position.set(0,-.12,0);}else{ground.scale.set(Math.max(2000,(b.max.x-b.min.x+40)*12),Math.max(2000,(b.max.z-b.min.z+40)*12),1);ground.position.set((b.max.x+b.min.x)/2,-.12,(b.max.z+b.min.z)/2);}map.repeat.set(ground.scale.x/8,ground.scale.y/8);}
fitToFurniture(new T.Group());return {ground,ready:Promise.resolve(),fitToFurniture,update:()=>{}};
}
