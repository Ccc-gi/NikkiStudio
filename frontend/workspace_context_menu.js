import {preserveMaterialShader} from './foliage_material.js';
export function viewMatches(node,mode,selected,ids,categories,catalog){
  if(mode==='selected')return selected.has(String(node.userData.instance));
  if(mode==='same')return ids.has(String(node.userData.id));
  if(mode==='category')return categories.has(String(catalog[node.userData.id]?.categoryId??'0'));
  return true;
}
export function sameItemInstances(nodes,ids){return nodes.filter(n=>ids.has(String(n.userData.id))).map(n=>String(n.userData.instance));}
export function installWorkspaceContextMenu({canvas,panel,nodes,selection,pick,select,catalog,refresh,onChange,editAction,canEdit=()=>true,onVisibility=()=>{},syncVisibility=refresh}){
  let mode='',selected=new Set(),ids=new Set(),categories=new Set(),hidden=new Set(),ghosts=[],start=null,moved=false;
  let storageKey=null;
  function persist(){if(storageKey)try{localStorage.setItem(storageKey,JSON.stringify([...hidden]));}catch{}}
  function loadVisibility(key){storageKey='nikki:visibility:'+key;try{hidden=new Set(JSON.parse(localStorage.getItem(storageKey)??'[]').map(String));}catch{hidden=new Set();}}
  function setVisibility(instances,visible){const resetMode=visible&&mode;for(const id of instances)visible?hidden.delete(String(id)):hidden.add(String(id));if(resetMode){mode='';document.querySelector('#isolate').checked=false;}persist();if(resetMode)refresh();else syncVisibility();onVisibility();}
  const menu=document.createElement('div');menu.className='scene-context-menu';menu.setAttribute('role','menu');menu.hidden=true;panel.append(menu);
  const badge=document.createElement('div');badge.className='view-isolation-badge';badge.hidden=true;const label=document.createElement('span'),exit=document.createElement('button');exit.textContent='恢复场景';exit.onclick=()=>reset();badge.append(label,exit);panel.append(badge);
  const sections=[['变换',[['translate','✥','移动'],['rotate','↻','旋转'],['scale','⤢','缩放']]],['放置与复制',[['grab','✋','抓取 · 智能吸附'],['duplicate','▣','复制'],['arrayDuplicate','▦','阵列复制'],['curveDuplicate','∿','曲线阵列']]],['显示',[['selected','◉','只显示选中物品'],['same','▦','只显示同款物品'],['category','▤','只显示同类物品'],['ghost','◌','其他物品半透明'],['hide','◒','隐藏选中物品'],['hideSame','▧','隐藏同款物品'],['reset','↺','恢复完整场景']]],['删除',[['delete','×','删除选中物品']]]];
  const editing=new Set(['translate','rotate','scale','grab','duplicate','arrayDuplicate','curveDuplicate','delete']);
  const shortcuts={translate:'M',rotate:'R',scale:'V',grab:'T',duplicate:'Ctrl+C',delete:'Del'};
  for(const [title,actions] of sections){
    const section=document.createElement('div');section.className='context-section';section.setAttribute('role','group');section.setAttribute('aria-label',title);
    const heading=document.createElement('div');heading.className='context-heading';heading.textContent=title;section.append(heading);
    const items=document.createElement('div');items.className='context-actions';section.append(items);
    for(const [action,icon,text] of actions){const button=document.createElement('button');button.setAttribute('role','menuitem');button.textContent=`${icon}  ${text}`;if(shortcuts[action]){const key=document.createElement('kbd');key.className='context-shortcut';key.textContent=shortcuts[action];button.append(key);button.title=shortcuts[action];}button.dataset.action=action;if(action==='delete')button.className='context-delete';button.onclick=()=>{menu.hidden=true;if(editing.has(action))editAction?.(action);else run(action,text);};items.append(button);}
    menu.append(section);
  }
  function remember(){selected=new Set([...selection()].map(n=>String(n.userData.instance)));ids=new Set([...selection()].map(n=>String(n.userData.id)));categories=new Set([...selection()].map(n=>String(catalog()[n.userData.id]?.categoryId??'0')));}
  function reset(preserveStorage=false){mode='';hidden.clear();if(!preserveStorage)persist();document.querySelector('#isolate').checked=false;menu.hidden=true;refresh();onVisibility();}
  function run(action,text){menu.hidden=true;if(action==='reset'){reset();return;}if(!selection().size)return;remember();document.querySelector('#isolate').checked=false;
    if(action==='hide'||action==='hideSame'){for(const key of action==='hideSame'?sameItemInstances(nodes(),ids):selected)hidden.add(key);}else mode=action;
    persist();refresh();onVisibility();onChange(`${text} · 仅影响视图，点击“恢复场景”退出`);
  }
  function applyVisibility(){for(const node of nodes())node.visible=(!node.userData.unmatched||document.querySelector('#missing').checked)&&!hidden.has(String(node.userData.instance))&&viewMatches(node,mode,selected,ids,categories,catalog());
    const count=nodes().filter(n=>n.visible).length;badge.hidden=!mode&&!hidden.size;label.textContent=`${mode==='ghost'?'半透明参照':mode?'隔离显示':'临时隐藏'} · ${count} 件`;panel.dataset.viewMode=mode|| (hidden.size?'hidden':'all');panel.dataset.visibleFurniture=String(count);
  }
  function restoreMaterials(){const dispose=new Set();for(const {mesh,original,material} of ghosts){if(mesh.material===material)mesh.material=original;for(const m of Array.isArray(material)?material:[material])dispose.add(m);}for(const m of dispose)m.dispose();ghosts=[];}
  function prepareMaterials(){restoreMaterials();if(mode!=='ghost')return;const cache=new Map();for(const node of nodes()){if(selected.has(String(node.userData.instance)))continue;node.traverse(mesh=>{if(!mesh.isMesh||!mesh.material)return;const original=mesh.material,clone=m=>{if(!cache.has(m)){const c=preserveMaterialShader(m,m.clone());c.transparent=true;c.opacity=Math.min(m.opacity,.16);c.depthWrite=false;cache.set(m,c);}return cache.get(m);};const material=Array.isArray(original)?original.map(clone):clone(original);mesh.material=material;ghosts.push({mesh,original,material});});}}
  function open(e){if(moved||e.shiftKey)return;const hit=pick(e);if(hit&&!selection().has(hit))select(hit);if(!hit&&!selection().size)return;
    menu.hidden=false;const title=selection().size>1?`已选择 ${selection().size} 件物品`:catalog()[[...selection()][0]?.userData.id]?.name??'物品';menu.setAttribute('aria-label',title);
    for(const button of menu.querySelectorAll('button'))button.disabled=button.dataset.action!=='reset'&&(!selection().size||(editing.has(button.dataset.action)&&!canEdit(button.dataset.action)));
    const rect=panel.getBoundingClientRect();menu.style.left=`${Math.max(4,Math.min(e.clientX-rect.left,rect.width-menu.offsetWidth-4))}px`;menu.style.top=`${Math.max(4,Math.min(e.clientY-rect.top,rect.height-menu.offsetHeight-4))}px`;
  }
  canvas.addEventListener('pointerdown',e=>{menu.hidden=true;if(e.button===2){start={id:e.pointerId,x:e.clientX,y:e.clientY};moved=false;}},true);
  canvas.addEventListener('pointermove',e=>{if(start?.id===e.pointerId&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>5)moved=true;},true);
  canvas.addEventListener('pointerup',e=>{if(e.button===2&&start?.id===e.pointerId){open(e);start=null;}},true);
  canvas.addEventListener('pointercancel',()=>{start=null;menu.hidden=true;});canvas.addEventListener('contextmenu',e=>e.preventDefault());
  document.addEventListener('pointerdown',e=>{if(!menu.contains(e.target)&&e.target!==canvas)menu.hidden=true;});window.addEventListener('keydown',e=>{if(e.key==='Escape')menu.hidden=true;});window.addEventListener('blur',()=>{menu.hidden=true;start=null;});
  return{applyVisibility,prepareMaterials,restoreMaterials,reset,loadVisibility,setVisibility,isHidden:instance=>hidden.has(String(instance))};
}
