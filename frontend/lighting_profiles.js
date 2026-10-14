// Presentation presets; legacy light/standard settings are deliberately exact.
export const LEGACY_LIGHTING=Object.freeze({environment:1.15,hemisphere:2.15,
  sky:0xeff5ff,ground:0xe4d3ae,sun:1.5,sunColor:0xffedcf,fill:.55,
  shadow:.48,normalBias:.012,exposure:1.1});
export const DAYLIGHT_LIGHTING=Object.freeze({environment:.65,hemisphere:.70,
  sky:0xb8d2ec,ground:0xb4b69a,sun:3.2,sunColor:0xfff0df,fill:.14,
  shadow:.85,normalBias:.009,exposure:1.0});

export function applyLightingProfile(level,{scene,sun,hemisphere,fill,renderer},brightness=1){
  const profile=level==='fine'?DAYLIGHT_LIGHTING:LEGACY_LIGHTING;
  scene.environmentIntensity=profile.environment;
  hemisphere.color.set(profile.sky);hemisphere.groundColor.set(profile.ground);hemisphere.intensity=profile.hemisphere;
  sun.color.set(profile.sunColor);sun.intensity=profile.sun;
  fill.intensity=profile.fill;sun.shadow.intensity=profile.shadow;sun.shadow.normalBias=profile.normalBias;
  renderer.toneMappingExposure=profile.exposure*brightness;
  return profile;
}
