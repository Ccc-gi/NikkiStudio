import {validateItems} from './save_validation.js';
let rules;
self.onmessage=async({data})=>{try{rules??=await fetch('/save_validation_rules.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('检查规则加载失败');return r.json()});self.postMessage({request:data.request,result:validateItems(data.items,rules,{name:data.name})});}catch(e){self.postMessage({request:data.request,error:e.message});}};
