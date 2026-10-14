// Editor transform axes: x=Pitch, y=Yaw, z=Roll (save semantics).
export function constrainBuildTransform(value,constraint,mode){
  if(!constraint)return value;
  const next=structuredClone(value);
  if(mode==='scale'||mode==='properties')for(const axis of ['x','y','z'])next.scale[axis]=Math.max(constraint.scaleRange[0],Math.min(constraint.scaleRange[1],next.scale[axis]));
  if(mode==='rotate'||mode==='rotation'||mode==='properties'){
    if(!constraint.rotationAllowed.x)next.rotation.z=0;
    if(!constraint.rotationAllowed.y)next.rotation.x=0;
  }
  return next;
}
export function installBuildLegality({onChange}){
  const label=document.createElement('label');label.title='按每件物品的游戏规则限制缩放和旋转；关闭后自由编辑';
  const toggle=document.createElement('input');toggle.type='checkbox';toggle.id='buildLegality';
  try{toggle.checked=localStorage.getItem('nikki.buildLegality')!=='false';}catch{toggle.checked=true;}
  label.append(toggle,document.createTextNode('建造合法性'));document.querySelector('#space').after(label);
  const hint=document.createElement('p');hint.id='buildLegalityHint';hint.className='property-note';document.querySelector('#selectedMeta').after(hint);
  const style=document.createElement('style');style.textContent='#properties input:disabled{opacity:.45;cursor:not-allowed}#properties [hidden]{display:none!important}';document.head.append(style);
  let rules=null,error=null;
  const ready=fetch('/save_validation_rules.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json();}).then(data=>{rules=data.constraints;onChange();}).catch(e=>{error=e.message;onChange();});
  toggle.onchange=()=>{try{localStorage.setItem('nikki.buildLegality',String(toggle.checked));}catch{}onChange();};
  return{ready,get enabled(){return toggle.checked;},get available(){return !!rules;},constraint:id=>rules?.[String(id)],
    constrain(id,value,mode){return toggle.checked?constrainBuildTransform(value,rules?.[String(id)],mode):value;},
    decorate(ids){
      const selected=ids.map(id=>rules?.[String(id)]),c=selected[0];
      if(!toggle.checked)hint.textContent='自由编辑 · 已关闭物品缩放和旋转限制';
      else if(!rules)hint.textContent=error?'合法性规则加载失败：'+error+'；缩放与旋转已暂停':'正在载入合法性规则…';
      else if(ids.length>1)hint.textContent=`建造合法性已开启 · 按各物品规则限制，多选旋转保持整体布局${selected.some(c=>!c)?' · 部分物品缺少规则':''}`;
      else if(!c)hint.textContent='此物品缺少约束数据，暂不能限制；导出检查会标记待确认';
      else hint.textContent=`合法缩放 ${c.scaleRange.map(v=>Number(v.toFixed(3))).join('–')} 倍 · ${c.rotationAllowed.x?'允许':'禁止'} Roll · ${c.rotationAllowed.y?'允许':'禁止'} Pitch · 允许 Yaw`;
      for(const input of document.querySelectorAll('#properties [data-field]')){
        const [kind,axis]=input.dataset.field.split('.');input.disabled=toggle.checked&&(!rules&&kind!=='position'||!!c&&(kind==='rotation'&&(axis==='z'&&!c.rotationAllowed.x||axis==='x'&&!c.rotationAllowed.y)||kind==='scale'&&c.scaleRange[0]===c.scaleRange[1]));
        input.parentElement.hidden=input.disabled;
        if(kind==='scale'){input.min=toggle.checked&&c?c.scaleRange[0]:.0001;if(toggle.checked&&c)input.max=c.scaleRange[1];else input.removeAttribute('max');}
      }
      for(const kind of ['rotation','scale']){const host=document.querySelector('#'+kind+'Fields'),visible=[...host.children].filter(label=>!label.hidden).length;host.hidden=host.children.length>0&&!visible;host.previousElementSibling.hidden=host.hidden;host.style.gridTemplateColumns=`repeat(${Math.max(1,visible)},minmax(0,1fr))`;}
    }};
}
