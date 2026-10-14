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
  const choose=document.querySelector('#chooseGameDirectory'),save=document.querySelector('#saveGame'),saveAs=document.querySelector('#exportSave');
  const bar=document.createElement('div');bar.className='game-file-bar';bar.innerHTML='<span id="gameDirectoryStatus">未连接游戏目录</span><select id="gameSaveTarget" aria-label="游戏存档目标"></select><button id="loadGameSave">载入游戏存档</button><span id="gameFileUpdate" role="status"></span>';
  document.querySelector('.appbar').after(bar);
  const label=bar.querySelector('#gameDirectoryStatus'),select=bar.querySelector('select'),load=bar.querySelector('button'),update=bar.querySelector('#gameFileUpdate');
  let dir=null,root=null,saves=[],expected=null,baseline=null,busy=false,polling=false;
  const target=()=>saves.find(s=>s.name===select.value)?.handle;
  function render(){select.hidden=load.hidden=!dir;save.disabled=!dir||!target()||busy||!isReady();load.disabled=busy||!target();choose.disabled=busy;}
  async function scan(){const previous=select.value,hadSaves=saves.length>0;saves=await listGameSaves(dir);select.replaceChildren(...saves.map(s=>{const o=document.createElement('option');o.value=s.name;o.textContent=s.name;return o;}));if(saves.some(s=>s.name===previous))select.value=previous;else if(previous||hadSaves){select.value='';expected=baseline=null;update.textContent='原目标存档已移除，请确认新的目标';}label.textContent=root.name+' / BuildData'+(saves.length?'':' · 未检测到正式存档，请先在游戏中导出');render();}
  async function establish(handle){const found=await findBuildDirectory(handle);root=handle;dir=found;saves=[];select.replaceChildren();expected=baseline=null;await scan();if(target())baseline=await(await target().getFile()).text();}
  choose.onclick=async()=>{if(!window.showDirectoryPicker){notify('连接游戏目录需要使用 Edge 或 Chrome 打开此页面；另存为仍可下载 JSON。');return;}try{const handle=await window.showDirectoryPicker({mode:'readwrite',id:'nikki-game-directory'});await establish(handle);await handleStore('put',handle).catch(()=>{});notify('游戏目录已连接，请载入目标存档，或保存当前工作区到所选目标。');}catch(e){if(e.name!=='AbortError')notify('连接失败：'+e.message);}finally{render();}};
  select.onchange=async()=>{expected=baseline=null;update.textContent='';try{baseline=await(await target().getFile()).text();}catch(e){notify(e.message);}render();};
  load.onclick=async()=>{if(busy||!target())return;if(getDocument()?.dirty&&!confirm('当前工作区有未保存修改，载入游戏存档会替换这些修改。继续载入？'))return;busy=true;render();try{const handle=target(),text=await(await handle.getFile()).text();const raw=JSON.parse(text);await loadDocument(raw,handle.name);expected=baseline=text;update.textContent='';notify('已载入游戏存档：'+handle.name);}catch(e){notify('载入失败：'+e.message);}finally{busy=false;render();}};
  save.onclick=async()=>{if(busy||!target()||!isReady())return;const doc=getDocument(),revision=doc.revision,handle=target();try{if(await handle.requestPermission({mode:'readwrite'})!=='granted')throw Error('未获得存档写入权限');const original=await(await handle.getFile()).text();if(expected!==null&&original!==expected||baseline!==null&&original!==baseline)throw Error('游戏存档已更新，请先重新载入');validate(async(data,corrected)=>{if(getDocument()!==doc||doc.revision!==revision)throw Error('工作区已经改变，请重新保存');busy=true;render();try{const prepared=reserveSaveIdentities(localStorage,handle.name,data,JSON.parse(original));const text=JSON.stringify(prepared.data,null,2);await writeGameSave(dir,handle,text,original);expected=baseline=text;update.textContent='';onSaved(doc,revision,corrected,handle.name);notify('已保存到游戏存档：'+handle.name+'；原文件已备份到 NikkiStudioBackups。');}finally{busy=false;render();}},'保存到游戏存档：'+handle.name);}catch(e){notify('保存失败：'+e.message);}};
  saveAs.onclick=async()=>{if(!isReady())return;const doc=getDocument(),revision=doc.revision;let handle=null;try{validate(async(data,corrected)=>{if(getDocument()!==doc||doc.revision!==revision)throw Error('工作区已经改变，请重新保存');let output=data;if(target()){const exportTarget=target(),current=await(await exportTarget.getFile()).text();if(getDocument()!==doc||doc.revision!==revision||target()!==exportTarget)throw Error('工作区或目标已经改变，请重新导出');if(baseline!==null&&current!==baseline)throw Error('游戏存档已更新，请重新连接目录后再导出');output=reserveSaveIdentities(localStorage,exportTarget.name,data,JSON.parse(current)).data;}const text=JSON.stringify(output,null,2);if(handle){const writable=await handle.createWritable();try{await writable.write(text);await writable.close();}catch(e){await writable.abort().catch(()=>{});throw e;}onSaved(doc,revision,corrected,handle.name);notify('已另存为：'+handle.name);}else{const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=doc.name.replace(/\.json$/i,'')+(corrected?'_validated':'_edited')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('已提交存档下载，请在浏览器下载列表确认文件。');}},'另存为存档');}catch(e){if(e.name!=='AbortError')notify('另存为失败：'+e.message);}};
  async function poll(){if(!dir||busy||polling||document.hidden)return;polling=true;try{await scan();if(target()){const text=await(await target().getFile()).text();if(baseline!==null&&text!==baseline)update.textContent='检测到游戏存档更新 · 点击载入游戏存档';}}catch(e){update.textContent='目录读取失败，请重新选择游戏目录';}finally{polling=false;}}
  setInterval(poll,2500);
  handleStore('get').then(async handle=>{if(handle&&await handle.queryPermission({mode:'readwrite'})==='granted')await establish(handle);else if(handle)label.textContent='游戏目录授权待恢复 · 点击选择游戏目录';}).catch(()=>{});
  render();return {refresh:render};
}
