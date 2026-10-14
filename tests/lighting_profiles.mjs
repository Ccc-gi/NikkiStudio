import assert from 'node:assert/strict';
import * as T from 'three';
import {applyLegacyLighting,applyDaylightLighting,LEGACY_LIGHTING} from '../frontend/lighting_profiles.js';
import {sampleDaylight} from '../frontend/daylight_cycle.js';

const scene=new T.Scene(),sun=new T.DirectionalLight(),moon=new T.DirectionalLight();
const hemisphere=new T.HemisphereLight(),fill=new T.DirectionalLight(),renderer={};
const lighting={scene,sun,moon,hemisphere,fill,renderer};
// setHex round-trips through linear working space, so allow a unit of rounding.
const closeHex=(a,b)=>[16,8,0].every(s=>Math.abs((a>>s&255)-(b>>s&255))<=1);
const legacyState=()=>[scene.environmentIntensity,hemisphere.color.getHex(),hemisphere.groundColor.getHex(),hemisphere.intensity,sun.color.getHex(),sun.intensity,fill.intensity,sun.shadow.intensity,sun.shadow.normalBias,renderer.toneMappingExposure];

scene.fog=new T.FogExp2(0,0);
applyLegacyLighting(lighting,1.2);
const baseline=legacyState();

const noon=sampleDaylight(13);
applyDaylightLighting(noon,lighting,1.2);
assert.ok(sun.intensity>LEGACY_LIGHTING.sun&&hemisphere.intensity<LEGACY_LIGHTING.hemisphere);
assert.ok(sun.shadow.intensity>LEGACY_LIGHTING.shadow);
assert.equal(renderer.toneMappingExposure,noon.exposure*1.2);
assert.ok(closeHex(sun.color.getHex(),noon.sunColor),'the sun takes the sampled colour');
assert.ok(closeHex(hemisphere.color.getHex(),noon.skyColor));
assert.ok(closeHex(scene.fog.color.getHex(),noon.fogColor));
assert.equal(scene.fog.density,noon.fogDensity);
assert.equal(moon.intensity,0,'noon is not moonlit');

// Midnight hands the direct light over to the moon.
const night=sampleDaylight(1.5);
applyDaylightLighting(night,lighting,1);
assert.equal(sun.intensity,0,'the sun is off at midnight');
assert.ok(moon.intensity>0,'the moon takes over');
assert.ok(closeHex(moon.color.getHex(),night.moonColor));
assert.ok(closeHex(hemisphere.color.getHex(),night.skyColor));
assert.notEqual(hemisphere.color.getHex(),noon.skyColor,'night is not just a dimmer noon');

applyLegacyLighting(lighting,1.2);
assert.deepEqual(legacyState(),baseline);
console.log('PASS: daylight drives the fine level through a full day; legacy restores every value');
