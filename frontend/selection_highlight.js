import * as T from 'three';
import {preserveMaterialShader} from './foliage_material.js';

// Per-instance colour keeps shared furniture materials and geometry untouched.
// 选中与悬停共用这一遍写入，选中优先于悬停；两者只改颜色与自发光，不新增绘制调用。
//
// 批处理实例的颜色是「乘算」的，写白色等于没变化，所以想让它变亮只能给大于 1 的值——
// 着色器直接相乘，实例颜色缓冲是 Float32 不会截断。普通网格走材质克隆，提亮和自发光都能直接写。
const SELECTED_COLOR=0xf5c24a;  // 大喵兜帽黄，与主按钮同色
const SELECTED_LIFT=1.3;        // 实例色的提亮倍率，抵消乘算带来的压暗
export class SelectionHighlight {
  constructor(getLevel=()=> 'standard'){
    this.getLevel=getLevel;this.changed=[];
    this.tint=new T.Color(SELECTED_COLOR);
    this.selectedInstance=this.tint.clone().multiplyScalar(SELECTED_LIFT);
    this.hoverInstance=new T.Color(1.34,1.32,1.24);
    this.base=new T.Color(1,1,1);
    this.materialCache=new WeakMap();this.batchIndex=new Map();this.previous=new Map();this.topology=null;
    this.metrics={materialClones:0,colourWrites:0};
  }
  clear(){for(const {mesh,original} of this.changed)mesh.material=original;this.changed=[];}
  apply(selected,hovered,batches){
    this.clear();
    if(this.topology!==batches.batches){
      this.topology=batches.batches;this.batchIndex.clear();this.previous.clear();
      for(const {render,items} of batches.batches){
        // Fallback for external callers; normal batches preallocate white colours.
        if(!render.instanceColor){items.forEach((_,index)=>render.setColorAt(index,this.base));render.instanceColor.needsUpdate=true;for(const m of Array.isArray(render.material)?render.material:[render.material])m.needsUpdate=true;}
        items.forEach(({owner},index)=>{if(!this.batchIndex.has(owner))this.batchIndex.set(owner,[]);this.batchIndex.get(owner).push({render,index});});
      }
    }
    const state=new Map();
    for(const owner of hovered)state.set(owner,'hover');
    for(const owner of selected)state.set(owner,'selected');
    for(const owner of new Set([...this.previous.keys(),...state.keys()])){
      const now=state.get(owner)??'none';
      if((this.previous.get(owner)??'none')===now)continue;
      const colour=now==='selected'?this.selectedInstance:now==='hover'?this.hoverInstance:this.base;
      for(const {render,index} of this.batchIndex.get(owner)??[]){render.setColorAt(index,colour);render.instanceColor.needsUpdate=true;this.metrics.colourWrites++;}
    }
    this.previous=state;
    const fine=this.getLevel()==='fine';
    for(const [owner,mode] of state){if(!owner.visible)continue;owner.traverse(mesh=>{
      // Instanced source meshes are invisible and highlighted in their batch.
      if(!mesh.isMesh||!mesh.visible)return;
      const original=mesh.material,materials=Array.isArray(original)?original:[original];
      const picked=mode==='selected',key=(fine?'natural:':'legacy:')+mode;
      const clones=materials.map(material=>{
        let cache=this.materialCache.get(material);if(!cache){cache=new Map();this.materialCache.set(material,cache);}
        if(cache.has(key))return cache.get(key);
        const clone=preserveMaterialShader(material,material.clone());
        const toward=picked?this.tint:this.base;
        if(clone.color)clone.color.lerp(toward,picked?(fine?.24:.42):(fine?.16:.28));
        if(clone.emissive){
          clone.emissive.lerp(toward,picked?(fine?.26:.32):(fine?.14:.2));
          clone.emissiveIntensity=Math.max(picked?(fine?.3:.42):(fine?.14:.22),clone.emissiveIntensity??1);
        }
        cache.set(key,clone);this.metrics.materialClones++;return clone;
      });
      mesh.material=Array.isArray(original)?clones:clones[0];this.changed.push({mesh,original,clones});
    });}
  }
}
