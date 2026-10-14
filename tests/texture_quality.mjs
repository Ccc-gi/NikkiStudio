import assert from 'node:assert/strict';
import * as T from 'three';
import {applyTextureQuality,textureQualityForLevel} from '../frontend/texture_quality.js';
const levels=[2048,1024,512,256,128,64,32,16,8,4,2,1];
const make=()=>new T.CompressedTexture(levels.map(size=>({width:size,height:size,data:new Uint8Array(16)})),2048,2048);
for(const [level,size] of [['fine',2048],['standard',1024],['light',512]]){
  const texture=make(),first=texture.mipmaps.find(m=>m.width===size),last=texture.mipmaps.at(-1);
  applyTextureQuality(texture,textureQualityForLevel(level));
  assert.equal(texture.image.width,size);assert.equal(texture.image.height,size);
  assert.equal(texture.mipmaps[0],first);assert.equal(texture.mipmaps.at(-1),last);
  assert.equal(texture.mipmaps[0].data,first.data);
}
const small=new T.CompressedTexture([{width:256,height:128,data:new Uint8Array(16)}],256,128);
applyTextureQuality(small,'preview');assert.equal(small.image.width,256);
console.log('PASS: fine preserves full compressed texture; standard/light use existing mip levels and unchanged pixels');
