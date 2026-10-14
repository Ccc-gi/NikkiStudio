// Item presets: the current selection kept as a small save fragment on this
// computer, placed back later by clicking in the scene.
const ENDPOINT = '/api/presets';

async function token(){
  return (await fetch('/api/session',{cache:'no-store'}).then(r=>r.json())).token;
}
async function request(path,body){
  const options=body===undefined?{cache:'no-store'}:{
    method:'POST',
    headers:{'Content-Type':'application/json','X-Nikki-Token':await token()},
    body:JSON.stringify(body)};
  const response=await fetch(path,options);
  const value=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(value.error??'预设请求失败');
  return value;
}

// Claims the left panel for the preset list and gives it back untouched.
export function installPresets({tab,panel,selectionName,saveSelection,placeItems,notify}){
  const container=document.createElement('div');
  container.id='presetPanel';container.hidden=true;container.className='preset-panel';
  container.innerHTML='<div class="preset-actions"><button id="savePreset" class="primary" disabled title="把场景里选中的物品存成一组，随时放回来">＋ 把选中存为预设</button></div><div id="presetList" class="object-list"></div><div class="panel-note" id="presetNote">单击一项就拿在手上，点场景放置 · 右键取消</div>';
  panel.append(container);
  const list=container.querySelector('#presetList'),save=container.querySelector('#savePreset'),note=container.querySelector('#presetNote');
  const tabs=[...document.querySelectorAll('.left-panel .tabs button')];
  let presets=[],busy=false,active=false;

  // The scene list keeps its own hidden state, so the swap is a class on the panel.
  function enter(){
    if(active)return;active=true;container.hidden=false;panel.classList.add('preset-mode');
    for(const button of tabs)button.classList.toggle('active',button===tab);
    render();
  }
  function leave(){
    if(!active)return;active=false;container.hidden=true;panel.classList.remove('preset-mode');
  }
  tab.onclick=enter;

  function render(){
    list.replaceChildren();
    if(busy){note.textContent='正在读取预设…';return;}
    if(!presets.length){
      const empty=document.createElement('p');empty.className='preset-empty';
      empty.textContent='还没有预设。在场景里选中若干物品，点上面的按钮存成一组。';
      list.append(empty);note.textContent='预设存放在这台电脑的编辑器数据目录里，换浏览器也不会丢。';return;
    }
    note.textContent='单击一项就拿在手上，点场景放置 · 右键取消';
    for(const preset of presets){
      const row=document.createElement('div');row.className='preset-row';
      const place=document.createElement('button');place.className='preset-place';
      place.innerHTML=`<strong></strong><small></small>`;
      place.querySelector('strong').textContent=preset.name;
      place.querySelector('small').textContent=`${preset.items} 件${preset.savedAt?' · '+preset.savedAt.replace('T',' ').slice(0,16):''}`;
      place.onclick=()=>use(preset);
      const remove=document.createElement('button');remove.className='preset-remove';remove.textContent='删除';remove.title='删除这个预设';
      remove.onclick=async()=>{if(!confirm(`删除预设「${preset.name}」？存档不受影响。`))return;
        try{await request('/api/presets/delete',{id:preset.id});notify('已删除预设：'+preset.name);await refresh();}catch(e){notify('删除失败：'+e.message);}};
      row.append(place,remove);list.append(row);
    }
  }

  async function refresh(){
    busy=true;render();
    try{presets=(await request(ENDPOINT)).presets??[];}catch(e){presets=[];note.textContent='预设读取失败：'+e.message;}
    busy=false;render();
  }

  async function use(preset){
    if(busy)return;
    busy=true;render();note.textContent='正在取出 '+preset.name+'…';
    try{
      const document_=await request(ENDPOINT+'/'+encodeURIComponent(preset.id));
      const items=document_.items??[];
      if(!items.length)throw Error('这个预设里没有物品');
      await placeItems(items,document_.name??preset.name);
      note.textContent=`已拿起「${document_.name??preset.name}」· ${items.length} 件 · 点场景放置 · 右键取消`;
    }catch(e){notify('放置预设失败：'+e.message);}
    busy=false;render();
  }

  save.onclick=async()=>{
    if(busy)return;
    let items;
    try{items=saveSelection();}catch(e){return notify('无法保存预设：'+e.message);}
    if(!items?.length)return notify('先在场景里选中要保存的物品');
    const suggested=selectionName()||'';
    const name=prompt(`把选中的 ${items.length} 件物品存为预设，给它起个名字：`,suggested);
    if(name===null)return;
    if(!name.trim())return notify('预设需要一个名字');
    if(presets.some(p=>p.name===name.trim())&&!confirm(`已有同名预设「${name.trim()}」，覆盖它吗？`))return;
    busy=true;render();note.textContent='正在保存…';
    try{
      const saved=await request(ENDPOINT,{name:name.trim(),items});
      notify(`已保存预设「${saved.name}」· ${saved.items} 件`);
    }catch(e){notify('保存预设失败：'+e.message);}
    busy=false;await refresh();
  };

  return {
    enter,
    leave,
    get active(){return active;},
    refresh,
    setSaveEnabled(enabled){save.disabled=!enabled;},
  };
}
