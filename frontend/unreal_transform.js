// CUE4Parse GLB basis: UE (X,Y,Z) -> (X,Z,Y), centimetres -> metres.
// Save rotation fields are Pitch,Yaw,Roll, not Three.js Euler X,Y,Z.
export function unrealQuaternionToScene([x,y,z,w]) {
  const length=Math.hypot(x,y,z,w);
  if(!Number.isFinite(length)||length===0)throw Error('无效的家具旋转四元数');
  return [-x/length,-z/length,-y/length,w/length];
}
// Shared preview model basis, below saved actor TRS. Per-model overrides replace
// it, never add to it. Evidence: 31 non-square footprints and user references.
// Both +90 and -90 swap a footprint's XY axes. Only an asymmetric front/back
// reference can distinguish them; the user's Sofa_41 reference favours -90.
export const FURNITURE_MODEL_BASIS={x:0,y:-90,z:0};
// Column-major UE affine matrix. Keep shear from rotated nonuniformly scaled
// composite children; decomposing it into TRS would silently alter geometry.
export function componentMatrixToScene(matrix){
  const axes=[0,2,1,3],out=new Array(16);
  for(let col=0;col<4;col++)for(let row=0;row<4;row++){
    out[col*4+row]=matrix[axes[col]*4+axes[row]]/(col===3&&row<3?100:1);
  }
  return out;
}
export function furnitureModelRotationToScene(asset,enabled=true,yaw=FURNITURE_MODEL_BASIS.y){
  // Authored Blueprint component trees are already expressed in actor space.
  // The shared mesh-root basis belongs to table-driven static HomeObjects.
  const basis=asset?.transformSpace==='actor'?{x:0,y:0,z:0}:(enabled?{...FURNITURE_MODEL_BASIS,y:yaw}:{x:0,y:0,z:0});
  return saveRotationToScene(asset?.modelRotation??basis);
}
// StaticMeshRootOffset is an actor-local translation from the game config.
// It is AFTER model basis rotation (not itself rotated by that basis), and
// BEFORE saved actor TRS. The exporter already converted mesh (X,Y,Z)->(X,Z,Y).
export function furnitureModelPositionToScene(asset,enabled=true,yaw=FURNITURE_MODEL_BASIS.y){
  const [x,y,z]=asset?.staticMeshRootOffset??[0,0,0];
  return [x/100,z/100,y/100];
}
export function saveRotationToScene({x:pitch,y:yaw,z:roll}) {
  const [p,y,r]=[pitch,yaw,roll].map(v=>v*Math.PI/360);
  const sp=Math.sin(p),cp=Math.cos(p),sy=Math.sin(y),cy=Math.cos(y),sr=Math.sin(r),cr=Math.cos(r);
  // Unreal FRotator::Quaternion, followed by the same basis conversion as the GLB.
  return unrealQuaternionToScene([
    cr*sp*sy-sr*cp*cy, -cr*sp*cy-sr*cp*sy,
    cr*cp*sy-sr*sp*cy, cr*cp*cy+sr*sp*sy
  ]);
}
