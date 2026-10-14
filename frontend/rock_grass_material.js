import * as T from 'three';

// Preview approximation of UE's layered rock material, not its virtual texture graph.
export function applyRockGrass(material,map){
  material.userData.topGrass=true;
  material.onBeforeCompile=shader=>{
    shader.uniforms.rockGrassMap={value:map};
    shader.vertexShader='varying vec3 grassPosition; varying vec3 grassNormal;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>
      vec4 grassVertex=vec4(transformed,1.0);
      #ifdef USE_INSTANCING
      grassVertex=instanceMatrix*grassVertex;
      #endif
      grassPosition=(modelMatrix*grassVertex).xyz;
      grassNormal=inverseTransformDirection(transformedNormal,viewMatrix);
    `);
    shader.fragmentShader='uniform sampler2D rockGrassMap; varying vec3 grassPosition; varying vec3 grassNormal;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
      vec3 grassColor=texture2D(rockGrassMap,grassPosition.xz/2.0).rgb;
      float grassSlope=smoothstep(0.45,0.85,normalize(grassNormal).y);
      diffuseColor.rgb=mix(diffuseColor.rgb,grassColor*diffuse,grassSlope*0.92);
    `);
  };
  material.customProgramCacheKey=()=> 'nikki-rock-grass-v1';
  material.needsUpdate=true;
}
