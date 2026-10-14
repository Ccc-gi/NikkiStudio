// Time-of-day model for the fine render level.
//
// A full 24-hour cycle. The sun follows a real solar arc and keeps going below
// the horizon after it sets; a moon then takes over the direct light from the
// antipode, which is where a full moon actually is at sunset. Keyframe hours are
// cyclic — the list wraps through midnight — so the clock runs forward forever
// without a seam.
import * as T from 'three';

export const DAY_HOURS = 24;

// Latitude 45N at declination 25N: a midsummer day. Sunrise lands at 04:39 and
// sunset at 20:21, so the arc puts the sun at 69deg at noon and 18deg below the
// horizon at solar midnight.
const LATITUDE = T.MathUtils.degToRad(45), DECLINATION = T.MathUtils.degToRad(25);
const SIN_PRODUCT = Math.sin(LATITUDE) * Math.sin(DECLINATION);
const COS_PRODUCT = Math.cos(LATITUDE) * Math.cos(DECLINATION);
const SOLAR_NOON = 12.5;
// Scene azimuth that solar south maps onto; matches the hand-tuned default.
const NOON_AZIMUTH = 75;

// Seven authored looks across the day, evenly placed around the two twilights.
// `sun` and `moon` are separate beams so the hand-off at sunset never flips a
// single light 180 degrees. Both beams stay close to the blackbody locus, which
// is what keeps the manual warmth slider from shifting them when it is grabbed.
const KEYFRAMES = [
  { id: 'night', at: 1.5, sunColor: 0xff9a5e, sun: 0, moonColor: 0xdce6f8, moon: 1.4,
    sky: 0x7a9ac8, ground: 0x444b5e, ambient: 1.05, fill: .26,
    fog: 0x1c2a44, fogDensity: .00020, exposure: 1, environment: .55 },
  { id: 'dawn', at: 4.25, sunColor: 0xff9a5e, sun: 0, moonColor: 0xdce6f8, moon: .7,
    sky: 0x6a88b4, ground: 0x3a4152, ambient: 1.05, fill: .24,
    fog: 0x2a3a52, fogDensity: .00026, exposure: .98, environment: .48 },
  { id: 'morning', at: 8, sunColor: 0xffdcb4, sun: 2.6, moonColor: 0xdce6f8, moon: 0,
    sky: 0xa9c9e8, ground: 0xb6ab93, ambient: .86, fill: .22,
    fog: 0xdbe3ec, fogDensity: .00026, exposure: .99, environment: .72 },
  { id: 'noon', at: 13, sunColor: 0xfff0df, sun: 3.2, moonColor: 0xdce6f8, moon: 0,
    sky: 0xb8d2ec, ground: 0xb4b69a, ambient: .70, fill: .14,
    fog: 0xe8e6d8, fogDensity: .00015, exposure: 1, environment: .65 },
  { id: 'golden', at: 18, sunColor: 0xffb168, sun: 2.7, moonColor: 0xdce6f8, moon: 0,
    sky: 0xe9b79a, ground: 0xa38b72, ambient: .64, fill: .18,
    fog: 0xf0cda6, fogDensity: .00027, exposure: .96, environment: .62 },
  // The sun is already below the horizon here, so the afterglow is carried by
  // the hemisphere light instead of by a beam shining up from underground.
  { id: 'dusk', at: 20.5, sunColor: 0xff8a52, sun: 0, moonColor: 0xdce6f8, moon: .5,
    sky: 0x7c7698, ground: 0x453e52, ambient: 1.05, fill: .2,
    fog: 0xa88a9c, fogDensity: .00030, exposure: .97, environment: .5 },
  { id: 'night', at: 22.5, sunColor: 0xff9a5e, sun: 0, moonColor: 0xdce6f8, moon: 1.25,
    sky: 0x7292c0, ground: 0x40475a, ambient: 1.05, fill: .24,
    fog: 0x1a2740, fogDensity: .00020, exposure: 1, environment: .52 }
];

export const KEYFRAME_HOURS = Object.freeze(KEYFRAMES.map(frame => frame.at));
export const KEYFRAME_IDS = Object.freeze(KEYFRAMES.map(frame => frame.id));

const colorA = new T.Color(), colorB = new T.Color();
const mixHex = (a, b, k) => colorA.setHex(a).lerp(colorB.setHex(b), k).getHex();
const mix = (a, b, k) => a + (b - a) * k;
const smoothstep = x => x * x * (3 - 2 * x);

// Hours are cyclic, so every input lands somewhere in the day.
export function wrapHours(hours) {
  const h = Number(hours);
  if (!Number.isFinite(h)) return 0;
  return ((h % DAY_HOURS) + DAY_HOURS) % DAY_HOURS;
}

// Hour angle in degrees: 0 at solar noon, 15deg per hour either side.
const hourAngle = hours => (hours - SOLAR_NOON) * 15;

export function solarElevation(hours) {
  const H = T.MathUtils.degToRad(hourAngle(hours));
  return T.MathUtils.radToDeg(Math.asin(SIN_PRODUCT + COS_PRODUCT * Math.cos(H)));
}

export function solarAzimuth(hours) {
  const H = T.MathUtils.degToRad(hourAngle(hours));
  const fromSouth = T.MathUtils.radToDeg(Math.atan2(Math.sin(H),
    Math.cos(H) * Math.sin(LATITUDE) - Math.tan(DECLINATION) * Math.cos(LATITUDE)));
  return ((NOON_AZIMUTH + fromSouth) % 360 + 360) % 360;
}

// The moon sits opposite the sun, so it rises as the sun sets.
export const lunarElevation = hours => -solarElevation(hours);
export const lunarAzimuth = hours => (solarAzimuth(hours) + 180) % 360;

// Segment [at_i, at_i+1) with the last one reaching back around to the first.
function bracket(hours) {
  const count = KEYFRAMES.length;
  for (let i = 0; i < count; i++) {
    const a = KEYFRAMES[i].at;
    const b = i + 1 < count ? KEYFRAMES[i + 1].at : KEYFRAMES[0].at + DAY_HOURS;
    const h = hours < a ? hours + DAY_HOURS : hours;
    if (h >= a && h < b) return { a: i, b: (i + 1) % count, k: smoothstep((h - a) / (b - a)) };
  }
  return { a: 0, b: 1, k: 0 };
}

// Every field the fine level applies, plus the sky-dome blend weights. The
// weights always sum to 1, so the dome never needs renormalising.
export function sampleDaylight(hours) {
  const h = wrapHours(hours);
  const { a, b, k } = bracket(h);
  const from = KEYFRAMES[a], to = KEYFRAMES[b];
  const count = KEYFRAMES.length;
  const skyWeight = new Array(count);
  for (let i = 0; i < count; i++) skyWeight[i] = mix(i === a ? 1 : 0, i === b ? 1 : 0, k);

  const sunElevation = solarElevation(h), sunAzimuth = solarAzimuth(h);
  const moonElevation = -sunElevation, moonAzimuth = (sunAzimuth + 180) % 360;
  const night = sunElevation < 0;
  return {
    hours: h,
    skyWeight,
    sunElevation, sunAzimuth,
    moonElevation, moonAzimuth,
    sunColor: mixHex(from.sunColor, to.sunColor, k),
    sunIntensity: mix(from.sun, to.sun, k),
    moonColor: mixHex(from.moonColor, to.moonColor, k),
    moonIntensity: mix(from.moon, to.moon, k),
    // Whichever beam is currently the direct light; manual controls edit this.
    lightElevation: night ? moonElevation : sunElevation,
    lightAzimuth: night ? moonAzimuth : sunAzimuth,
    lightColor: night ? mixHex(from.moonColor, to.moonColor, k) : mixHex(from.sunColor, to.sunColor, k),
    lightIntensity: night ? mix(from.moon, to.moon, k) : mix(from.sun, to.sun, k),
    skyColor: mixHex(from.sky, to.sky, k),
    groundColor: mixHex(from.ground, to.ground, k),
    hemisphereIntensity: mix(from.ambient, to.ambient, k),
    fillIntensity: mix(from.fill, to.fill, k),
    fogColor: mixHex(from.fog, to.fog, k),
    fogDensity: mix(from.fogDensity, to.fogDensity, k),
    exposure: mix(from.exposure, to.exposure, k),
    environmentIntensity: mix(from.environment, to.environment, k)
  };
}
