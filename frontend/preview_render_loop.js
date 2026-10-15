// Static models only need frames while the camera changes or damping settles.
// Inject scheduling so frame coalescing and idle behaviour can be tested.
export function createPreviewRenderLoop({active,update,render,requestFrame=requestAnimationFrame,cancelFrame=cancelAnimationFrame}){
  let pending=0,dirty=false;
  function schedule(){if(!pending&&active())pending=requestFrame(tick);}
  function tick(time){
    pending=0;if(!active())return;
    const redraw=dirty;dirty=false;
    const changed=update();
    if(redraw||changed)render(time);
    if(changed||dirty)schedule();
  }
  return {
    invalidate(){dirty=true;schedule();},
    stop(){if(pending)cancelFrame(pending);pending=0;dirty=false;},
  };
}
