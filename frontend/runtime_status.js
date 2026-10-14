const notice=document.querySelector('#runtimeNotice');
const recovery=new URLSearchParams(location.search).has('recovery');
async function check(){try{const s=await fetch('/api/status').then(r=>r.json());if(s.changed){notice.replaceChildren(document.createTextNode('游戏资源发生变化；请重新校验。旧缓存保留。 '));const link=document.createElement('a');link.href='/setup.html';link.textContent='打开资源配置';link.style.color='#8ce0c5';notice.append(link);document.getElementById('saveGame').disabled=true;}else if(!recovery){notice.dataset.version=s.version??'';}}catch{notice.textContent='本地资源服务已断开';}}
check();setInterval(check,5000);
