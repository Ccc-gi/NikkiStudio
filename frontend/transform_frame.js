import * as T from 'three';

// A handle frame changes the operation axes, never the asset calibration.
// Keep the authored actor pivot so offsets and Blueprint children remain intact.
export class TransformFrame {
  constructor(){this.object=new T.Object3D();this.actor=null;this.basis=new T.Quaternion();}
  attach(actor,workingQuaternion=null){
    this.actor=actor;
    this.basis.copy(actor.children[0]?.quaternion??new T.Quaternion());
    this.object.position.copy(actor.position);
    this.object.quaternion.copy(actor.quaternion).multiply(this.basis);
    if(workingQuaternion){this.basis.copy(actor.quaternion).invert().multiply(workingQuaternion);this.object.quaternion.copy(workingQuaternion);}
    this.object.scale.set(1,1,1);
    this.object.updateMatrixWorld(true);
    return this.object;
  }
  apply(mode){
    if(!this.actor)return;
    if(mode==='translate')this.actor.position.copy(this.object.position);
    if(mode==='rotate')this.actor.quaternion.copy(this.object.quaternion).multiply(this.basis.clone().invert()).normalize();
    this.actor.updateMatrixWorld(true);
  }
}

export class MultiTransformFrame {
  constructor(){this.object=new T.Object3D();this.actors=[];this.start=null;}
  attach(actors,workingQuaternion=null){
    this.actors=[...actors];
    const bounds=new T.Box3();
    for(const actor of this.actors){actor.updateWorldMatrix(true,true);bounds.union(new T.Box3().setFromObject(actor));}
    if(bounds.isEmpty())this.object.position.set(0,0,0);else bounds.getCenter(this.object.position);
    const active=this.actors.at(-1);
    this.object.quaternion.copy(active?.quaternion??new T.Quaternion()).multiply(active?.children[0]?.quaternion??new T.Quaternion());
    if(workingQuaternion)this.object.quaternion.copy(workingQuaternion);
    this.object.scale.set(1,1,1);this.object.updateMatrixWorld(true);this.start=null;
    return this.object;
  }
  begin(){
    this.start={position:this.object.position.clone(),quaternion:this.object.quaternion.clone(),
      actors:this.actors.map(actor=>({actor,position:actor.position.clone(),quaternion:actor.quaternion.clone()}))};
  }
  apply(mode){
    if(!this.start)return;
    const move=this.object.position.clone().sub(this.start.position);
    const rotation=this.object.quaternion.clone().multiply(this.start.quaternion.clone().invert()).normalize();
    for(const {actor,position,quaternion} of this.start.actors){
      if(mode==='translate')actor.position.copy(position).add(move);
      if(mode==='rotate'){
        actor.position.copy(position).sub(this.start.position).applyQuaternion(rotation).add(this.start.position);
        actor.quaternion.copy(rotation).multiply(quaternion).normalize();
      }
      actor.updateMatrixWorld(true);
    }
  }
}
