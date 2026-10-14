import {decodeDyeColors,dyeColorsForRow} from './furniture_dye.js';

export function installDyePanel({host,configFor,onChange}){
  let generation=0,busy=false,last=[];
  async function render(nodes){
    last=[...nodes];const token=++generation;host.replaceChildren();host.hidden=!nodes.length;
    if(!nodes.length)return;
    const heading=document.createElement('div');heading.className='property-heading';heading.textContent='染色';host.append(heading);
    const note=document.createElement('p');note.className='property-note';host.append(note);
    if(new Set(nodes.map(n=>String(n.userData.id))).size>1){note.textContent='批量染色请选中同款物品；不同物品的配色区域各不相同。';return;}
    note.textContent='正在读取游戏配色…';
    try{
      const config=await configFor(nodes[0].userData.id);if(token!==generation)return;
      if(!config||!Object.keys(config).length){note.textContent='此物品暂无可用染色配置。';return;}
      note.textContent=(nodes.length>1?`将修改选中的 ${nodes.length} 件同款物品。`:'点击配色立即预览。')+' 可撤销，导出时保留配色。';
      for(const [area,choices] of Object.entries(config)){
        const section=document.createElement('div');section.className='dye-area';
        const label=document.createElement('strong');label.textContent=Number(area)===0?'整体配色':`区域 ${area}`;section.append(label);
        const values=nodes.map(n=>decodeDyeColors(dyeColorsForRow(n.userData.raw)).get(Number(area))??0),mixed=new Set(values).size>1;
        if(mixed){const hint=document.createElement('small');hint.textContent='当前配色不同';section.append(hint);}
        const cards=document.createElement('div');cards.className='dye-cards';
        for(const index of [...new Set([0,...Object.keys(choices).map(Number)])].sort((a,b)=>a-b)){
          const entry=choices[index],button=document.createElement('button');button.type='button';button.className='dye-card';
          const text=index===0?'默认':`配色 ${index}`;
          button.title=text;button.setAttribute('aria-label',`${label.textContent} · ${text}`);button.setAttribute('aria-pressed',String(!mixed&&values[0]===index));button.disabled=busy;
          if(entry?.idx!==undefined){const icon=document.createElement('img');icon.src=`/dye_icons/${entry.idx}.png`;icon.alt='';icon.loading='lazy';button.append(icon);}
          else {const icon=document.createElement('span');icon.className='dye-default';icon.textContent='↺';button.append(icon);}
          const caption=document.createElement('span');caption.textContent=text;button.append(caption);
          button.onclick=async()=>{
            if(busy)return;busy=true;host.querySelectorAll('button').forEach(b=>b.disabled=true);
            try{await onChange(Number(area),index,[...nodes]);}finally{busy=false;await render(last);}
          };
          cards.append(button);
        }
        section.append(cards);host.append(section);
      }
    }catch(error){if(token===generation)note.textContent='配色加载失败：'+error.message;}
  }
  return {render};
}
