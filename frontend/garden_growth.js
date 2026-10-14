// Original deterministic garden generator. No game data or downloaded art.
// Root positions are anchored to world cells, so orbiting does not reshuffle plants.
export const ROOT_SPACING=.32;
export const ATLAS_COLUMNS=8;
export function growthRandom(x,z,salt=0){
  let n=Math.imul(x,374761393)^Math.imul(z,668265263)^Math.imul(salt,1274126177);
  n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967296;
}
export function meadowNoise(x,z,salt){
  const ix=Math.floor(x),iz=Math.floor(z);let fx=x-ix,fz=z-iz;
  fx=fx*fx*(3-2*fx);fz=fz*fz*(3-2*fz);
  const a=growthRandom(ix,iz,salt),b=growthRandom(ix+1,iz,salt);
  const c=growthRandom(ix,iz+1,salt),d=growthRandom(ix+1,iz+1,salt);
  return (a+(b-a)*fx)*(1-fz)+(c+(d-c)*fx)*fz;
}
export function sampleGarden(x,z,ix,iz){
  const fertility=meadowNoise(x/7,z/7,17)*.65+meadowNoise(x/2.1,z/2.1,19)*.35;
  const shelter=meadowNoise(x/4.5,z/4.5,23);
  const flowerPocket=meadowNoise(x/3.2,z/3.2,29);
  const density=.32+fertility*.63;
  const occupied=growthRandom(ix,iz,6)<density;
  // Longer grass forms small sheltered patches, with individual height variation.
  const tall=shelter>.62&&growthRandom(ix,iz,7)<.28;
  const grassVariant=tall?2:[0,1,3][Math.floor(growthRandom(ix,iz,8)*3)];
  const height=tall?.38+growthRandom(ix,iz,9)*.20:.14+fertility*.12+growthRandom(ix,iz,9)*.13;
  const width=tall?.26+growthRandom(ix,iz,10)*.13:.32+growthRandom(ix,iz,10)*.22;
  const flowering=occupied&&flowerPocket>.62&&fertility>.35&&growthRandom(ix,iz,11)<.075;
  const palette=growthRandom(ix,iz,12);
  const flowerVariant=palette<.70?4:palette<.95?5:6;
  const bendDirection=(meadowNoise(x/9,z/9,31)*2-1)*Math.PI+growthRandom(ix,iz,13)*.7;
  const bend=tall?.38+growthRandom(ix,iz,14)*.28:.08+growthRandom(ix,iz,14)*.25;
  return {occupied,fertility,grassVariant,height,width,tall,flowering,flowerVariant,
    bendX:Math.cos(bendDirection)*bend,bendZ:Math.sin(bendDirection)*bend,
    flowerHeight:.16+growthRandom(ix,iz,15)*.15,flowerWidth:.16+growthRandom(ix,iz,16)*.08};
}

// A coarse LOD chooses one of its existing fine roots instead of moving roots.
export function worldRoot(cellX,cellZ,stride){
  const ix=cellX*stride+Math.floor(growthRandom(cellX,cellZ,40)*stride);
  const iz=cellZ*stride+Math.floor(growthRandom(cellX,cellZ,41)*stride);
  return {ix,iz,x:(ix+.12+growthRandom(ix,iz)*.76)*ROOT_SPACING,
    z:(iz+.12+growthRandom(ix,iz,1)*.76)*ROOT_SPACING};
}
