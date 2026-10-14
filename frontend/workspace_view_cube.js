import * as T from 'three';

export function installViewCube({panel,camera,controls,onHome}){
  const widget=document.createElement('div');widget.className='view-cube-widget';widget.setAttribute('aria-label','视角立方体');
  const cube=document.createElement('div');cube.className='view-cube';widget.append(cube);
  const directions={top:[0,1,0],bottom:[0,-1,0],front:[0,0,1],back:[0,0,-1],left:[-1,0,0],right:[1,0,0]};
  const names={top:'顶',bottom:'底',front:'前',back:'后',left:'左',right:'右'};
  const extras=document.createElement('div');extras.className='view-cube-extras';
  for(const face of Object.keys(directions)){
    const button=document.createElement('button');button.textContent=names[face];button.title=names[face]+'视图';button.setAttribute('aria-label',names[face]+'视图');button.dataset.viewFace=face;
    button.className='view-cube-face '+face;
    button.onclick=()=>{
      const distance=Math.max(.2,camera.position.distanceTo(controls.target));
      camera.up.set(0,1,0);if(face==='top')camera.up.set(0,0,-1);if(face==='bottom')camera.up.set(0,0,1);
      camera.position.copy(controls.target).addScaledVector(new T.Vector3(...directions[face]),distance);
      camera.lookAt(controls.target);controls.update();panel.dataset.cameraView=face;
      widget.querySelectorAll('[data-view-face]').forEach(b=>b.classList.toggle('active',b===button));
    };
    (['top','front','right'].includes(face)?cube:extras).append(button);
  }
  const home=document.createElement('button');home.textContent='⌂';home.title='返回全景透视';home.setAttribute('aria-label','返回全景透视');home.onclick=()=>{camera.up.set(0,1,0);onHome();panel.dataset.cameraView='perspective';widget.querySelectorAll('.active').forEach(b=>b.classList.remove('active'));};extras.append(home);widget.append(extras);panel.append(widget);
}
