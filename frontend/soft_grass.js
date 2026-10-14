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
    gradient.addColorStop(0,'#396f29');gradient.addColorStop(.35,'#639635');
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
  const capacity=65000,mesh=new T.InstancedMesh(geometry,material,capacity);
  mesh.name='ProceduralSoftGrass';mesh.count=0;mesh.castShadow=false;mesh.receiveShadow=true;
  mesh.frustumCulled=false;mesh.raycast=()=>{};
  const dummy=new T.Object3D(),color=new T.Color();let last='',obstacles=[],revision=0,pendingGroup=null;
  const hash=(x,z,k=0)=>{let n=Math.imul(x,374761393)^Math.imul(z,668265263)^Math.imul(k,1274126177);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967296;};
  function scan(group){
    group.updateMatrixWorld(true);obstacles=[];
    group.traverse(o=>{
      if(!o.isMesh||!o.geometry||o.userData.unmatched)return;
      const b=new T.Box3().setFromObject(o);
      // Low surfaces cover the preview lawn: paving, decks, steps and rocks.
      // Elevated furniture and foliage do not clear the entire area underneath.
      let owner=o;while(owner.parent&&owner.parent!==group)owner=owner.parent;
      if(b.min.y<.18&&b.max.y>-.13&&b.max.y<1.2)
        obstacles.push({minX:b.min.x-.35,maxX:b.max.x+.35,minZ:b.min.z-.35,maxZ:b.max.z+.35,owner});
    });
  }
  function fit(group){pendingGroup=group;revision++;last='';}
  function update(camera,level,ground){
    mesh.visible=level==='fine'&&ground.visible;if(!mesh.visible)return;
    if(pendingGroup){scan(pendingGroup);pendingGroup=null;}
    camera.updateMatrixWorld();
    const key=[...camera.position.toArray().map(v=>Math.round(v*4)),
      ...camera.quaternion.toArray().map(v=>Math.round(v*100)),camera.aspect,camera.fov,revision].join(':');
    if(key===last)return;last=key;
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
    const tileSize=8,tiles=[],box=new T.Box3(),point=new T.Vector3();let estimate=0,count=0;
    for(let tx=Math.floor(visible.min.x/tileSize);tx<=Math.floor(visible.max.x/tileSize);tx++)
      for(let tz=Math.floor(visible.min.z/tileSize);tz<=Math.floor(visible.max.z/tileSize);tz++){
        box.min.set(tx*tileSize,groundY,tz*tileSize);box.max.set((tx+1)*tileSize,.4,(tz+1)*tileSize);
        if(!frustum.intersectsBox(box))continue;
        const distance=camera.position.distanceTo(box.getCenter(point));
        const step=.29*Math.pow(2,Math.max(0,Math.floor(Math.log2(Math.max(1,distance/28)))));
        const cells=Math.max(1,Math.ceil(tileSize/step));estimate+=cells*cells;
        tiles.push({tx,tz,cells,nearby:obstacles.filter(b=>b.owner.visible&&b.maxX>box.min.x&&b.minX<box.max.x&&b.maxZ>box.min.z&&b.minZ<box.max.z)});
      }
    const budgetScale=Math.max(1,Math.ceil(Math.sqrt(estimate/48000)));
    tufts:for(const {tx,tz,cells,nearby} of tiles){
      const n=Math.max(1,Math.floor(cells/budgetScale)),step=tileSize/n;
      for(let i=0;i<n;i++)for(let j=0;j<n;j++){
      const ix=tx*97+i,iz=tz*97+j;
      const x=tx*tileSize+(i+hash(ix,iz))*step,z=tz*tileSize+(j+hash(ix,iz,1))*step;
      if(x<visible.min.x||x>visible.max.x||z<visible.min.z||z>visible.max.z||
        !frustum.containsPoint(point.set(x,groundY+.12,z))||nearby.some(b=>x>b.minX&&x<b.maxX&&z>b.minZ&&z<b.maxZ))continue;
      const patch=.5+.25*Math.sin(x*.43+Math.sin(z*.29))+.25*Math.sin(z*.51+x*.11);
      // Broad sparse and lush patches, rather than uniform needle-like coverage.
      if(hash(ix,iz,6)>.60+patch*.38)continue;
      dummy.position.set(x,-.115,z);dummy.rotation.set(0,hash(ix,iz,2)*Math.PI*2,0);
      const width=.25+hash(ix,iz,3)*.12;
      dummy.scale.set(width,.13+patch*.10+hash(ix,iz,4)*.045,width);
      dummy.updateMatrix();mesh.setMatrixAt(count,dummy.matrix);
      color.setRGB(.93+patch*.08,.94+patch*.08,.88+patch*.1).multiplyScalar(.93+hash(ix,iz,5)*.06);
      mesh.setColorAt(count,color);if(++count===capacity)break tufts;
      }
    }
    mesh.userData.visibleTiles=tiles.length;mesh.userData.tuftCount=count;
    mesh.count=count;mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
  }
  return {mesh,fit,update};
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
