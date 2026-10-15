import {reserveSaveIdentities} from './save_identity.js';
export const saveName = /^(BUILD|WORLDBUILD)_SAVEDATA_(\d+)\.json$/;
export async function findBuildDirectory(root) {
  if(root.name==='BuildData')return root;
  for(const parts of [['X6Game','Saved','SavedData','BuildData'],['Saved','SavedData','BuildData'],['SavedData','BuildData'],['BuildData']]){
    try{let dir=root;for(const part of parts)dir=await dir.getDirectoryHandle(part);return dir;}catch(e){if(!['NotFoundError','TypeMismatchError'].includes(e.name))throw e;}
  }
  throw Error('没有找到 BuildData，请选择游戏安装目录、X6Game 或 BuildData 文件夹。');
}
export async function listGameSaves(dir){
  const saves=[];for await(const handle of dir.values()){const match=handle.name.match(saveName);if(handle.kind!=='file'||!match||match[2].length===13)continue;const file=await handle.getFile();saves.push({handle,name:handle.name,modified:file.lastModified});}
  return saves.sort((a,b)=>b.modified-a.modified);
}
export async function writeGameSave(dir,target,text,expected){
  const current=await target.getFile(),before=await current.text();
  if(before!==expected)throw Error('游戏已修改这个存档，请先重新载入，再保存。');
  JSON.parse(text);
  const backupDir=await dir.getDirectoryHandle('NikkiStudioBackups',{create:true});
  const backup=await backupDir.getFileHandle(target.name.replace(/\.json$/, '')+'_'+Date.now()+'.json',{create:true});
  let writable=await backup.createWritable();await writable.write(before);await writable.close();
  // Recheck after backup creation to avoid overwriting a change made during backup.
  if(await (await target.getFile()).text()!==before)throw Error('备份期间游戏更新了存档，请重新载入。');
  writable=await target.createWritable();try{await writable.write(text);await writable.close();}catch(e){await writable.abort().catch(()=>{});throw e;}
  return text;
}
function handleStore(action,value){return new Promise((resolve,reject)=>{const request=indexedDB.open('nikki-studio-files',1);request.onupgradeneeded=()=>request.result.createObjectStore('handles');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('handles',action==='get'?'readonly':'readwrite'),store=tx.objectStore('handles'),req=action==='get'?store.get('game'):store.put(value,'game');tx.oncomplete=()=>{resolve(req.result);db.close();};tx.onerror=()=>{reject(tx.error);db.close();};};});}
export function installGameFiles({getDocument,loadDocument,validate,notify,onSaved,isReady}){
  const choose=document.querySelector('#chooseGameDirectory'),save=document.querySelector('#saveGame'),saveAs=document.querySelector('#exportSave'),saveDoc=document.querySelector('#saveDocument'),importBtn=document.querySelector('#importSave');
  const wrap=document.createElement('div');wrap.className='game-chip-wrap';
  wrap.innerHTML='<button class="game-chip" id="gameChip" aria-haspopup="true" aria-expanded="false"><span class="game-chip-dot"></span><span class="game-chip-text" id="gameChipText">连接游戏目录</span><span class="game-chip-caret">▾</span></button><div class="game-popover" id="gamePopover" hidden><div class="game-popover-head">游戏存档<small id="gameDirectoryStatus"></small></div><div class="game-save-list" id="gameSaveList" role="listbox" aria-label="游戏存档目标"></div><p class="game-popover-update" id="gameFileUpdate" role="status"></p><button class="primary" id="loadGameSave">载入游戏存档</button></div>';
  document.querySelector('.toolbar').append(wrap);
  const chip=wrap.querySelector('#gameChip'),chipText=wrap.querySelector('#gameChipText'),popover=wrap.querySelector('#gamePopover'),list=wrap.querySelector('#gameSaveList'),label=wrap.querySelector('#gameDirectoryStatus'),load=wrap.querySelector('#loadGameSave'),update=wrap.querySelector('#gameFileUpdate');
  let dir=null,root=null,saves=[],selected='',expected=null,baseline=null,busy=false,polling=false,fileHandle=null;
  const target=()=>saves.find(s=>s.name===selected)?.handle;
  // 当前存档文件的句柄。打开或另存为时更新，决定 Ctrl+S 写回哪里；载入游戏存档后清空。
  const JSON_TYPES=[{description:'存档 JSON',accept:{'application/json':['.json']}}];
  function download(text,name){const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function write(handle,text){const writable=await handle.createWritable();try{await writable.write(text);await writable.close();}catch(e){await writable.abort().catch(()=>{});throw e;}}
  async function writeAs(text,suggestedName){
    if(!window.showSaveFilePicker){download(text,suggestedName);return{name:suggestedName,downloaded:true};}
    const handle=await window.showSaveFilePicker({suggestedName,types:JSON_TYPES});
    await write(handle,text);fileHandle=handle;
    return{name:handle.name,downloaded:false};
  }
  async function prepareExport(data,doc,revision){
    if(!target())return data;
    const exportTarget=target(),current=await(await exportTarget.getFile()).text();
    if(getDocument()!==doc||doc.revision!==revision||target()!==exportTarget)throw Error('工作区或目标已经改变，请重新导出');
    if(baseline!==null&&current!==baseline)throw Error('游戏存档已更新，请重新连接目录后再导出');
    return reserveSaveIdentities(localStorage,exportTarget.name,data,JSON.parse(current)).data;
  }
  function openPopover(open){popover.hidden=!open;chip.setAttribute('aria-expanded',String(open));}
  function render(){
    const connected=!!dir;
    chip.classList.toggle('is-connected',connected);
    chipText.textContent=connected?(selected||root.name+' / BuildData'):'连接游戏目录';
    chip.title=connected?root.name+' / BuildData · 点击查看游戏存档':'连接游戏目录';
    save.disabled=!connected||!target()||busy||!isReady();
    load.disabled=busy||!target();
    choose.disabled=busy;
    if(!connected)openPopover(false);
  }
  async function scan(){
    const previous=selected,hadSaves=saves.length>0;
    saves=await listGameSaves(dir);
    if(saves.some(s=>s.name===previous))selected=previous;
    else if(previous||hadSaves){selected='';expected=baseline=null;update.textContent='原目标存档已移除，请确认新的目标';}
    list.replaceChildren(...(saves.length?saves.map(s=>{const b=document.createElement('button');b.type='button';b.className='game-save';b.textContent=s.name;b.setAttribute('role','option');b.setAttribute('aria-selected',String(s.name===selected));b.onclick=()=>pick(s.name);return b;}):[Object.assign(document.createElement('p'),{textContent:'未检测到正式存档，请先在游戏中导出，再回到这里。'})]));
    label.textContent=root.name+' / BuildData'+(saves.length?' · '+saves.length+' 个存档':'');
    render();
  }
  async function pick(name){selected=name;expected=baseline=null;update.textContent='';chip.classList.remove('has-update');try{baseline=await(await target().getFile()).text();}catch(e){notify(e.message);}await scan();}
  async function establish(handle){const found=await findBuildDirectory(handle);root=handle;dir=found;saves=[];selected='';list.replaceChildren();expected=baseline=null;await scan();if(target())baseline=await(await target().getFile()).text();}
  choose.onclick=async()=>{if(!window.showDirectoryPicker){notify('连接游戏目录需要使用 Edge 或 Chrome 打开此页面；另存为仍可下载 JSON。');return;}try{const handle=await window.showDirectoryPicker({mode:'readwrite',id:'nikki-game-directory'});await establish(handle);await handleStore('put',handle).catch(()=>{});notify('游戏目录已连接，请载入目标存档，或保存当前工作区到所选目标。');}catch(e){if(e.name!=='AbortError')notify('连接失败：'+e.message);}finally{render();}};
  chip.onclick=()=>{if(!dir)return choose.click();if(popover.hidden)render();openPopover(popover.hidden);};
  document.addEventListener('pointerdown',event=>{if(!popover.hidden&&!wrap.contains(event.target))openPopover(false);});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!popover.hidden){openPopover(false);chip.focus();}});
  load.onclick=async()=>{if(busy||!target())return;if(getDocument()?.dirty&&!confirm('当前工作区有未保存修改，载入游戏存档会替换这些修改。继续载入？'))return;busy=true;render();try{const handle=target(),text=await(await handle.getFile()).text();const raw=JSON.parse(text);await loadDocument(raw,handle.name);fileHandle=null;expected=baseline=text;update.textContent='';notify('已载入游戏存档：'+handle.name);openPopover(false);}catch(e){notify('载入失败：'+e.message);}finally{busy=false;render();}};
  save.onclick=async()=>{if(busy||!target()||!isReady())return;const doc=getDocument(),revision=doc.revision,handle=target();try{if(await handle.requestPermission({mode:'readwrite'})!=='granted')throw Error('未获得存档写入权限');const original=await(await handle.getFile()).text();if(expected!==null&&original!==expected||baseline!==null&&original!==baseline)throw Error('游戏存档已更新，请先重新载入');validate(async(data,corrected)=>{if(getDocument()!==doc||doc.revision!==revision)throw Error('工作区已经改变，请重新保存');busy=true;render();try{const prepared=reserveSaveIdentities(localStorage,handle.name,data,JSON.parse(original));const text=JSON.stringify(prepared.data,null,2);await writeGameSave(dir,handle,text,original);expected=baseline=text;update.textContent='';onSaved(doc,revision,corrected,handle.name);notify('已保存到游戏存档：'+handle.name+'；原文件已备份到 NikkiStudioBackups。');}finally{busy=false;render();}},'保存到游戏存档：'+handle.name);}catch(e){notify('保存失败：'+e.message);}};
  saveAs.onclick=async()=>{if(!isReady())return;const doc=getDocument(),revision=doc.revision;try{validate(async(data,corrected)=>{if(getDocument()!==doc||doc.revision!==revision)throw Error('工作区已经改变，请重新保存');const text=JSON.stringify(await prepareExport(data,doc,revision),null,2);const written=await writeAs(text,doc.name.replace(/\.json$/i,'')+(corrected?'_validated':'_edited')+'.json');onSaved(doc,revision,corrected,written.name);notify(written.downloaded?'已提交存档下载，请在浏览器下载列表确认文件。':'已另存为：'+written.name);},'另存为存档');}catch(e){if(e.name!=='AbortError')notify('另存为失败：'+e.message);}};
  saveDoc.onclick=async()=>{if(!isReady())return;if(!fileHandle)return saveAs.click();const doc=getDocument(),revision=doc.revision,name=fileHandle.name;try{validate(async(data,corrected)=>{if(getDocument()!==doc||doc.revision!==revision)throw Error('工作区已经改变，请重新保存');await write(fileHandle,JSON.stringify(await prepareExport(data,doc,revision),null,2));onSaved(doc,revision,corrected,name);notify('已保存：'+name);},'保存存档');}catch(e){if(e.name!=='AbortError')notify('保存失败：'+e.message);}};
  importBtn.onclick=async()=>{if(!window.showOpenFilePicker)return document.querySelector('#save').click();try{const[handle]=await window.showOpenFilePicker({types:JSON_TYPES,multiple:false});const file=await handle.getFile();const raw=JSON.parse(await file.text());fileHandle=handle;await loadDocument(raw,file.name);notify('已打开存档：'+file.name);}catch(e){if(e.name!=='AbortError')notify('打开失败：'+e.message);}};
  async function poll(){
    if(!dir||busy||polling||document.hidden)return;
    polling=true;
    try{
      await scan();
      let stale=false;
      if(target()){const text=await(await target().getFile()).text();if(baseline!==null&&text!==baseline)stale=true;}
      chip.classList.toggle('has-update',stale);
      if(stale)update.textContent='检测到游戏存档已更新，载入会以游戏内的版本为准。';
    }catch(e){update.textContent='目录读取失败，请重新选择游戏目录';}
    finally{polling=false;}
  }
  setInterval(poll,2500);
  handleStore('get').then(async handle=>{if(handle&&await handle.queryPermission({mode:'readwrite'})==='granted')await establish(handle);else if(handle)chipText.textContent='游戏目录授权待恢复';}).catch(()=>{});
  render();return {refresh:render};
}
