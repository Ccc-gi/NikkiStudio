// Perspective framing must account for both viewport axes and tall assemblies.
export function previewCameraDistance(size,aspect,fov=40){
  const vertical=Math.tan(fov*Math.PI/360),horizontal=vertical*Math.max(.1,aspect);
  const length=Math.hypot(1,.65,1.15),direction={x:1/length,y:.65/length,z:1.15/length};
  const sideLength=Math.hypot(direction.x,direction.z),right={x:direction.z/sideLength,y:0,z:-direction.x/sideLength};
  const up={x:direction.y*right.z,y:direction.z*right.x-direction.x*right.z,z:-direction.y*right.x};
  const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;let distance=.1;
  for(const x of [-.5,.5])for(const y of [-.5,.5])for(const z of [-.5,.5]){
    const point={x:size.x*x,y:size.y*y,z:size.z*z},depth=dot(direction,point);
    distance=Math.max(distance,Math.abs(dot(right,point))/horizontal+depth,Math.abs(dot(up,point))/vertical+depth);
  }
  return distance*1.12;
}
