// Native modal handles focus containment, Escape and background interaction.
export function installWorkspaceSettings(){
  const dialog=document.getElementById('settingsDialog');
  const tabs=[...dialog.querySelectorAll('[role="tab"]')];
  const panels=[...dialog.querySelectorAll('[role="tabpanel"]')];
  function activate(tab){
    for(const item of tabs){const selected=item===tab;item.setAttribute('aria-selected',String(selected));item.tabIndex=selected?0:-1;}
    for(const panel of panels)panel.hidden=panel.id!==tab.getAttribute('aria-controls');
    dialog.querySelector('.settings-content').scrollTop=0;
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
}
