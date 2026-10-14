// Presentation presets. The legacy light/standard look is deliberately exact;
// the fine level is driven by the daylight clock in daylight_cycle.js, so only
// its shadow response is fixed here.
export const LEGACY_LIGHTING=Object.freeze({environment:1.15,hemisphere:2.15,
  sky:0xeff5ff,ground:0xe4d3ae,sun:1.5,sunColor:0xffedcf,fill:.55,
  shadow:.48,normalBias:.012,exposure:1.1});
export const DAYLIGHT_SHADOW=Object.freeze({intensity:.85,normalBias:.009});

export function applyLegacyLighting({scene,sun,hemisphere,fill,renderer},brightness=1){
  const p=LEGACY_LIGHTING;
  scene.environmentIntensity=p.environment;
  hemisphere.color.set(p.sky);hemisphere.groundColor.set(p.ground);hemisphere.intensity=p.hemisphere;
  sun.color.set(p.sunColor);sun.intensity=p.sun;
  fill.intensity=p.fill;sun.shadow.intensity=p.shadow;sun.shadow.normalBias=p.normalBias;
  renderer.toneMappingExposure=p.exposure*brightness;
  return p;
}

// Exactly one directional light casts at a time, so `numDirLightShadows` stays
// put and three never has to recompile the scene's materials. `fade` drops the
// shadow to nothing where the two beams balance, which is the moment the caster
// is handed over — the swap happens while there is no shadow to see.
export function applyDaylightShadow(sun,moon,fade=1){
  const intensity=DAYLIGHT_SHADOW.intensity*fade;
  sun.shadow.intensity=intensity;moon.shadow.intensity=intensity;
  sun.shadow.normalBias=DAYLIGHT_SHADOW.normalBias;moon.shadow.normalBias=DAYLIGHT_SHADOW.normalBias;
}

// `daylight` is a sampleDaylight() state, already carrying every colour and
// intensity the fine level needs. Sun and moon are separate beams so the
// hand-off at sunset never flips one light 180 degrees.
export function applyDaylightLighting(daylight,{scene,sun,moon,hemisphere,fill,renderer},brightness=1){
  scene.environmentIntensity=daylight.environmentIntensity;
  hemisphere.color.setHex(daylight.skyColor);hemisphere.groundColor.setHex(daylight.groundColor);
  hemisphere.intensity=daylight.hemisphereIntensity;
  sun.color.setHex(daylight.sunColor);sun.intensity=daylight.sunIntensity;
  moon.color.setHex(daylight.moonColor);moon.intensity=daylight.moonIntensity;
  fill.intensity=daylight.fillIntensity;
  if(scene.fog){scene.fog.color.setHex(daylight.fogColor);scene.fog.density=daylight.fogDensity;}
  applyDaylightShadow(sun,moon);
  renderer.toneMappingExposure=daylight.exposure*brightness;
  return daylight;
}
