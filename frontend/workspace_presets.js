const ENDPOINT='/api/presets';
const MAX_IMPORT_BYTES=5*1024*1024;
async function request(path,body){
  const options=body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json','X-Nikki-Token':(await fetch('/api/session',{cache:'no-store'}).then(r=>r.json())).token},body:JSON.stringify(body)};
  const response=await fetch(path,options),value=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(value.error??'预设请求失败');return value;
}
export function filterPresets(presets,search,sort){
  const term=search.trim().toLocaleLowerCase();
  return presets.filter(p=>p.name.toLocaleLowerCase().includes(term)).sort((a,b)=>{
    if(sort==='recent'){const delta=String(b.savedAt??'').localeCompare(String(a.savedAt??''));if(delta)return delta;}
    if(sort==='size'&&a.items!==b.items)return b.items-a.items;
    return a.name.localeCompare(b.name,'zh-CN',{numeric:true})||a.id.localeCompare(b.id);
  });
}
function download(document_,name){
  const url=URL.createObjectURL(new Blob([JSON.stringify(document_,null,2)],{type:'application/json'})),a=document.createElement('a');
  a.href=url;a.download=name.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function installPresets({tab,panel,selectionName,saveSelection,placeItems,missingItems=()=>[],notify}){
  const container=document.createElement('div');container.id='presetPanel';container.hidden=true;container.className='preset-panel';
  container.innerHTML=`<div class="preset-actions"><button id="savePreset" class="primary" disabled>＋ 把选中存为预设</button><div class="preset-transfer"><button id="importPresets">导入预设</button><button id="exportPresets">导出全部备份</button></div></div><input id="presetImportFiles" type="file" accept=".json,application/json" multiple hidden><div class="preset-filters"><input id="presetSearch" type="search" placeholder="搜索预设名称" aria-label="搜索预设名称"><select id="presetSort" aria-label="预设排序"><option value="recent">最近保存</option><option value="name">名称</option><option value="size">物品数量</option></select></div><span id="presetCount" class="panel-note"></span><div id="presetList" class="object-list"></div><div class="panel-note" id="presetNote" role="status"></div><div class="preset-storage-note">保存在本机预设库 · 清理资源缓存不会删除<br>导出 JSON 可备份，也可在其他电脑导入</div>`;
  panel.append(container);
  const dialog=document.createElement('dialog');dialog.className='preset-dialog';dialog.setAttribute('aria-labelledby','presetDialogTitle');
  dialog.innerHTML='<form><h3 id="presetDialogTitle"></h3><p id="presetDialogMessage"></p><input id="presetDialogName" aria-label="预设名称" maxlength="60"><div class="preset-dialog-actions"><button type="button" id="presetDialogCancel">取消</button><button type="submit" id="presetDialogConfirm" class="primary">确认</button></div></form>';
  document.body.append(dialog);dialog.addEventListener('keydown',e=>e.stopPropagation());
  function ask({title,message='',value=null,confirmLabel='确认'}){return new Promise(resolve=>{
    dialog.querySelector('h3').textContent=title;dialog.querySelector('p').textContent=message;
    const input=dialog.querySelector('input');input.hidden=value===null;input.value=value??'';
    dialog.querySelector('#presetDialogConfirm').textContent=confirmLabel;
    const finish=result=>{dialog.close();resolve(result);};
    dialog.querySelector('form').onsubmit=e=>{e.preventDefault();finish(value===null?true:input.value);};
    dialog.querySelector('#presetDialogCancel').onclick=()=>finish(null);
    dialog.oncancel=e=>{e.preventDefault();finish(null);};dialog.showModal();
    if(value!==null){input.focus();input.select();}
  });}
  const $=id=>container.querySelector('#'+id),list=$('presetList'),save=$('savePreset'),note=$('presetNote'),tabs=[...document.querySelectorAll('.left-panel .tabs button')];
  let presets=[],busy=false,active=false,saveEnabled=false,message='',failed=false;
  function render(){
    save.disabled=busy||!saveEnabled;$('importPresets').disabled=busy;$('exportPresets').disabled=busy||!presets.length;
    list.replaceChildren();const visible=filterPresets(presets,$('presetSearch').value,$('presetSort').value);
    $('presetCount').textContent=`${visible.length} / ${presets.length} 个预设`;
    note.textContent=message||(busy?'正在处理预设…':'单击预设拿起 · 点场景放置 · 右键取消');
    if(busy)return;
    if(!visible.length){const empty=document.createElement('p');empty.className='preset-empty';empty.textContent=failed?'读取失败，请重新进入预设页重试。':presets.length?'没有符合搜索条件的预设。':'还没有预设。导入已有文件，或把场景中选中的物品存为预设。';list.append(empty);return;}
    for(const preset of visible){
      const row=document.createElement('div');row.className='preset-row';
      const place=document.createElement('button');place.className='preset-place';place.setAttribute('aria-label','放置预设 '+preset.name);
      const title=document.createElement('strong'),meta=document.createElement('small');title.textContent=preset.name;meta.textContent=`${preset.items} 件${preset.savedAt?' · '+preset.savedAt.replace('T',' ').slice(0,16):''}`;place.append(title,meta);place.onclick=()=>use(preset);
      const menu=document.createElement('details');menu.className='preset-menu';const summary=document.createElement('summary');summary.textContent='⋯';summary.setAttribute('aria-label','管理预设 '+preset.name);menu.append(summary);
      const actions=document.createElement('div');actions.className='preset-menu-actions';
      for(const [label,action] of [['重命名',()=>rename(preset)],['复制',()=>duplicate(preset)],['导出',()=>exportOne(preset)],['删除',()=>remove(preset)]]){const button=document.createElement('button');button.textContent=label;button.setAttribute('aria-label',label+'预设 '+preset.name);button.onclick=()=>{menu.open=false;action();};actions.append(button);}menu.append(actions);row.append(place,menu);list.append(row);
    }
  }
  async function refresh(){
    busy=true;render();try{presets=(await request(ENDPOINT)).presets??[];failed=false;}catch(e){failed=true;message='预设读取失败：'+e.message;notify(message);}finally{busy=false;render();}
  }
  function enter(){if(active)return;active=true;container.hidden=false;panel.classList.add('preset-mode');for(const button of tabs)button.classList.toggle('active',button===tab);message='';refresh();}
  function leave(){active=false;container.hidden=true;panel.classList.remove('preset-mode');}
  tab.onclick=enter;$('presetSearch').oninput=render;$('presetSort').onchange=render;
  container.addEventListener('keydown',e=>{if(e.target.matches('input,select,summary')||e.target.closest('.preset-menu'))e.stopPropagation();});
  async function operation(work,success){
    if(busy)return;busy=true;message='';render();try{const result=await work();message=typeof success==='function'?success(result):success;notify(message);}catch(e){message=e.message;notify('预设操作失败：'+message);}finally{busy=false;await refresh();}
  }
  async function use(preset){
    if(busy)return;busy=true;message='正在取出 '+preset.name+'…';render();
    try{const document_=await request(ENDPOINT+'/'+encodeURIComponent(preset.id)),items=document_.items;
      const missing=missingItems(items);if(missing.length)throw Error(`当前游戏缺少 ${missing.length} 种物品：${missing.slice(0,8).join('、')}。预设已保留，请检查游戏版本与资源。`);
      await placeItems(items,document_.name);message=`已拿起「${document_.name}」· ${items.length} 件 · 点场景放置`;
    }catch(e){message=e.message;notify('放置预设失败：'+message);}finally{busy=false;render();}
  }
  async function rename(preset){const name=await ask({title:'重命名预设',value:preset.name});if(name===null||name.trim()===preset.name)return;if(!name.trim())return notify('预设需要一个名字');await operation(()=>request(ENDPOINT+'/rename',{id:preset.id,name:name.trim()}),'已重命名预设');}
  async function duplicate(preset){await operation(()=>request(ENDPOINT+'/duplicate',{id:preset.id}),r=>'已复制为「'+r.name+'」');}
  async function remove(preset){if(!await ask({title:'删除预设',message:`删除「${preset.name}」？已放置的场景物品不受影响。建议先导出备份。`,confirmLabel:'删除'}))return;await operation(()=>request(ENDPOINT+'/delete',{id:preset.id}),'已删除预设：'+preset.name);}
  async function exportOne(preset){await operation(async()=>download(await request(ENDPOINT+'/export/'+encodeURIComponent(preset.id)),preset.name+'.preset'),'已提交预设下载，请在下载列表确认文件');}
  $('exportPresets').onclick=()=>operation(async()=>download(await request(ENDPOINT+'/export'),'NikkiStudio-presets-'+new Date().toLocaleDateString('sv-SE')),'已提交全部预设备份下载，请在下载列表确认文件');
  $('importPresets').onclick=()=>$('presetImportFiles').click();
  $('presetImportFiles').onchange=async()=>{
    const files=[...$('presetImportFiles').files];$('presetImportFiles').value='';if(!files.length)return;
    await operation(async()=>{if(files.length>200||files.reduce((n,f)=>n+f.size,0)>MAX_IMPORT_BYTES)throw Error('一次最多选择 200 个文件，总大小不超过 5 MiB');const documents=[];
      for(const file of files){try{documents.push(JSON.parse((await file.text()).replace(/^\uFEFF/,'')));}catch{throw Error('JSON 文件无法读取：'+file.name);}}
      const body={documents};if(new Blob([JSON.stringify(body)]).size>7*1024*1024)throw Error('导入内容过大，请分批导入');return request(ENDPOINT+'/import',body);
    },r=>`已导入 ${r.imported.length} 个预设；同名预设保留两份`);
  };
  save.onclick=async()=>{
    if(busy)return;let items;try{items=saveSelection();}catch(e){return notify('无法保存预设：'+e.message);}if(!items?.length)return notify('先选中要保存的物品');
    const name=await ask({title:'保存预设',message:`把选中的 ${items.length} 件物品保存为可重复放置的一组。`,value:selectionName()||''});if(name===null)return;if(!name.trim())return notify('预设需要一个名字');
    if(presets.some(p=>p.name===name.trim())&&!await ask({title:'覆盖同名预设',message:`已有「${name.trim()}」，是否覆盖？`,confirmLabel:'覆盖'}))return;
    await operation(()=>request(ENDPOINT,{name:name.trim(),items}),r=>`已保存「${r.name}」· ${r.items} 件`);
  };
  return {enter,leave,get active(){return active;},refresh,setSaveEnabled(enabled){saveEnabled=enabled;save.disabled=busy||!enabled;}};
}
