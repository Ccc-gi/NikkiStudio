import * as T from 'three';

// Logical nodes remain individual furniture; only their static render meshes are batched.
export class FurnitureInstances {
  constructor(scene){this.pool=new T.Group();this.pool.name='FurnitureInstanceBatches';scene.add(this.pool);this.batches=[];this.ownerIndex=new Map();}
  clear(){for(const b of this.batches){for(const item of b.items)item.mesh.visible=item.visible;b.render.dispose();}this.batches=[];this.ownerIndex.clear();this.pool.clear();}
  rebuild(group){
    this.clear();group.updateMatrixWorld(true);const buckets=new Map();
    for(const owner of group.children)owner.traverse(mesh=>{
      if(!mesh.isMesh||mesh.isSkinnedMesh||mesh.morphTargetInfluences||!mesh.visible||owner.userData.unmatched||mesh.matrixWorld.determinant()<=0)return;
      const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
      if(materials.some(m=>m.transparent))return;
      // Spatial cells give each batch useful culling bounds.
      const p=new T.Vector3().setFromMatrixPosition(mesh.matrixWorld);
      const key=mesh.geometry.uuid+':'+materials.map(m=>m.uuid).join(',')+':'+Math.floor(p.x/20)+','+Math.floor(p.z/20);
      if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push({mesh,owner,visible:mesh.visible});
    });
    for(const items of buckets.values()){
      if(items.length<3)continue;
      const first=items[0].mesh,render=new T.InstancedMesh(first.geometry,first.material,items.length);
      render.castShadow=first.castShadow;render.receiveShadow=first.receiveShadow;
      render.userData.renderMaterial=first.userData.renderMaterial??first.material;
      render.userData.owners=items.map(i=>i.owner);render.instanceMatrix.setUsage(T.DynamicDrawUsage);
      // Allocate the colour shader variant during scene loading, not first selection.
      const white=new T.Color(0xffffff);items.forEach((_,i)=>render.setColorAt(i,white));
      const batch={render,items};items.forEach((item,index)=>{item.mesh.visible=false;if(!this.ownerIndex.has(item.owner))this.ownerIndex.set(item.owner,[]);this.ownerIndex.get(item.owner).push({batch,item,index});});this.pool.add(render);this.batches.push(batch);
    }
    this.sync(group);
  }
  sync(group){
    group.updateMatrixWorld(true);const hidden=new T.Matrix4().makeScale(0,0,0);
    for(const {render,items} of this.batches){
      render.instanceMatrix.clearUpdateRanges();
      let visible=0;
      items.forEach(({mesh,owner},i)=>{let shown=owner.visible;for(let p=mesh.parent;p&&p!==owner;p=p.parent)shown=shown&&p.visible;
        render.setMatrixAt(i,shown?mesh.matrixWorld:hidden);if(shown)visible++;});
      render.visible=visible>0;render.instanceMatrix.needsUpdate=true;render.computeBoundingBox();render.computeBoundingSphere();
    }
  }
  owner(hit,group){
    if(hit.object.isInstancedMesh){const owner=hit.object.userData.owners?.[hit.instanceId];return hit.object.visible&&owner?.visible?owner:null;}
    for(let p=hit.object;p&&p!==group;p=p.parent)if(!p.visible)return null;
    let o=hit.object;while(o.parent&&o.parent!==group)o=o.parent;return o.parent===group?o:null;
  }
  syncOwners(owners){
    const touched=new Set(),hidden=new T.Matrix4().makeScale(0,0,0);let writes=0;
    for(const owner of owners){owner.updateWorldMatrix(true,true);for(const {batch,item,index} of this.ownerIndex.get(owner)??[]){let shown=owner.visible;for(let p=item.mesh.parent;p&&p!==owner;p=p.parent)shown=shown&&p.visible;batch.render.setMatrixAt(index,shown?item.mesh.matrixWorld:hidden);batch.render.instanceMatrix.addUpdateRange(index*16,16);touched.add(batch);writes++;}}
    for(const batch of touched){batch.render.instanceMatrix.needsUpdate=true;batch.render.computeBoundingBox();batch.render.computeBoundingSphere();}
    return writes;
  }
  get count(){return this.batches.reduce((n,b)=>n+b.items.length,0);}
}
