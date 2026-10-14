import {notify,dismissNotice} from './notices.js';
async function check(){try{
  const s=await fetch('/api/status').then(r=>r.json());
  if(s.changed){
    notify('游戏资源发生变化；请重新校验。旧缓存保留。',{key:'resources',level:'warn',action:{label:'打开资源配置',href:'/setup.html'}});
    document.getElementById('saveGame').disabled=true;
  }else dismissNotice('resources');
}catch{
  notify('本地资源服务已断开',{key:'service',level:'error'});
}}
check();setInterval(check,5000);
