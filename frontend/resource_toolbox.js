import {categoryLabel} from './furniture_categories.js';

export function previewIcon(id,catalog,categories){
  const row=catalog[id],image=document.createElement('img');
  image.src=row?.previewIcon??categories[row?.categoryId]?.icon??'/placeholder.svg';
  image.alt='';image.loading='lazy';image.decoding='async';
  image.onerror=()=>{image.onerror=null;image.src='/placeholder.svg';image.classList.add('fallback-icon');};
  if(!row?.previewIcon)image.classList.add('fallback-icon');
  return image;
}
export function renderToolboxCategories(major,minor,categories,onChange){
  document.querySelector('#subcategoryTools').hidden=!major.value;
  for(const [select,host] of [[major,document.querySelector('#categoryTools')],[minor,document.querySelector('#subcategoryTools')]]){
    host.replaceChildren();
    for(const option of select.options){
      const button=document.createElement('button');button.type='button';button.className='category-tool';
      button.classList.toggle('active',select.value===option.value);button.setAttribute('aria-pressed',String(select.value===option.value));
      button.title=option.textContent;button.setAttribute('aria-label',option.textContent);
      const icon=document.createElement('img');icon.src=categories[option.value]?.icon??'/placeholder.svg';icon.alt='';
      const name=document.createElement('span');name.textContent=option.textContent.replace(/ \(\d+\)$/,'').replace('全部大类','全部资源').replace('全部子类','全部');
      button.append(icon,name);button.onclick=()=>{select.value=option.value;if(select===major)minor.value='';onChange();};host.append(button);
    }
  }
}
export function resourceButtonContents(button,item,library,catalog,categories){
  const image=previewIcon(item.id,catalog,categories),label=document.createElement('span');label.className='resource-label';
  const name=document.createElement('span');name.className='resource-name';name.textContent=item.name;label.append(name);
  if(!library){const info=document.createElement('small');info.textContent=`实例 ${item.instance}`;label.append(info);}
  button.append(image,label);button.title=`${item.name} · ${categoryLabel(catalog[item.id]?.categoryId,categories)} · ID ${item.id}${library?' · 点击添加':` · 实例 ${item.instance}`}`;
  button.setAttribute('aria-label',library?`添加 ${item.name}`:`选择 ${item.name}，实例 ${item.instance}`);
}
