import assert from 'node:assert/strict';
import {DAY_HOURS,KEYFRAME_HOURS,KEYFRAME_IDS,wrapHours,sampleDaylight,solarElevation,lunarElevation} from '../frontend/daylight_cycle.js';

// The dome blends seven baked skies by these weights, so they must never drift.
for(let h=0;h<DAY_HOURS;h+=.05){
  const s=sampleDaylight(h);
  assert.equal(s.skyWeight.length,KEYFRAME_HOURS.length);
  const sum=s.skyWeight.reduce((a,b)=>a+b,0);
  assert.ok(Math.abs(sum-1)<1e-9,`sky weights must sum to 1 (${h}h -> ${sum})`);
  assert.ok(s.skyWeight.every(w=>w>=-1e-9&&w<=1+1e-9),`weights stay in range at ${h}h`);
  assert.ok(s.skyWeight.filter(w=>w>1e-9).length<=2,`at most two skies are live at ${h}h`);
  assert.ok(s.hemisphereIntensity>0&&s.fillIntensity>0,`ambient stays on at ${h}h`);
  assert.ok(s.lightElevation>=0,`the active light never sits below the horizon (${h}h)`);
}

// Deep night is moonlit with no sun; noon is the reverse.
assert.equal(sampleDaylight(1.5).sunIntensity,0);
assert.ok(sampleDaylight(1.5).moonIntensity>0);
assert.equal(sampleDaylight(13).moonIntensity,0);
assert.ok(sampleDaylight(13).sunIntensity>2);

// The arc runs below the horizon for a real night and peaks steeply at noon.
assert.ok(solarElevation(1.5)<-15,'solar midnight is properly dark');
assert.ok(solarElevation(13)>65,'noon is steep');
assert.ok(solarElevation(4.4)<0&&solarElevation(4.9)>0,'sunrise lands near 04:40');
assert.ok(solarElevation(20.1)>0&&solarElevation(20.6)<0,'sunset lands near 20:20');
assert.ok(lunarElevation(1.5)>15,'the moon mirrors the sun');

// Both ends of the day hold their nearest keyframe rather than extrapolating.
assert.deepEqual(KEYFRAME_HOURS,[1.5,4.25,8,13,18,20.5,22.5]);
assert.deepEqual(KEYFRAME_IDS,['night','dawn','morning','noon','golden','dusk','night']);
assert.equal(sampleDaylight(13).skyWeight[3],1);
assert.equal(sampleDaylight(1.5).skyWeight[0],1);

// Neighbouring instants must not jump, or the running clock would pop.
let previous=sampleDaylight(0),maxStep=0;
for(let h=.01;h<DAY_HOURS;h+=.01){
  const s=sampleDaylight(h);
  maxStep=Math.max(maxStep,Math.abs(s.sunIntensity-previous.sunIntensity),
    Math.abs(s.moonIntensity-previous.moonIntensity),Math.abs(s.sunElevation-previous.sunElevation));
  previous=s;
}
assert.ok(maxStep<.5,`daylight varies smoothly, saw a step of ${maxStep}`);

// Midnight is a seam in the clock but not in the sky: values either side of it
// differ by no more than the ordinary rate of change over that interval. A real
// discontinuity would show up here as a jump of order one.
const late=sampleDaylight(23.9999),early=sampleDaylight(0.0001);
for(let i=0;i<KEYFRAME_HOURS.length;i++){
  assert.ok(Math.abs(late.skyWeight[i]-early.skyWeight[i])<1e-3,'the cycle closes smoothly at midnight');
}
assert.ok(Math.abs(late.sunIntensity-early.sunIntensity)<1e-3);
assert.ok(Math.abs(late.moonIntensity-early.moonIntensity)<1e-3);
assert.ok(Math.abs(late.hemisphereIntensity-early.hemisphereIntensity)<1e-3);
assert.ok(Math.abs(late.sunElevation-early.sunElevation)<.01);

// Bad input wraps instead of throwing.
assert.equal(wrapHours(-1),23);
assert.equal(wrapHours(25),1);
assert.equal(wrapHours(DAY_HOURS),0);
assert.equal(wrapHours(NaN),0);
console.log('PASS: daylight cycle — cyclic keyframe weights, solar/lunar arc, seam and continuity');
