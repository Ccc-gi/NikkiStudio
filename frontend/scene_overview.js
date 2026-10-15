export function groupSceneItems(rows,isVisible){
  const groups=new Map();for(const row of rows){const id=String(row.id);if(!groups.has(id))groups.set(id,{id,name:row.name,rows:[]});groups.get(id).rows.push(row);}
  return [...groups.values()].map(group=>({...group,visible:group.rows.filter(isVisible).length}));
}

export function installSceneOverview({list,isVisible,setVisibility,locate,selected,makePreview,onRender}){
  const bar=document.createElement('div');bar.className='scene-overview-tools';bar.hidden=true;list.before(bar);
  const filters=document.createElement('div');filters.className='scene-visibility-filters';bar.append(filters);
  let filter='all',rows=[],allRows=[],expanded=new Set(),searching=false;
  for(const [key,name] of [['all','全部'],['visible','可见'],['hidden','已隐藏']]){const b=document.createElement('button');b.dataset.visibilityFilter=key;b.onclick=()=>{filter=key;render();};filters.append(b);}
  // 批量显示与隐藏收进右侧菜单，让统计和三个入口保持在同一行。
  const menu=document.createElement('details');menu.className='scene-visibility-menu';
  const summary=document.createElement('summary');summary.textContent='⋯';summary.title='批量显示与隐藏';summary.setAttribute('aria-label','批量显示与隐藏');menu.append(summary);
  const actions=document.createElement('div');actions.className='scene-visibility-actions';menu.append(actions);bar.append(menu);
  for(const [name,visible,all] of [['显示筛选结果',true,false],['隐藏筛选结果',false,false],['显示全部',true,true]]){const b=document.createElement('button');b.textContent=name;b.onclick=()=>{menu.open=false;setVisibility((all?allRows:filtered()).map(r=>r.instance),visible);};actions.append(b);}
  document.addEventListener('pointerdown',event=>{if(menu.open&&!menu.contains(event.target))menu.open=false;});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu.open){menu.open=false;summary.focus();}});
  const filtered=()=>rows.filter(r=>filter==='all'||(filter==='visible')===isVisible(r));
  function eye(instances,visible,name,mixed=false){const b=document.createElement('button');b.className='scene-eye';b.textContent=mixed?'◐':visible?'◉':'○';b.title=(visible?'隐藏':'显示')+name;b.setAttribute('aria-label',b.title);b.setAttribute('aria-pressed',String(visible));b.onclick=e=>{e.stopPropagation();setVisibility(instances,!visible);};return b;}
  function render(){
    if(bar.hidden)return;
    const scroll=list.scrollTop,current=filtered(),counts={all:allRows.length,visible:allRows.filter(isVisible).length};counts.hidden=counts.all-counts.visible;
    for(const b of filters.children){const key=b.dataset.visibilityFilter;b.textContent=({all:'全部',visible:'可见',hidden:'已隐藏'})[key]+' '+counts[key];b.classList.toggle('active',filter===key);b.setAttribute('aria-pressed',String(filter===key));}
    const totalGroups=groupSceneItems(allRows,isVisible),visibleGroups=groupSceneItems(current,isVisible),fragment=document.createDocumentFragment();
    for(const group of visibleGroups){
      const entire=totalGroups.find(g=>g.id===group.id),section=document.createElement('section');section.className='scene-item-group';section.dataset.itemId=group.id;
      const head=document.createElement('div');head.className='scene-group-heading';const toggle=document.createElement('button');toggle.className='scene-group-toggle';
      const open=expanded.has(group.id)||searching;toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',`${open?'收起':'展开'} ${group.name} · ${entire.rows.length} 件`);
      makePreview(toggle,group);toggle.setAttribute('aria-label',`${open?'收起':'展开'} ${group.name} · ${entire.rows.length} 件`);const text=document.createElement('span');text.className='scene-group-count';text.textContent=`${open?'▾':'▸'} ${entire.rows.length} 件 · ${entire.visible===entire.rows.length?'全部可见':entire.visible===0?'全部隐藏':`${entire.visible} 可见 / ${entire.rows.length-entire.visible} 隐藏`}`;toggle.append(text);
      toggle.onclick=()=>{searching=false;open?expanded.delete(group.id):expanded.add(group.id);render();};head.append(toggle,eye(entire.rows.map(r=>r.instance),entire.visible>0,`${group.name}整组`,entire.visible>0&&entire.visible<entire.rows.length));section.append(head);
      if(open)for(const row of group.rows){const wrap=document.createElement('div');wrap.className='scene-instance-row';wrap.classList.toggle('is-hidden',!isVisible(row));
        const b=document.createElement('button');b.className='scene-instance-select';b.dataset.index=String(row.index);b.dataset.instance=String(row.instance);b.textContent=`${isVisible(row)?'':'○ '}实例 ${row.instance}`;b.setAttribute('aria-label',`选择 ${row.name}，实例 ${row.instance}`);b.classList.toggle('active',selected(row));b.onclick=e=>locate(row,e.shiftKey||e.ctrlKey||e.metaKey,false);wrap.append(b,eye([row.instance],isVisible(row),`实例 ${row.instance}`));
        if(!isVisible(row)){const reveal=document.createElement('button');reveal.className='scene-reveal';reveal.textContent='显示并定位';reveal.onclick=()=>{setVisibility([row.instance],true);locate(row,false,true);};wrap.append(reveal);}
        section.append(wrap);
      }
      fragment.append(section);
    }
    if(!current.length){const empty=document.createElement('p');empty.className='scene-empty';empty.textContent='当前筛选下没有物品';fragment.append(empty);}
    list.replaceChildren(fragment);list.scrollTop=scroll;onRender(current.length,visibleGroups.length);
  }
  function reveal(index){
    const row=rows.find(r=>r.index===index);if(!row)return false;
    const selector=`.scene-instance-select[data-index="${index}"]`;
    if(!list.querySelector(selector)){if(!filtered().includes(row))filter='all';expanded.add(String(row.id));render();}
    const button=list.querySelector(selector);if(!button)return false;
    const bounds=button.getBoundingClientRect(),viewport=list.getBoundingClientRect();
    if(bounds.top<viewport.top||bounds.bottom>viewport.bottom)list.scrollTop+=bounds.top-viewport.top-list.clientHeight/2+bounds.height/2;
    return true;
  }
  return {render(filteredRows,completeRows,term){rows=filteredRows;allRows=completeRows;searching=Boolean(term);bar.hidden=false;list.classList.remove('resource-grid');render();},hide(){bar.hidden=true;},refresh:render,reveal,syncSelection(){for(const b of list.querySelectorAll('.scene-instance-select'))b.classList.toggle('active',selected({index:Number(b.dataset.index)}));}};
}
