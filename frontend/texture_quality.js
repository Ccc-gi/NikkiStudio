export function textureQualityForLevel(level){return level==='fine'?'original':level==='light'?'light':'preview';}

// Use existing compressed mip levels without resampling game pixels or exports.
export function applyTextureQuality(texture,quality){
  if(!texture.isCompressedTexture||quality==='original')return texture;
  const maxSize=quality==='light'?512:1024;
  const index=texture.mipmaps.findIndex(m=>m.width<=maxSize&&m.height<=maxSize);
  if(index>0){texture.mipmaps=texture.mipmaps.slice(index);texture.image.width=texture.mipmaps[0].width;texture.image.height=texture.mipmaps[0].height;}
  return texture;
}
