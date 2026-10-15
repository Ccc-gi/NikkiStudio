import assert from 'node:assert/strict';
import {createPreviewRenderLoop} from '../frontend/preview_render_loop.js';
let visible=true,changed=false,id=0,draws=[],callbacks=new Map();
const loop=createPreviewRenderLoop({active:()=>visible,update:()=>changed,render:t=>draws.push(t),
  requestFrame:fn=>{callbacks.set(++id,fn);return id;},cancelFrame:n=>callbacks.delete(n)});
function frame(time){const jobs=[...callbacks.values()];callbacks.clear();for(const fn of jobs)fn(time);}
// Multiple pointer events before a refresh coalesce into one frame.
loop.invalidate();loop.invalidate();loop.invalidate();assert.equal(callbacks.size,1);
frame(0);assert.deepEqual(draws,[0]);assert.equal(callbacks.size,0);
// No 33ms gate: successive 60Hz frames render while damping moves the camera.
changed=true;loop.invalidate();frame(16.67);frame(33.34);frame(50.01);
assert.equal(draws.length,4);assert.equal(callbacks.size,1);
// Once damping settles there is no render or perpetual callback.
changed=false;frame(66.68);assert.equal(draws.length,4);assert.equal(callbacks.size,0);
loop.invalidate();loop.stop();assert.equal(callbacks.size,0);
visible=false;loop.invalidate();assert.equal(callbacks.size,0);
visible=true;loop.invalidate();frame(100);assert.equal(draws.at(-1),100);
console.log('Preview scheduling: coalescing, 60Hz motion, idle, cancellation and resume passed');
