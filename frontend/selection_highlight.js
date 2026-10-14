import * as T from 'three';
import {preserveMaterialShader} from './foliage_material.js';

// Per-instance colour keeps shared furniture materials and geometry untouched.
export class SelectionHighlight {
  constructor(){this.changed=[];this.tint=new T.Color(0x65ffce);this.white=new T.Color(0xffffff);this.materialCache=new WeakMap();this.batchIndex=new Map();this.previous=new Set();this.topology=null;this.metrics={materialClones:0,colourWrites:0};}
  clear(){for(const {mesh,original} of this.changed)mesh.material=original;this.changed=[];}
  apply(selected,batches){
    this.clear();
    if(this.topology!==batches.batches){
      this.topology=batches.batches;this.batchIndex.clear();this.previous.clear();
      for(const {render,items} of batches.batches){
        // Fallback for external callers; normal batches preallocate white colours.
        if(!render.instanceColor){items.forEach((_,index)=>render.setColorAt(index,this.white));render.instanceColor.needsUpdate=true;for(const m of Array.isArray(render.material)?render.material:[render.material])m.needsUpdate=true;}
        items.forEach(({owner},index)=>{if(!this.batchIndex.has(owner))this.batchIndex.set(owner,[]);this.batchIndex.get(owner).push({render,index});});
      }
    }
    const changed=new Set([...this.previous,...selected]);
    for(const owner of changed){if(this.previous.has(owner)===selected.has(owner))continue;for(const {render,index} of this.batchIndex.get(owner)??[]){render.setColorAt(index,selected.has(owner)?this.tint:this.white);render.instanceColor.needsUpdate=true;this.metrics.colourWrites++;}}
    this.previous=new Set(selected);
    for(const owner of selected){if(!owner.visible)continue;owner.traverse(mesh=>{
      // Instanced source meshes are invisible and highlighted in their batch.
      if(!mesh.isMesh||!mesh.visible)return;
      const original=mesh.material,materials=Array.isArray(original)?original:[original];
      const clones=materials.map(material=>{if(this.materialCache.has(material))return this.materialCache.get(material);const clone=preserveMaterialShader(material,material.clone());if(clone.color)clone.color.multiply(this.tint);if(clone.emissive){clone.emissive.lerp(this.tint,.3);clone.emissiveIntensity=Math.max(.35,clone.emissiveIntensity??1);}this.materialCache.set(material,clone);this.metrics.materialClones++;return clone;});
      mesh.material=Array.isArray(original)?clones:clones[0];this.changed.push({mesh,original,clones});
    });}
  }
}
