// 载入结果指示。只有预览确实和游戏不一致时才出现——失败、占位、待校准三类；
// 多轴旋转只是「模型对、姿态可能不同」的常量说明，每次报警会变成噪声，只列进明细。
// 明细放在浮层里，视口底部不再常驻一整行说明。
export function installSceneStatus(){
  const host=document.querySelector('.document-status');
  if(!host)return{update(){}};
  const wrap=document.createElement('div');wrap.className='scene-status-wrap';wrap.hidden=true;
  wrap.innerHTML='<button type="button" class="scene-status" aria-haspopup="true" aria-expanded="false"><span class="scene-status-icon" aria-hidden="true">!</span><span class="scene-status-count"></span></button><div class="scene-status-popover" hidden><strong>载入结果</strong><p class="scene-status-counts"></p><ul class="scene-status-issues"></ul></div>';
  host.prepend(wrap);
  const chip=wrap.querySelector('.scene-status'),pop=wrap.querySelector('.scene-status-popover'),counts=wrap.querySelector('.scene-status-counts'),issues=wrap.querySelector('.scene-status-issues');
  const open=value=>{pop.hidden=!value;chip.setAttribute('aria-expanded',String(value));};
  chip.onclick=()=>open(pop.hidden);
  document.addEventListener('pointerdown',event=>{if(!pop.hidden&&!wrap.contains(event.target))open(false);});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!pop.hidden){open(false);chip.focus();}});
  return{update({total=0,matched=0,missing=0,failed=0,partial=0,tilted=0}={}){
    const problems=failed+missing+partial;
    counts.textContent=`共 ${total} 件物品 · 真实模型 ${matched} · 占位 ${missing} · 模型加载失败 ${failed} · 特殊物品待校准 ${partial} · 多轴旋转 ${tilted}`;
    const rows=[];
    if(failed)rows.push(`${failed} 件模型加载失败，场景中不显示。`);
    if(missing)rows.push(`${missing} 件未匹配到模型，当前以占位显示。`);
    if(partial)rows.push(`${partial} 件特殊物品待校准，外观可能与游戏不同。`);
    if(tilted)rows.push(`${tilted} 件多轴旋转，运行时姿态可能与游戏不同；模型本身正确。`);
    issues.replaceChildren(...rows.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
    wrap.hidden=problems===0;
    if(!problems)open(false);
    chip.querySelector('.scene-status-count').textContent=String(problems);
    chip.classList.toggle('is-error',failed>0);
    chip.title=rows[0]??'';
  }};
}
