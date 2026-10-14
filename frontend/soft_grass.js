import * as T from 'three';

// Original procedural preview art. Positions are metres, never save coordinates.
export function createGrassTuftTexture(){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
  const c=canvas.getContext('2d');
  // Original brush-like leaves: wide curved bodies, fine tips, painted shading.
  for(let leaf=0;leaf<22;leaf++){
    const side=leaf%2===0?-1:1;
    const baseX=128+Math.sin(leaf*2.4)*25,tipX=128+side*(18+(leaf*37%83));
    const baseY=250,tipY=30+(leaf*31%95),width=8+(leaf*11%11);
    const gradient=c.createLinearGradient(baseX,baseY,tipX,tipY);
    gradient.addColorStop(0,'#56833c');gradient.addColorStop(.35,'#709e45');
    gradient.addColorStop(.78,leaf%3===0?'#a4c663':'#85b54d');gradient.addColorStop(1,'#b8cf75');
    c.fillStyle=gradient;c.beginPath();c.moveTo(baseX-width*.4,baseY);
    c.bezierCurveTo(baseX-width,baseY-50,tipX-side*32-width,tipY+35,tipX,tipY);
    c.bezierCurveTo(tipX-side*16+width,tipY+52,baseX+width,baseY-45,baseX+width*.4,baseY);
    c.closePath();c.fill();
  }
  const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
  texture.anisotropy=4;return texture;
}

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
      varying float grassHeight;`).replace('#include <begin_vertex>',`#include <begin_vertex>
      grassHeight=position.y;
      `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      varying float grassHeight;`).replace('#include <color_fragment>',`#include <color_fragment>
      diffuseColor.rgb *= mix(vec3(.9,.96,.85),vec3(1.02,1.02,.98),smoothstep(0.0,1.0,grassHeight));
    `);
  };
  // Three crossed cards preserve painted clump silhouettes from every angle.
  const geometry=new T.BufferGeometry();
  const positions=[],normals=[],indices=[],uvs=[];
  for(let blade=0;blade<3;blade++){
    const angle=blade*Math.PI/3,base=blade*4,dx=Math.cos(angle),dz=Math.sin(angle);
    for(const [x,y,u,v] of [[-.8,0,0,0],[.8,0,1,0],[-.8,1,0,1],[.8,1,1,1]]){
      positions.push(dx*x,y,dz*x);normals.push(0,.985,.17);uvs.push(u,v);
    }
    indices.push(base,base+1,base+2,base+1,base+3,base+2);
  }
  geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setIndex(indices);
  geometry.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));
  // Rounded clump lighting prevents thin grass ribbons looking metallic or hard.
  geometry.setAttribute('normal',new T.Float32BufferAttribute(normals,3));
  const capacity=24000,mesh=new T.InstancedMesh(geometry,material,capacity);
  mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
  mesh.name='ProceduralSoftGrass';mesh.count=0;mesh.castShadow=false;mesh.receiveShadow=true;
  mesh.frustumCulled=false;mesh.raycast=()=>{};
  let last='',obstacles=[],revision=0,pendingGroup=null,job=null,lastStart=-Infinity;
  const nextMatrices=new Float32Array(capacity*16),nextColors=new Float32Array(capacity*3);
  const obstacleGrid=new Map(),largeObstacles=[],obstacleBounds=new T.Box3();
  const hash=(x,z,k=0)=>{let n=Math.imul(x,374761393)^Math.imul(z,668265263)^Math.imul(k,1274126177);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967296;};
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
    if(!hits.length){mesh.count=0;return;}
    const visible=new T.Box3().setFromPoints(hits),gx=ground.position?.x??0,gz=ground.position?.z??0;
    visible.min.x=Math.max(visible.min.x-.5,gx-(ground.scale?.x??2000)/2);
    visible.max.x=Math.min(visible.max.x+.5,gx+(ground.scale?.x??2000)/2);
    visible.min.z=Math.max(visible.min.z-.5,gz-(ground.scale?.y??2000)/2);
    visible.max.z=Math.min(visible.max.z+.5,gz+(ground.scale?.y??2000)/2);
    const tiles=[],box=new T.Box3(),point=new T.Vector3();let estimate=0,count=0,visited=0;
    const rootSize=2**Math.ceil(Math.log2(Math.max(8,ground.scale?.x??2000,ground.scale?.y??2000)));
    const stack=[{x:gx-rootSize/2,z:gz-rootSize/2,size:rootSize}];
    while(stack.length){
        const {x,z,size}=stack.pop();
        if(++visited%64===0)yield;
        if(x>visible.max.x||x+size<visible.min.x||z>visible.max.z||z+size<visible.min.z)continue;
        box.min.set(x,groundY,z);box.max.set(x+size,.4,z+size);
        if(!frustum.intersectsBox(box))continue;
        const distance=box.distanceToPoint(camera.position);
        const desired=Math.min(256,8*2**Math.max(0,Math.floor(Math.log2(Math.max(1,distance/40)))));
        if(size>desired){const half=size/2;for(const dx of [0,half])for(const dz of [0,half])stack.push({x:x+dx,z:z+dz,size:half});continue;}
        const step=.24*Math.pow(2,Math.max(0,Math.floor(Math.log2(Math.max(1,distance/40)))));
        const cells=Math.max(1,Math.ceil(size/step));estimate+=cells*cells;
        const candidates=new Set(largeObstacles);
        if(box.intersectsBox(obstacleBounds))for(let bx=Math.floor(x/8);bx<=Math.floor((x+size)/8);bx++)for(let bz=Math.floor(z/8);bz<=Math.floor((z+size)/8);bz++)for(const b of obstacleGrid.get(bx+':'+bz)??[])candidates.add(b);
        tiles.push({x,z,size,cells,distance,nearby:[...candidates].filter(b=>b.owner.visible&&b.maxX>x&&b.minX<x+size&&b.maxZ>z&&b.minZ<z+size)});
      }
    tiles.sort((a,b)=>a.distance-b.distance);
    const budgetScale=Math.max(1,Math.sqrt(estimate/(capacity*.85)));let candidates=0;
    tufts:for(const {x:tileX,z:tileZ,size,cells,nearby} of tiles){
      const n=Math.max(1,Math.floor(cells/budgetScale)),step=size/n;
      for(let i=0;i<n;i++)for(let j=0;j<n;j++){
      if(++candidates%128===0)yield;
      const ix=Math.round(tileX*16)+i,iz=Math.round(tileZ*16)+j;
      const x=tileX+(i+hash(ix,iz))*step,z=tileZ+(j+hash(ix,iz,1))*step;
      if(x<visible.min.x||x>visible.max.x||z<visible.min.z||z>visible.max.z||
        !frustum.containsPoint(point.set(x,groundY+.12,z))||nearby.some(b=>x>b.minX&&x<b.maxX&&z>b.minZ&&z<b.maxZ))continue;
      const patch=.5+.25*Math.sin(x*.43+Math.sin(z*.29))+.25*Math.sin(z*.51+x*.11);
      // Broad sparse and lush patches, rather than uniform needle-like coverage.
      if(hash(ix,iz,6)>.75+patch*.22)continue;
      const width=.42+hash(ix,iz,3)*.18;
      const angle=hash(ix,iz,2)*Math.PI*2,cos=Math.cos(angle)*width,sin=Math.sin(angle)*width;
      const m=count*16;
      nextMatrices.set([cos,0,-sin,0,0,.18+patch*.09+hash(ix,iz,4)*.045,0,0,sin,0,cos,0,x,-.115,z,1],m);
      const tint=.93+hash(ix,iz,5)*.06;
      nextColors.set([(.93+patch*.08)*tint,(.94+patch*.08)*tint,(.88+patch*.1)*tint],count*3);
      if(++count===capacity)break tufts;
      }
    }
    // Swap only completed builds: moving the camera never exposes half a lawn.
    mesh.instanceMatrix.array.set(nextMatrices.subarray(0,count*16));
    if(!mesh.instanceColor){mesh.instanceColor=new T.InstancedBufferAttribute(new Float32Array(capacity*3),3).setUsage(T.DynamicDrawUsage);material.needsUpdate=true;}
    mesh.instanceColor.array.set(nextColors.subarray(0,count*3));
    mesh.instanceMatrix.clearUpdateRanges();mesh.instanceMatrix.addUpdateRange(0,count*16);
    mesh.instanceColor.clearUpdateRanges();mesh.instanceColor.addUpdateRange(0,count*3);
    mesh.userData.visibleTiles=tiles.length;mesh.userData.tuftCount=count;
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
