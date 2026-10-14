import * as T from 'three';

// Approximate UE TwoSidedFoliage on the existing leaf cards. Preserve alpha/shadows
// and share the standard light loop so instancing and selection stay compatible.
export function applyFoliageShading(material){
  material.side=T.DoubleSide;
  material.roughness=1;
  material.alphaToCoverage=true;
  material.userData.foliage=true;
  material.onBeforeCompile=shader=>{
    shader.fragmentShader=shader.fragmentShader.replace('#include <lights_physical_pars_fragment>',`
      #include <lights_physical_pars_fragment>
      void RE_Foliage(const in IncidentLight light, const in vec3 position,
        const in vec3 normal, const in vec3 viewDir, const in vec3 clearcoatNormal,
        const in PhysicalMaterial material, inout ReflectedLight reflected) {
        RE_Direct_Physical(light,position,normal,viewDir,clearcoatNormal,material,reflected);
        float facing=dot(normal,light.direction);
        float wrap=clamp((facing+0.35)/1.35,0.0,1.0);
        float transmission=pow(max(-facing,0.0),2.0)*0.22;
        reflected.directDiffuse+=light.color*BRDF_Lambert(material.diffuseColor)
          *(wrap-max(facing,0.0)+transmission);
      }
      #undef RE_Direct
      #define RE_Direct RE_Foliage
    `).replace('#include <lights_physical_fragment>',`
      #include <lights_physical_fragment>
      material.specularColor*=0.3;
    `);
  };
  material.customProgramCacheKey=()=> 'nikki-foliage-v1';
  material.needsUpdate=true;
  return material;
}

export function preserveMaterialShader(original,clone){
  clone.onBeforeCompile=original.onBeforeCompile;
  clone.customProgramCacheKey=original.customProgramCacheKey;
  return clone;
}
