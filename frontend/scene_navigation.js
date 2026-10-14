import * as T from 'three';

// Move the camera AND orbit target, so wheel navigation can pass the old target.
export function installSceneNavigation(camera, controls, canvas, pickSurface) {
  const ray = new T.Raycaster(), pointer = new T.Vector2();
  const forward = new T.Vector3();
  controls.rotateSpeed = .45;
  const keys = new Set(), movement = new T.Vector3(), right = new T.Vector3();
  const navigationKeys = new Set(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ShiftLeft','ShiftRight']);
  let previousFrame = performance.now(), travelled = 0;
  canvas.tabIndex = 0;
  canvas.style.outline = 'none';
  canvas.setAttribute('aria-label', '3D 场景；WASD 平移，Q 上升，E 下降，Shift 加速');
  window.addEventListener('keydown', event => {
    if (document.activeElement !== canvas || !navigationKeys.has(event.code) || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    keys.add(event.code);
  });
  window.addEventListener('keyup', event => keys.delete(event.code));
  const clearKeys = () => keys.clear();
  window.addEventListener('blur', clearKeys);
  canvas.addEventListener('blur', clearKeys);
  document.addEventListener('visibilitychange', clearKeys);
  function aim(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set((event.clientX-rect.left)/rect.width*2-1, -(event.clientY-rect.top)/rect.height*2+1);
    ray.setFromCamera(pointer, camera);
    return pickSurface(ray);
  }
  function updateOrbitDepth(event) {
    // Keep the target on the current view axis: changing depth must not turn
    // the camera toward an off-centre mouse hit or make the picture jump.
    camera.getWorldDirection(forward);
    const cursorHit = aim(event);
    ray.setFromCamera(new T.Vector2(0, 0), camera);
    const hit = pickSurface(ray) ?? cursorHit;
    if (!hit) return;
    const depth = hit.point.clone().sub(camera.position).dot(forward);
    if (depth <= .02) return;
    controls.target.copy(camera.position).addScaledVector(forward, Math.max(.15, depth));
    canvas.dataset.orbitDepth = Math.max(.15, depth).toFixed(5);
    controls.update();
  }
  canvas.addEventListener('pointerdown', event => {
    canvas.focus({preventScroll:true});
    if (controls.enabled && (event.button === 2 || event.button === 1) && event.shiftKey) updateOrbitDepth(event);
  }, {capture:true});
  canvas.addEventListener('wheel', event => {
    if (!controls.enabled || !event.deltaY) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const hit = aim(event);
    const distance = hit?.distance ?? camera.position.distanceTo(controls.target);
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
    const strength = Math.min(3, Math.abs(delta)/100);
    const step = T.MathUtils.clamp(distance*.12, .15, 12)*strength;
    const shift = ray.ray.direction.clone().multiplyScalar(delta < 0 ? step : -step);
    camera.position.add(shift);
    controls.target.add(shift);
    controls.update();
    updateOrbitDepth(event);
    canvas.dataset.navigationStep = step.toFixed(5);
    canvas.dataset.navigationEvents = String(Number(canvas.dataset.navigationEvents || 0)+1);
  }, {capture:true, passive:false});
  canvas.addEventListener('dblclick', event => {
    const hit = aim(event);
    if (!hit || hit.distance < .02) return;
    controls.target.copy(hit.point);
    controls.update();
  });
  return {update() {
    const now = performance.now(), dt = Math.min(.05, (now-previousFrame)/1000);
    previousFrame = now;
    if (!controls.enabled || document.activeElement !== canvas || !keys.size) return;
    // W/S follow the full view direction, including pitch; A/D use camera right.
    // Sample the current orientation after OrbitControls has applied this
    // frame's drag/damping, rather than relying on a previously built matrix.
    forward.set(0,0,-1).applyQuaternion(camera.quaternion).normalize();
    right.set(1,0,0).applyQuaternion(camera.quaternion).normalize();
    movement.set(0,0,0);
    movement.addScaledVector(forward, Number(keys.has('KeyW'))-Number(keys.has('KeyS')));
    movement.addScaledVector(right, Number(keys.has('KeyD'))-Number(keys.has('KeyA')));
    movement.y += Number(keys.has('KeyQ'))-Number(keys.has('KeyE'));
    if (!movement.lengthSq()) return;
    const speed = T.MathUtils.clamp(camera.position.distanceTo(controls.target)*.6, 1, 25);
    const boost = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 3 : 1;
    movement.normalize().multiplyScalar(speed*boost*dt);
    camera.position.add(movement);controls.target.add(movement);
    travelled += movement.length();
    canvas.dataset.keyboardTravel = travelled.toFixed(5);
    canvas.dataset.cameraPosition = camera.position.toArray().map(v=>v.toFixed(5)).join(',');
    canvas.dataset.keyboardDirection = forward.toArray().map(v=>v.toFixed(5)).join(',');
  }};
}
