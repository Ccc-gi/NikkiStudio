import * as T from 'three';
import {SKY_PALETTES, createStorybookSky, createMoonTexture} from './storybook_environment.js';
import {KEYFRAME_HOURS, KEYFRAME_IDS, solarAzimuth, solarElevation, lunarAzimuth, lunarElevation} from './daylight_cycle.js';

// The sky is baked once per daylight keyframe and blended on the GPU, so
// scrubbing the clock costs a handful of texture reads per pixel and nothing
// else. Re-rendering the painted canvas per frame would cost hundreds of
// milliseconds.
const SKY_COUNT = KEYFRAME_HOURS.length;
// Reflected light lags the direct sun by design: a PMREM pass is far more
// expensive than the per-frame sun update, and the difference is only visible
// as a short delay on glossy surfaces while the clock is being dragged.
const ENVIRONMENT_REFRESH_MS = 400;
// The moon fades in as it clears the horizon, so it never pops at moonrise.
const MOON_FADE_DEGREES = 12;

const VERTEX_SHADER = `
varying vec3 vDirection;
void main(){
  vDirection = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// The canvases are uploaded without a colour space, so this decodes sRGB itself
// and hands every other stage the linear value it expects — including the PMREM
// pass, where three disables tone mapping and asks for linear output.
//
// The loop is unrolled rather than written as a for-loop: ANGLE on D3D11 rejects
// even a loop-index sampler array access with "array index for samplers must be
// constant integral expressions". The weight test is uniform across the draw, so
// only the two live skies are ever fetched.
const SKY_SAMPLES = Array.from({ length: SKY_COUNT }, (_, i) =>
  `  w = uWeight[${i}];\n  if(w > 0.0005) sky += skyToLinear(texture2D(uSky[${i}], uv).rgb) * w;`).join('\n');

const FRAGMENT_SHADER = `
uniform sampler2D uSky[${SKY_COUNT}];
uniform float uWeight[${SKY_COUNT}];
varying vec3 vDirection;

const float SKY_PI = 3.141592653589793;
const float SKY_TWO_PI = 6.283185307179586;

vec3 skyToLinear(vec3 c){
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

void main(){
  vec3 d = normalize(vDirection);
  vec2 uv = vec2(atan(d.z, d.x) / SKY_TWO_PI + 0.5, asin(clamp(d.y, -1.0, 1.0)) / SKY_PI + 0.5);
  vec3 sky = vec3(0.0);
  float w;
${SKY_SAMPLES}
  gl_FragColor = vec4(sky, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Direction for a body at a given azimuth and elevation, matching the scene's
// sun convention.
const bodyScratch = new T.Vector3();
function bodyDirection(azimuth, elevation) {
  const a = T.MathUtils.degToRad(azimuth), e = T.MathUtils.degToRad(elevation);
  return bodyScratch.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
}

export function installSkyDome({renderer, scene}) {
  const textures = KEYFRAME_HOURS.map((hours, index) => {
    const palette = SKY_PALETTES[KEYFRAME_IDS[index]];
    // A night keyframe glows around the moon, a day one around the sun. At
    // twilight the sun is below the horizon; the glow is lifted onto it so the
    // afterglow lands as a band on the skyline instead of behind the hills.
    const glowElevation = palette.glowBody === 'moon' ? lunarElevation(hours) : solarElevation(hours);
    const texture = createStorybookSky({
      palette,
      glow: {
        azimuth: palette.glowBody === 'moon' ? lunarAzimuth(hours) : solarAzimuth(hours),
        elevation: Math.max(0, glowElevation)
      }
    });
    // Wrap horizontally so the panorama seam has no hard edge.
    texture.wrapS = T.RepeatWrapping;
    texture.wrapT = T.ClampToEdgeWrapping;
    return texture;
  });

  const uniforms = {
    uSky: {value: textures},
    uWeight: {value: new Float32Array(SKY_COUNT)}
  };
  const material = new T.ShaderMaterial({
    name: 'StorybookSkyDome',
    uniforms, vertexShader: VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER,
    side: T.BackSide, depthTest: false, depthWrite: false, fog: false
  });
  const geometry = new T.SphereGeometry(1, 32, 16);
  const dome = new T.Mesh(geometry, material);
  // Radius 1 centred on the camera: it always encloses the frustum, so it needs
  // no culling and can never be clipped by the far plane.
  dome.frustumCulled = false;
  dome.renderOrder = -1000;
  scene.add(dome);

  // One billboard rather than a baked disc: a disc painted into a keyframe would
  // cross-fade between two positions as the blend moves, showing two moons.
  const moon = new T.Sprite(new T.SpriteMaterial({
    map: createMoonTexture(), transparent: true, depthTest: false, depthWrite: false,
    fog: false, opacity: 0
  }));
  moon.frustumCulled = false;
  moon.renderOrder = -999;
  moon.scale.setScalar(.07);
  scene.add(moon);

  // A second mesh shares geometry and uniforms so the PMREM pass sees the same
  // sky without the rest of the scene.
  const environmentScene = new T.Scene();
  environmentScene.add(new T.Mesh(geometry, material));

  const pmrem = new T.PMREMGenerator(renderer);
  let environment = null, lastRefresh = -Infinity;
  let moonAzimuth = 0, moonElevation = 0;

  function refreshEnvironment(now, force) {
    if (!force && now - lastRefresh < ENVIRONMENT_REFRESH_MS) return false;
    lastRefresh = now;
    // fromScene allocates a fresh target every call, so the previous one has to
    // be released or the sky leaks a render target a few times a second.
    const next = pmrem.fromScene(environmentScene, 0, .1, 20);
    scene.environment = next.texture;
    environment?.dispose();
    environment = next;
    return true;
  }

  return {
    // Keeps the dome and the moon centred on the camera; the moon rides at 0.9
    // of the dome radius, inside it but far enough to read as sky.
    sync(camera) {
      dome.position.copy(camera.position);
      moon.position.copy(camera.position).addScaledVector(bodyDirection(moonAzimuth, moonElevation), .9);
    },
    setWeight(weights) {
      const target = uniforms.uWeight.value;
      for (let i = 0; i < SKY_COUNT; i++) target[i] = weights[i] ?? 0;
    },
    setMoon(state) {
      moonAzimuth = state.moonAzimuth;
      moonElevation = state.moonElevation;
      moon.material.opacity = T.MathUtils.clamp(state.moonElevation / MOON_FADE_DEGREES, 0, 1);
    },
    refreshEnvironment,
    textures
  };
}
