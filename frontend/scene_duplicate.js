// Clone only the selected logical object; GLB geometry and textures stay shared.
export function cloneLoadedFurniture(source,clone,batchedItems=[]){
  const originals=[],copies=[],metadata=[];
  source.traverse(o=>{originals.push(o);metadata.push(o.userData);});
  // Object3D.clone serializes userData as JSON. Runtime material references in
  // that metadata otherwise serialize textures too, and become plain objects.
  let node;
  try{originals.forEach(o=>o.userData={});node=clone(source);}
  finally{originals.forEach((o,i)=>o.userData=metadata[i]);}
  node.traverse(o=>copies.push(o));
  copies.forEach((o,i)=>o.userData=o.isMesh?{...metadata[i]}:structuredClone(metadata[i]));
  const visibility=new Map(batchedItems.map(({item})=>[item.mesh,item.visible]));
  originals.forEach((original,i)=>{if(visibility.has(original))copies[i].visible=visibility.get(original);});
  node.visible=true;return node;
}
