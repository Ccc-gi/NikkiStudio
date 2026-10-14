import assert from 'node:assert/strict';
import * as T from 'three';
import {applyLightingProfile,LEGACY_LIGHTING} from '../frontend/lighting_profiles.js';
const scene=new T.Scene(),sun=new T.DirectionalLight(),hemisphere=new T.HemisphereLight(),fill=new T.DirectionalLight(),renderer={};
const lighting={scene,sun,hemisphere,fill,renderer};
applyLightingProfile('standard',lighting,1.2);
const baseline=[scene.environmentIntensity,hemisphere.color.getHex(),hemisphere.groundColor.getHex(),hemisphere.intensity,sun.color.getHex(),sun.intensity,fill.intensity,sun.shadow.intensity,sun.shadow.normalBias,renderer.toneMappingExposure];
applyLightingProfile('fine',lighting,1.2);
assert.ok(sun.intensity>LEGACY_LIGHTING.sun&&hemisphere.intensity<LEGACY_LIGHTING.hemisphere);
assert.ok(sun.shadow.intensity>LEGACY_LIGHTING.shadow);
assert.equal(renderer.toneMappingExposure,1.2);
for(const level of ['standard','light']){
  applyLightingProfile(level,lighting,1.2);
  assert.deepEqual([scene.environmentIntensity,hemisphere.color.getHex(),hemisphere.groundColor.getHex(),hemisphere.intensity,sun.color.getHex(),sun.intensity,fill.intensity,sun.shadow.intensity,sun.shadow.normalBias,renderer.toneMappingExposure],baseline);
}
console.log('PASS: directional fine daylight; standard/light restore every legacy lighting value and brightness');
