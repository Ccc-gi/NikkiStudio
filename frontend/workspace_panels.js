// Panel layout is a browser preference, independent of the save document.
export function initWorkspacePanels(){
  const workspace=document.querySelector('.workspace'),viewport=document.querySelector('.viewport');
  const narrow=matchMedia('(max-width:800px)'),key='nikki-workspace-panels-v1';
  let stored={};try{stored=JSON.parse(localStorage.getItem(key)??'{}');}catch{}
  const state={left:{width:320,closed:false,...stored.left},right:{width:288,closed:false,...stored.right}};
  const mobile={left:false,right:false},parts={};let dragging=null;
  function save(){try{localStorage.setItem(key,JSON.stringify(state));}catch{}}
  function width(side){const other=side==='left'?'right':'left';const available=workspace.clientWidth;
    const cap=narrow.matches?Math.min(560,available-44):Math.min(560,available-240-(state[other].closed?0:Math.min(state[other].width,available*.36)));
    return Math.max(220,Math.min(Number(state[side].width)||320,cap));
  }
  function render(){
    workspace.classList.add('adjustable-panels');
    for(const side of ['left','right']){
      const {panel,handle,toggle}=parts[side],closed=narrow.matches?!mobile[side]:state[side].closed;
      panel.classList.toggle('panel-collapsed',closed);panel.classList.toggle('compact-open',narrow.matches&&!closed);
      workspace.style.setProperty(`--${side}-width`,`${closed?0:width(side)}px`);
      panel.style.setProperty('--panel-width',`${width(side)}px`);
      toggle.hidden=!closed;toggle.setAttribute('aria-expanded',String(!closed));
      handle.setAttribute('aria-valuenow',String(Math.round(width(side))));
    }
  }
  function close(side){if(narrow.matches)mobile[side]=false;else state[side].closed=true;save();render();}
  for(const side of ['left','right']){
    const panel=document.querySelector(`.${side}-panel`),bar=document.createElement('div');bar.className='panel-drawer-bar';
    const title=document.createElement('span');title.textContent=side==='left'?'物品工具箱':'属性检查器';
    const closeButton=document.createElement('button');closeButton.textContent=side==='left'?'‹':'›';closeButton.title='收起面板';closeButton.setAttribute('aria-label',`收起${title.textContent}`);closeButton.onclick=()=>close(side);bar.append(title,closeButton);panel.prepend(bar);
    const handle=document.createElement('div');handle.className=`panel-resizer ${side}`;handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');handle.setAttribute('aria-label',`调整${title.textContent}宽度`);handle.setAttribute('aria-valuemin','220');handle.setAttribute('aria-valuemax','560');panel.append(handle);
    const toggle=document.createElement('button');toggle.className=`compact-panel-toggle ${side}`;toggle.textContent=side==='left'?'▦ 工具箱 ›':'‹ 属性';toggle.setAttribute('aria-label',`展开${title.textContent}`);viewport.append(toggle);
    toggle.onclick=()=>{if(narrow.matches){mobile[side]=true;mobile[side==='left'?'right':'left']=false;}else state[side].closed=false;save();render();};
    handle.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();dragging={side,id:e.pointerId,x:e.clientX,width:width(side)};handle.setPointerCapture(e.pointerId);document.body.classList.add('resizing-panels');};
    handle.onpointermove=e=>{if(!dragging||dragging.id!==e.pointerId)return;state[side].width=dragging.width+(e.clientX-dragging.x)*(side==='left'?1:-1);state[side].width=width(side);render();};
    const finish=()=>{dragging=null;document.body.classList.remove('resizing-panels');save();};handle.onpointerup=finish;handle.onpointercancel=finish;handle.onlostpointercapture=finish;
    handle.ondblclick=()=>{state[side].width=side==='left'?320:288;save();render();};
    handle.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home'].includes(e.key))return;e.preventDefault();state[side].width=e.key==='Home'?(side==='left'?320:288):width(side)+(e.key==='ArrowRight'?1:-1)*(side==='left'?1:-1)*(e.shiftKey?40:10);state[side].width=width(side);save();render();};
    parts[side]={panel,handle,toggle};
  }
  narrow.addEventListener('change',render);window.addEventListener('resize',render);window.addEventListener('blur',()=>{dragging=null;document.body.classList.remove('resizing-panels');});render();
}
