import assert from 'node:assert/strict';
import {sampleGarden,worldRoot,ROOT_SPACING} from '../frontend/garden_growth.js';
const palettes=[0,0,0];let flowers=0,tall=0,occupied=0,minHeight=Infinity,maxHeight=0,correlation=0,independent=0;
for(let ix=-160;ix<160;ix++)for(let iz=-160;iz<160;iz++){
  const root=worldRoot(ix,iz,1),shape=sampleGarden(root.x,root.z,root.ix,root.iz);
  const neighbor=sampleGarden(root.x+.2,root.z+.2,ix,iz),remote=sampleGarden(root.x+20,root.z+20,ix,iz);
  correlation+=Math.abs(shape.fertility-neighbor.fertility);independent+=Math.abs(shape.fertility-remote.fertility);
  if(shape.occupied){occupied++;tall+=Number(shape.tall);minHeight=Math.min(minHeight,shape.height);maxHeight=Math.max(maxHeight,shape.height);}
  if(shape.flowering){flowers++;palettes[shape.flowerVariant-4]++;}
}
assert.ok(occupied>30000&&occupied<85000,'Growth should leave sparse and lush areas');
assert.ok(correlation<independent*.2,'Fertility should vary in continuous patches');
assert.ok(tall/occupied>.01&&tall/occupied<.15,'Long grass is a minority');
assert.ok(minHeight<.22&&maxHeight>.5,'Tuft heights should show visible variation');
assert.ok(flowers>100&&flowers/occupied<.04,'Flowers should stay sparse');
assert.ok(palettes[0]>palettes[1]&&palettes[1]>palettes[2]&&palettes[2]>0,'Cream dominates; pink is occasional');
for(let x=-10;x<10;x++)for(let z=-10;z<10;z++){
  const coarse=worldRoot(x,z,8),fine=worldRoot(coarse.ix,coarse.iz,1);
  assert.equal(coarse.x,fine.x);assert.equal(coarse.z,fine.z);
  assert.deepEqual(sampleGarden(fine.x,fine.z,fine.ix,fine.iz),sampleGarden(fine.x,fine.z,fine.ix,fine.iz));
  assert.ok(Math.abs(fine.x/ROOT_SPACING-fine.ix)<1);
}
console.log(JSON.stringify({occupied,tall,flowers,palettes,minHeight,maxHeight}));
