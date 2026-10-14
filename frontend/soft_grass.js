import * as T from 'three';
import {createGardenAtlas} from './garden_art.js';
import {growthRandom as hash,sampleGarden,worldRoot,ROOT_SPACING,ATLAS_COLUMNS} from './garden_growth.js';

// Original procedural preview art. Positions are metres, never save coordinates.
export const createGrassTuftTexture=createGardenAtlas;

export function createSoftGrass(){
  const material=new T.MeshStandardMaterial({color:0xffffff,map:createGrassTuftTexture(),roughness:1,
    side:T.DoubleSide,alphaTest:.15,alphaToCoverage:true});
  material.onBeforeCompile=shader=>{
    // Grass already has painted shading. Four nearby depth samples avoid the
    // expensive PCSS blocker search on thousands of overlapping alpha cards.
    shader.fragmentShader=shader.fragmentShader.replace('#include <shadowmap_pars_fragment>',
      T.ShaderChunk.shadowmap_pars_fragment.replace('shadow = PCSS(shadowMap, shadowCoord);',`
        vec2 grassTexel=vec2(1.0)/shadowMapSize;
        shadow=.25*(step(shadowCoord.z,depth)
          +step(shadowCoord.z,texture2D(shadowMap,shadowCoord.xy+grassTexel*vec2(1.,0.)).r)
          +step(shadowCoord.z,texture2D(shadowMap,shadowCoord.xy+grassTexel*vec2(0.,1.)).r)
          +step(shadowCoord.z,texture2D(shadowMap,shadowCoord.xy+grassTexel).r));`));
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
      varying float grassHeight;
      attribute float gardenVariant;
      attribute vec2 gardenLean;
      varying float vGardenVariant;`).replace('#include <begin_vertex>',`#include <begin_vertex>
      grassHeight=position.y;vGardenVariant=gardenVariant;
      transformed.xz+=gardenLean*grassHeight*grassHeight;
      `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      varying float grassHeight;
      varying float vGardenVariant;`).replace('#include <map_fragment>',`
      #ifdef USE_MAP
        vec2 gardenUv=vec2((vMapUv.x*.94+.03+floor(vGardenVariant+.5))/${ATLAS_COLUMNS}.0,vMapUv.y);
        diffuseColor*=texture2D(map,gardenUv);
      #endif
      `).replace('#include <color_fragment>',`#include <color_fragment>
      diffuseColor.rgb *= mix(vec3(.9,.96,.85),vec3(1.02,1.02,.98),smoothstep(0.0,1.0,grassHeight));
    `);
  };
  // Three crossed cards preserve painted clump silhouettes from every angle.
  const geometry=new T.BufferGeometry();
  const positions=[],normals=[],indices=[],uvs=[];
  for(let blade=0;blade<3;blade++){
    const angle=blade*Math.PI/3,base=blade*6,dx=Math.cos(angle),dz=Math.sin(angle);
    for(const [x,y,u,v] of [[-.8,0,0,0],[.8,0,1,0],[-.8,.5,0,.5],[.8,.5,1,.5],[-.8,1,0,1],[.8,1,1,1]]){
      positions.push(dx*x,y,dz*x);normals.push(0,.985,.17);uvs.push(u,v);
    }
    indices.push(base,base+1,base+2,base+1,base+3,base+2,base+2,base+3,base+4,base+3,base+5,base+4);
  }
  geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setIndex(indices);
  geometry.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));
  // Rounded clump lighting prevents thin grass ribbons looking metallic or hard.
  geometry.setAttribute('normal',new T.Float32BufferAttribute(normals,3));
  const capacity=24000,mesh=new T.InstancedMesh(geometry,material,capacity);
  const variants=new T.InstancedBufferAttribute(new Float32Array(capacity),1).setUsage(T.DynamicDrawUsage);
  const leans=new T.InstancedBufferAttribute(new Float32Array(capacity*2),2).setUsage(T.DynamicDrawUsage);
  geometry.setAttribute('gardenVariant',variants);geometry.setAttribute('gardenLean',leans);
  mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
  mesh.name='ProceduralSoftGrass';mesh.count=0;mesh.castShadow=false;mesh.receiveShadow=true;
  mesh.frustumCulled=false;mesh.raycast=()=>{};
  let last='',obstacles=[],revision=0,pendingGroup=null,job=null,lastStart=-Infinity;
  const nextMatrices=new Float32Array(capacity*16),nextColors=new Float32Array(capacity*3);
  const nextVariants=new Float32Array(capacity),nextLeans=new Float32Array(capacity*2);
  const obstacleGrid=new Map(),largeObstacles=[],obstacleBounds=new T.Box3();
  function scan(group){
    group.updateMatrixWorld(true);obstacles=[];obstacleGrid.clear();largeObstacles.length=0;obstacleBounds.makeEmpty();
    group.traverse(o=>{
      if(!o.isMesh||!o.geometry||o.userData.unmatched)return;
      const b=new T.Box3().setFromObject(o);
      // Low surfaces cover the preview lawn: paving, decks, steps and rocks.
      // Elevated furniture and foliage do not clear the entire area underneath.
      let owner=o;while(owner.parent&&owner.parent!==group)owner=owner.parent;
      if(b.min.y<.18&&b.max.y>-.13&&b.max.y<1.2)
        obstacles.push({minX:b.min.x-.35,maxX:b.max.x+.35,minZ:b.min.z-.35,maxZ:b.max.z+.35,owner});
    });
    for(const b of obstacles){
      obstacleBounds.expandByPoint(new T.Vector3(b.minX,-.115,b.minZ));
      obstacleBounds.expandByPoint(new T.Vector3(b.maxX,.4,b.maxZ));
      const x0=Math.floor(b.minX/8),x1=Math.floor(b.maxX/8),z0=Math.floor(b.minZ/8),z1=Math.floor(b.maxZ/8);
      if((x1-x0+1)*(z1-z0+1)>4096){largeObstacles.push(b);continue;}
      for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){
        const key=x+':'+z;if(!obstacleGrid.has(key))obstacleGrid.set(key,[]);obstacleGrid.get(key).push(b);
      }
    }
  }
  function fit(group){pendingGroup=group;revision++;last='';job=null;lastStart=-Infinity;}
  function writePlant(index,x,z,shape,variant,width,height,flower=false){
    const angle=hash(shape.ix,shape.iz,2)*Math.PI*2,cos=Math.cos(angle)*width,sin=Math.sin(angle)*width;
    nextMatrices.set([cos,0,-sin,0,0,height,0,0,sin,0,cos,0,x,-.115,z,1],index*16);
    const tint=.93+hash(shape.ix,shape.iz,5)*.06,fertility=shape.fertility;
    nextColors.set(flower?[tint,tint,tint]:[(.93+fertility*.08)*tint,(.94+fertility*.08)*tint,(.88+fertility*.1)*tint],index*3);
    nextVariants[index]=variant;
    nextLeans[index*2]=shape.bendX*(flower?.35:1);nextLeans[index*2+1]=shape.bendZ*(flower?.35:1);
  }
  function* build(camera,ground){
    const frustum=new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    // Intersect all twelve frustum edges with the preview ground. This includes
    // the whole visible ground, even when the horizon crosses the viewport.
    const corners=[];for(const z of [-1,1])for(const y of [-1,1])for(const x of [-1,1])corners.push(new T.Vector3(x,y,z).unproject(camera));
    const hits=[],groundY=-.115;
    for(const [a,b] of [[0,1],[0,2],[1,3],[2,3],[4,5],[4,6],[5,7],[6,7],[0,4],[1,5],[2,6],[3,7]]){
      const from=corners[a],to=corners[b],dy=to.y-from.y;
      if(Math.abs(dy)<1e-8)continue;const t=(groundY-from.y)/dy;
      if(t>=0&&t<=1)hits.push(from.clone().lerp(to,t));
    }
    if(!hits.length){mesh.count=0;mesh.userData.flowerCount=0;return;}
    const visible=new T.Box3().setFromPoints(hits),gx=ground.position?.x??0,gz=ground.position?.z??0;
    visible.min.x=Math.max(visible.min.x-.5,gx-(ground.scale?.x??2000)/2);
    visible.max.x=Math.min(visible.max.x+.5,gx+(ground.scale?.x??2000)/2);
    visible.min.z=Math.max(visible.min.z-.5,gz-(ground.scale?.y??2000)/2);
    visible.max.z=Math.min(visible.max.z+.5,gz+(ground.scale?.y??2000)/2);
    const tiles=[],box=new T.Box3(),point=new T.Vector3();let estimate=0,count=0,visited=0,flowers=0,tallCount=0;
    const palettes=[0,0,0];
    const rootSize=2**Math.ceil(Math.log2(Math.max(8,ground.scale?.x??2000,ground.scale?.y??2000)));
    const stack=[{x:gx-rootSize/2,z:gz-rootSize/2,size:rootSize}];
    while(stack.length){
        const {x,z,size}=stack.pop();
        if(++visited%64===0)yield;
        if(x>visible.max.x||x+size<visible.min.x||z>visible.max.z||z+size<visible.min.z)continue;
        box.min.set(x,groundY,z);box.max.set(x+size,.9,z+size);
        if(!frustum.intersectsBox(box))continue;
        const distance=box.distanceToPoint(camera.position);
        const desired=Math.min(256,8*2**Math.max(0,Math.floor(Math.log2(Math.max(1,distance/40)))));
        if(size>desired){const half=size/2;for(const dx of [0,half])for(const dz of [0,half])stack.push({x:x+dx,z:z+dz,size:half});continue;}
        const step=ROOT_SPACING*Math.pow(2,Math.max(0,Math.floor(Math.log2(Math.max(1,distance/40)))));
        const cells=Math.max(1,Math.ceil(size/step));estimate+=cells*cells;
        const candidates=new Set(largeObstacles);
        if(box.intersectsBox(obstacleBounds))for(let bx=Math.floor(x/8);bx<=Math.floor((x+size)/8);bx++)for(let bz=Math.floor(z/8);bz<=Math.floor((z+size)/8);bz++)for(const b of obstacleGrid.get(bx+':'+bz)??[])candidates.add(b);
        tiles.push({x,z,size,cells,step,distance,nearby:[...candidates].filter(b=>b.owner.visible&&b.maxX>x&&b.minX<x+size&&b.maxZ>z&&b.minZ<z+size)});
      }
    tiles.sort((a,b)=>a.distance-b.distance);
    // Reserve detail for nearby roots: a long horizon must not thin the grass
    // directly under the camera just to pay for distant, subpixel vegetation.
    const nearEstimate=tiles.filter(t=>t.distance<18).reduce((n,t)=>n+t.cells*t.cells,0);
    const scaleFor=(amount,budget)=>2**Math.max(0,Math.ceil(Math.log2(Math.max(1,Math.sqrt(amount/budget)))));
    const nearScale=scaleFor(nearEstimate,capacity*.55),farScale=scaleFor(estimate-nearEstimate,capacity*.30);let candidates=0;
    tufts:for(const {x:tileX,z:tileZ,size,step:baseStep,nearby,distance} of tiles){
      const budgetScale=distance<18?nearScale:farScale;
      const step=baseStep*budgetScale,stride=Math.round(step/ROOT_SPACING);
      for(let i=Math.floor(tileX/step);i<Math.ceil((tileX+size)/step);i++)for(let j=Math.floor(tileZ/step);j<Math.ceil((tileZ+size)/step);j++){
      if(++candidates%128===0)yield;
      const {ix,iz,x,z}=worldRoot(i,j,stride);
      if(x<tileX||x>=tileX+size||z<tileZ||z>=tileZ+size||x<visible.min.x||x>visible.max.x||z<visible.min.z||z>visible.max.z||
        !frustum.containsPoint(point.set(x,groundY+.12,z))||nearby.some(b=>x>b.minX&&x<b.maxX&&z>b.minZ&&z<b.maxZ))continue;
      const shape=sampleGarden(x,z,ix,iz);if(!shape.occupied)continue;
      shape.ix=ix;shape.iz=iz;
      writePlant(count,x,z,shape,shape.grassVariant,shape.width,shape.height);
      if(shape.tall)tallCount++;
      if(++count===capacity)break tufts;
      // Blossoms occupy the same safe root area; they share the draw and budget.
      if(shape.flowering&&distance<80&&flowers<400){
        writePlant(count,x,z,shape,shape.flowerVariant,shape.flowerWidth,Math.max(shape.flowerHeight,shape.height*1.35+.03));
        flowers++;palettes[shape.flowerVariant-4]++;if(++count===capacity)break tufts;
      }
      }
    }
    // Swap only completed builds: moving the camera never exposes half a lawn.
    mesh.instanceMatrix.array.set(nextMatrices.subarray(0,count*16));
    if(!mesh.instanceColor){mesh.instanceColor=new T.InstancedBufferAttribute(new Float32Array(capacity*3),3).setUsage(T.DynamicDrawUsage);material.needsUpdate=true;}
    mesh.instanceColor.array.set(nextColors.subarray(0,count*3));
    variants.array.set(nextVariants.subarray(0,count));leans.array.set(nextLeans.subarray(0,count*2));
    variants.clearUpdateRanges();variants.addUpdateRange(0,count);variants.needsUpdate=true;
    leans.clearUpdateRanges();leans.addUpdateRange(0,count*2);leans.needsUpdate=true;
    mesh.instanceMatrix.clearUpdateRanges();mesh.instanceMatrix.addUpdateRange(0,count*16);
    mesh.instanceColor.clearUpdateRanges();mesh.instanceColor.addUpdateRange(0,count*3);
    mesh.userData.visibleTiles=tiles.length;mesh.userData.tuftCount=count-flowers;
    mesh.userData.flowerCount=flowers;mesh.userData.flowerPalette=palettes;mesh.userData.tallCount=tallCount;
    mesh.userData.visitedNodes=visited;
    mesh.count=count;mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
  }
  function update(camera,level,ground){
    const started=performance.now();
    mesh.visible=level==='fine'&&ground.visible;if(!mesh.visible){job=null;last='';return;}
    if(pendingGroup){scan(pendingGroup);pendingGroup=null;}
    camera.updateMatrixWorld();
    const key=[...camera.position.toArray().map(v=>Math.round(v*2)),
      ...camera.quaternion.toArray().map(v=>Math.round(v*80)),camera.aspect,camera.fov,revision].join(':');
    const now=performance.now();
    if(!job&&key!==last&&(mesh.count===0||now-lastStart>100)){
      last=key;lastStart=now;job=build(camera.clone(),ground);
      mesh.userData.maxGenerationSliceMs=0;
    }
    const working=Boolean(job);
    const deadline=performance.now()+2;
    while(job&&performance.now()<deadline){if(job.next().done)job=null;}
    mesh.userData.generationPending=Boolean(job);
    mesh.userData.cpuMs=performance.now()-started;
    if(working)mesh.userData.maxGenerationSliceMs=Math.max(mesh.userData.maxGenerationSliceMs,mesh.userData.cpuMs);
  }
  // Synchronous draining is used only by geometry tests, never by rendering.
  function flush(){while(job){if(job.next().done)job=null;}}
  return {mesh,fit,update,flush};
}

export function createSoftGroundMaterial(){
  const material=new T.MeshStandardMaterial({color:0x70914d,roughness:1,
    polygonOffset:true,polygonOffsetFactor:2,polygonOffsetUnits:4});
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
      varying vec2 lawnPosition;`).replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
      lawnPosition=(modelMatrix*vec4(transformed,1.0)).xz;`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      varying vec2 lawnPosition;`).replace('#include <color_fragment>',`#include <color_fragment>
      vec2 p=lawnPosition;
      float broad=sin(p.x*.18+sin(p.y*.13))*sin(p.y*.23+p.x*.04);
      float soft=sin(p.x*1.7+sin(p.y*1.1))*sin(p.y*1.9);
      diffuseColor.rgb *= 1.0 + broad*.085 + soft*.018;
    `);
  };
  return material;
}
