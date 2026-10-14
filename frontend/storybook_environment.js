import * as T from 'three';

// Original procedural scenery: no downloaded artwork or game-resource dependency.
//
// Every daylight palette shares one seed, so clouds and hills land in identical
// places and only their colour differs. The sky dome can then cross-fade
// between them without any shape sliding around.

export const SKY_PALETTES = Object.freeze({
  night: Object.freeze({
    zenith: 0x05080f, upper: 0x0a1220, mid: 0x122036, horizon: 0x1d2f4a,
    groundNear: 0x0c1320, groundFar: 0x070a12,
    cloudLit: 0x33445e, cloudShade: 0x161f2e,
    hills: Object.freeze([0x1a2536, 0x16202f, 0x121a27, 0x0d141e]),
    glow: 0xa8c4e8, glowStrength: .3, glowBody: 'moon', stars: 1
  }),
  dawn: Object.freeze({
    zenith: 0x080f1c, upper: 0x101c34, mid: 0x203650, horizon: 0x3f5c7e,
    groundNear: 0x141c2a, groundFar: 0x0c1119,
    cloudLit: 0x4a6284, cloudShade: 0x1f2c40,
    hills: Object.freeze([0x2b3a52, 0x243146, 0x1d2738, 0x161e2c]),
    glow: 0xd9a68c, glowStrength: .7, glowBody: 'sun', stars: .5
  }),
  morning: Object.freeze({
    zenith: 0x4a7fb5, upper: 0x84b3dc, mid: 0xc2d9ea, horizon: 0xf2e6d0,
    groundNear: 0x93a878, groundFar: 0x7d9165,
    cloudLit: 0xfff4e6, cloudShade: 0xb0c1d4,
    hills: Object.freeze([0xc3cee0, 0xaec0c8, 0x9bb094, 0x8ba47a]),
    glow: 0xffd9a8, glowStrength: .5, glowBody: 'sun', stars: 0
  }),
  noon: Object.freeze({
    zenith: 0x5d9bd4, upper: 0x99cbe9, mid: 0xd9eaf0, horizon: 0xc4d5b7,
    groundNear: 0x91aa78, groundFar: 0x829965,
    cloudLit: 0xfffbec, cloudShade: 0xcfddec,
    hills: Object.freeze([0xbccdd9, 0xa6bfd0, 0xa1bbae, 0x92ae8e]),
    glow: 0xfff6df, glowStrength: .18, glowBody: 'sun', stars: 0
  }),
  golden: Object.freeze({
    zenith: 0x2c5686, upper: 0x6f93bd, mid: 0xd0a884, horizon: 0xf6cf9c,
    groundNear: 0x8a8f66, groundFar: 0x6f7a58,
    cloudLit: 0xffd9a8, cloudShade: 0x9c8fa0,
    hills: Object.freeze([0xd8b494, 0xc0a086, 0xa89480, 0x94907a]),
    glow: 0xffa855, glowStrength: 1, glowBody: 'sun', stars: 0
  }),
  dusk: Object.freeze({
    zenith: 0x16294e, upper: 0x33456f, mid: 0x7a6a8c, horizon: 0xd9885f,
    groundNear: 0x3c3a52, groundFar: 0x222838,
    cloudLit: 0xc98f7e, cloudShade: 0x4a4470,
    hills: Object.freeze([0x524c72, 0x413d5c, 0x302f48, 0x232738]),
    glow: 0xff9058, glowStrength: .85, glowBody: 'sun', stars: .18
  })
});

const css = hex => '#' + hex.toString(16).padStart(6, '0');
const rgba = (hex, a) => `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${a})`;

// A soft round puff baked once, so clouds are drawn with drawImage instead of
// per-ellipse shadowBlur — the blur radius is many times cheaper this way.
function puffSprite(color, size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const c = canvas.getContext('2d'), r = size / 2;
  const g = c.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, rgba(color, 1));
  g.addColorStop(.55, rgba(color, .96));
  g.addColorStop(.82, rgba(color, .5));
  g.addColorStop(1, rgba(color, 0));
  c.fillStyle = g; c.fillRect(0, 0, size, size);
  return canvas;
}

// Equirect pixel for a direction, matching three's equirectUv.
function equirectPoint(azimuth, elevation, w, h) {
  const a = T.MathUtils.degToRad(azimuth), e = T.MathUtils.degToRad(elevation);
  const dirZ = Math.cos(a) * Math.cos(e), dirY = Math.sin(e);
  const u = Math.atan2(dirZ, Math.sin(a) * Math.cos(e)) / (2 * Math.PI) + .5;
  const v = Math.asin(Math.max(-1, Math.min(1, dirY))) / Math.PI + .5;
  return [u * w, (1 - v) * h];
}

export function createStorybookSky({ palette = SKY_PALETTES.noon, glow }) {
  const p = palette;
  const canvas = document.createElement('canvas');
  canvas.width = 2048; canvas.height = 1024;
  const c = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  let seed = 3871;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  const gradient = c.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, css(p.zenith));
  gradient.addColorStop(.24, css(p.upper));
  gradient.addColorStop(.44, css(p.mid));
  gradient.addColorStop(.5, css(p.horizon));
  gradient.addColorStop(.56, css(p.groundNear));
  gradient.addColorStop(.78, css(p.groundNear));
  gradient.addColorStop(1, css(p.groundFar));
  c.fillStyle = gradient; c.fillRect(0, 0, w, h);

  // Stars sit lowest, under the glow and the clouds, and are scattered by
  // direction rather than by pixel so the density stays even on the sphere.
  if (p.stars > 0) {
    const count = Math.round(560 * p.stars);
    for (let i = 0; i < count; i++) {
      const y = .08 + random() * .88, phi = random() * Math.PI * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const u = Math.atan2(Math.sin(phi) * r, Math.cos(phi) * r) / (2 * Math.PI) + .5;
      const v = Math.asin(y) / Math.PI + .5;
      const magnitude = Math.pow(random(), 2.4);
      const size = .7 + magnitude * 2.2;
      const tint = random();
      const color = tint < .12 ? 0xbcd2ff : tint > .9 ? 0xffdcc0 : 0xffffff;
      c.fillStyle = rgba(color, (.2 + magnitude * .8) * p.stars);
      c.fillRect(u * w, (1 - v) * h, size, size);
    }
  }

  // Sun or moon glare, behind the clouds; additive so it reads as light, not paint.
  if (p.glowStrength > 0 && glow) {
    const [gx, gy] = equirectPoint(glow.azimuth, glow.elevation, w, h);
    const radius = w * (p.glowBody === 'moon' ? .10 : .17);
    c.globalCompositeOperation = 'lighter';
    for (const wrap of [-w, 0, w]) {
      const g = c.createRadialGradient(gx + wrap, gy, 0, gx + wrap, gy, radius);
      g.addColorStop(0, rgba(p.glow, .8 * p.glowStrength));
      g.addColorStop(.28, rgba(p.glow, .26 * p.glowStrength));
      g.addColorStop(1, rgba(p.glow, 0));
      c.fillStyle = g;
      c.beginPath(); c.arc(gx + wrap, gy, radius, 0, Math.PI * 2); c.fill();
    }
    c.globalCompositeOperation = 'source-over';
  }

  // Puffy clouds wrap across the panorama seam. Each is a run of puffs sitting on
  // a shared baseline, so the underside reads flat while the crowns stay domed.
  const lit = puffSprite(p.cloudLit), shade = puffSprite(p.cloudShade);
  for (let i = 0; i < 58; i++) {
    const cx = random() * w, cy = h * (.08 + random() * .38);
    const scale = .5 + random() * .85;
    const puffW = 33 * scale, puffH = 17 * scale;
    const count = 5 + Math.floor(random() * 5), half = (count - 1) / 2;
    const spacing = puffW * .62;
    for (const wrap of [-w, 0, w]) {
      const crown = j => cy - Math.cos((j - half) / Math.max(half, 1) * Math.PI / 2) * puffH * .7;
      // Shaded body first, then a slightly smaller lit crown above it: that is
      // what gives the underside its shadow without a per-puff blur.
      c.globalAlpha = .58;
      for (let j = 0; j < count; j++) {
        const w2 = puffW * (1 - .42 * Math.abs(j - half) / Math.max(half, 1));
        c.drawImage(shade, cx + wrap + (j - half) * spacing - w2, crown(j) - puffH, w2 * 2, puffH * 2);
      }
      c.globalAlpha = .9;
      for (let j = 0; j < count; j++) {
        const w2 = puffW * (1 - .46 * Math.abs(j - half) / Math.max(half, 1)) * .92;
        c.drawImage(lit, cx + wrap + (j - half) * spacing - w2, crown(j) - puffH * 1.42, w2 * 2, puffH * 1.85);
      }
    }
  }
  c.globalAlpha = 1;

  // Horizon haze sits between the far hills and the sky, so it deepens the
  // distance instead of washing the hills out.
  const haze = c.createLinearGradient(0, h * .415, 0, h * .5);
  haze.addColorStop(0, rgba(p.mid, 0));
  haze.addColorStop(.55, rgba(p.horizon, .38));
  haze.addColorStop(1, rgba(p.horizon, .16));
  c.fillStyle = haze; c.fillRect(0, h * .415, w, h * .09);

  // Distant hills: periodic functions keep the 360-degree seam continuous, and
  // each layer is drawn far-to-near so atmospheric perspective stays ordered.
  const layers = [[.497, .048], [.523, .038], [.548, .028], [.572, .02]];
  for (let i = 0; i < layers.length; i++) {
    const [base, amplitude] = layers[i], phase = .7 + i * 1.3;
    c.fillStyle = css(p.hills[i]); c.beginPath(); c.moveTo(0, h);
    for (let x = 0; x <= w; x += 4) {
      const t = x / w * Math.PI * 2;
      const y = h * (base - amplitude * (.5 + .3 * Math.sin(t * 5 + phase) + .2 * Math.sin(t * 9 - phase)));
      c.lineTo(x, y);
    }
    c.lineTo(w, h); c.closePath(); c.fill();
  }

  const texture = new T.CanvasTexture(canvas);
  texture.mapping = T.EquirectangularReflectionMapping;
  // The dome shader decodes sRGB itself, so the sampler must hand it raw bytes.
  // The dome never minifies, so the mip chain would only cost memory and time.
  texture.colorSpace = T.NoColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = T.LinearFilter;
  return texture;
}

// The moon is drawn as one billboard so it stays where the moon actually is,
// instead of being baked into a sky that is only sampled at keyframe positions.
export function createMoonTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const c = canvas.getContext('2d'), r = size / 2;

  const halo = c.createRadialGradient(r, r, 0, r, r, r);
  halo.addColorStop(0, 'rgba(226,238,255,.85)');
  halo.addColorStop(.18, 'rgba(198,218,246,.32)');
  halo.addColorStop(.45, 'rgba(170,198,236,.10)');
  halo.addColorStop(1, 'rgba(150,180,225,0)');
  c.fillStyle = halo; c.fillRect(0, 0, size, size);

  // A few darker maria so the disc does not read as a flat blob.
  let seed = 7331;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const disc = c.createRadialGradient(r, r, 0, r, r, size * .27);
  disc.addColorStop(0, 'rgba(255,253,246,1)');
  disc.addColorStop(.82, 'rgba(244,246,252,.98)');
  disc.addColorStop(1, 'rgba(232,238,250,0)');
  c.fillStyle = disc;
  c.beginPath(); c.arc(r, r, size * .27, 0, Math.PI * 2); c.fill();
  for (let i = 0; i < 7; i++) {
    const angle = random() * Math.PI * 2, distance = random() * size * .17;
    c.fillStyle = `rgba(210,220,238,${.18 + random() * .2})`;
    c.beginPath();
    c.arc(r + Math.cos(angle) * distance, r + Math.sin(angle) * distance,
      size * (.03 + random() * .05), 0, Math.PI * 2);
    c.fill();
  }

  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.generateMipmaps = false;
  return texture;
}

export function createMeadowTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const c = canvas.getContext('2d'); c.fillStyle = '#8c9e64'; c.fillRect(0, 0, 256, 256);
  let seed = 918; const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 14000; i++) {
    const shade = 80 + Math.floor(random() * 40); c.fillStyle = `rgba(${shade + 26},${shade + 43},${shade - 6},.16)`;
    c.fillRect(random() * 256, random() * 256, 1 + random() * 3, 1 + random() * 4);
  }
  const texture = new T.CanvasTexture(canvas); texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.colorSpace = T.SRGBColorSpace; texture.anisotropy = 4; return texture;
}
