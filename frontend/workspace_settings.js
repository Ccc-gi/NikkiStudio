// Native modal handles focus containment, Escape and background interaction.
export function installWorkspaceSettings(){
  const dialog=document.getElementById('settingsDialog');
  const tabs=[...dialog.querySelectorAll('[role="tab"]')];
  const panels=[...dialog.querySelectorAll('[role="tabpanel"]')];
  const summary=document.getElementById('cacheSummary'),locations=document.getElementById('cacheLocations');
  const format=n=>(n/1024**3).toFixed(2)+' GiB';
  async function refreshCache(){
    summary.textContent='正在统计…';
    try{const r=await fetch('/api/cache',{cache:'no-store'});const data=await r.json();if(!r.ok)throw Error(data.error);
      const old=data.entries.filter(e=>e.old);summary.textContent=`资源缓存 ${format(data.bytes)} · 旧版本 ${old.length} 个（${format(old.reduce((n,e)=>n+e.bytes,0))}）`;
      locations.textContent=`资源缓存：${data.path}\n测试产物：${data.developmentArtifacts.path}（${format(data.developmentArtifacts.bytes)}）\n配置与预设：${data.userData}`+(data.legacyCache.bytes?`\n旧位置缓存：${data.legacyCache.path}（${format(data.legacyCache.bytes)}）`:'')+data.externalTemporary.map(e=>`\n游戏盘临时转换：${e.path}（${format(e.bytes)}）`).join('');
    }catch(e){summary.textContent='统计失败：'+e.message;}
  }
  document.getElementById('refreshCache').onclick=refreshCache;
  document.getElementById('clearOldCache').onclick=async function(){
    this.disabled=true;try{const session=await fetch('/api/session').then(r=>r.json());const r=await fetch('/api/cache/old',{method:'POST',headers:{'Content-Type':'application/json','X-Nikki-Token':session.token},body:'{}'});const data=await r.json();if(!r.ok)throw Error(data.error);await refreshCache();summary.textContent+=` · 已清理 ${format(data.removedBytes)}`;}catch(e){summary.textContent=e.message;}finally{this.disabled=false;}
  };
  document.getElementById('clearBrowserCache').onclick=async function(){
    this.disabled=true;try{for(const name of await caches.keys())if(name.startsWith('nikki-furniture-assets-'))await caches.delete(name);
      const session=await fetch('/api/session').then(r=>r.json());const r=await fetch('/api/cache/browser',{method:'POST',headers:{'Content-Type':'application/json','X-Nikki-Token':session.token},body:JSON.stringify({settings:document.getElementById('removeBrowserSettings').checked})});if(!r.ok)throw Error('浏览器清理请求失败');summary.textContent='已请求浏览器清理此地址的缓存；请关闭本页以释放内存。勾选卸载清理时，请关闭其他标签页后再打开确认。';
    }catch(e){summary.textContent='清理失败：'+e.message;}finally{this.disabled=false;}
  };
  function activate(tab){
    for(const item of tabs){const selected=item===tab;item.setAttribute('aria-selected',String(selected));item.tabIndex=selected?0:-1;}
    for(const panel of panels)panel.hidden=panel.id!==tab.getAttribute('aria-controls');
    dialog.querySelector('.settings-content').scrollTop=0;
    if(tab.id==='tabResources')refreshCache();
  }
  for(const tab of tabs){
    tab.onclick=()=>activate(tab);
    tab.onkeydown=e=>{
      let index=tabs.indexOf(tab);
      if(e.key==='ArrowDown'||e.key==='ArrowRight')index=(index+1)%tabs.length;
      else if(e.key==='ArrowUp'||e.key==='ArrowLeft')index=(index+tabs.length-1)%tabs.length;
      else if(e.key==='Home')index=0;else if(e.key==='End')index=tabs.length-1;else return;
      e.preventDefault();activate(tabs[index]);tabs[index].focus();
    };
  }
  // Settings keyboard input must never trigger editor actions behind the modal.
  dialog.addEventListener('keydown',e=>e.stopPropagation());
  document.getElementById('openSettings').onclick=()=>dialog.showModal();
  for(const id of ['closeSettings','doneSettings'])document.getElementById(id).onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>document.getElementById('openSettings').focus());
  const help=document.getElementById('helpDialog'),openHelp=document.getElementById('openHelp');
  openHelp.onclick=()=>{help.showModal();help.querySelector('.help-content').scrollTop=0;};
  for(const id of ['closeHelp','doneHelp'])document.getElementById(id).onclick=()=>help.close();
  help.addEventListener('keydown',e=>e.stopPropagation());
  help.addEventListener('close',()=>openHelp.focus());
}
