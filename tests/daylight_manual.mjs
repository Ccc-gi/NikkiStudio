import assert from 'node:assert/strict';
import {kelvinToHex,closestKelvin,manualState} from '../frontend/render_quality.js';
import {DAY_HOURS,sampleDaylight} from '../frontend/daylight_cycle.js';

// Turning auto off must not move anything: an empty override set is a no-op.
for(let h=0;h<DAY_HOURS;h+=.5){
  const base=sampleDaylight(h);
  assert.deepEqual(manualState(base,{}),base,`manual mode with no edits changes nothing at ${h}h`);
}

// Each override touches exactly its own field.
const base=sampleDaylight(13);
const moved=manualState(base,{azimuth:200});
assert.equal(moved.lightAzimuth,200);
assert.equal(moved.sunAzimuth,200,'by day the override lands on the sun');
assert.equal(moved.sunElevation,base.sunElevation);
assert.equal(moved.sunIntensity,base.sunIntensity);
assert.equal(moved.sunColor,base.sunColor);
assert.equal(moved.fogDensity,base.fogDensity);
assert.deepEqual(moved.skyWeight,base.skyWeight,'the sky stays with the clock when only the light moves');

// At night the same controls drive the moon, and the sun stays parked.
const night=sampleDaylight(1.5);
const raised=manualState(night,{elevation:35,intensity:1.2});
assert.equal(raised.moonElevation,35,'by night the override lands on the moon');
assert.equal(raised.moonIntensity,1.2);
assert.equal(raised.sunIntensity,0,'the sun stays off');
assert.equal(raised.sunElevation,-35,'the sun is kept as the mirror image');
assert.equal(raised.moonAzimuth,raised.lightAzimuth);

const hazy=manualState(base,{fog:2});
assert.equal(hazy.fogDensity,base.fogDensity*2);
assert.equal(hazy.sunColor,base.sunColor);

const warm=manualState(base,{kelvin:2800});
assert.equal(warm.sunColor,kelvinToHex(2800));
assert.equal(warm.sunIntensity,base.sunIntensity);

// Where the clock stops, the warmth slider starts — close enough not to jump.
// A beam that is nearly extinguished cannot show a shift, so only the hours
// where the direct light actually carries the scene are measured.
const distance=(a,b)=>((a>>16&255)-(b>>16&255))**2+((a>>8&255)-(b>>8&255))**2+((a&255)-(b&255))**2;
let worst=0,worstHour=0,measured=0;
for(let h=0;h<DAY_HOURS;h+=.25){
  const s=sampleDaylight(h);
  if(s.lightIntensity<.15)continue;
  measured++;
  const roundTrip=kelvinToHex(closestKelvin(s.lightColor));
  const d=Math.sqrt(distance(s.lightColor,roundTrip));
  if(d>worst){worst=d;worstHour=h;}
}
assert.ok(measured>40,'the sweep has to actually cover the lit hours');
assert.ok(worst<30,`grabbing the warmth slider must not shift the light far (worst ${worst.toFixed(1)} at ${worstHour}h)`);
console.log(`PASS: manual overrides are sparse, day/night aware and lossless (worst warmth-slider shift ${worst.toFixed(1)} RGB at ${worstHour}h)`);
