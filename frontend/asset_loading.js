// Bounded work queues keep decoding and image allocation from flooding the UI.
performance.setResourceTimingBufferSize(5000);
export function createQueue(limit) {
  let active = 0;
  const pending = [];
  function pump() {
    while (active < limit && pending.length) {
      const {task, resolve, reject} = pending.shift(); active++;
      Promise.resolve().then(task).then(resolve, reject).finally(() => {active--; pump();});
    }
  }
  const enqueue=task => new Promise((resolve, reject) => {pending.push({task, resolve, reject}); pump();});
  enqueue.cancelPending=()=>{const error=new Error('已切换存档，取消旧的排队资源请求');error.name='AbortError';for(const task of pending.splice(0))task.reject(error);};
  return enqueue;
}
export const modelQueue = createQueue(6), textureQueue = createQueue(12);
export const loadingMetrics = {cacheHits:0, downloads:0, cacheState:'初始化', bytes:0};
export const assetManifest = Promise.all([
  fetch('/asset_versions.json',{cache:'no-store'}).then(r=>r.ok?r.json():{}).catch(()=>({})),
  fetch('/texture_lod_manifest.json',{cache:'no-store'}).then(r=>r.ok?r.json():{}).catch(()=>({}))
]).then(([models,textures])=>({models,textures}));
let persistent;
async function storage() {
  if (!persistent) persistent = (async()=>{
    try {const c=await caches.open('nikki-furniture-assets-v1'); loadingMetrics.cacheState='可用'; return c;}
    catch {loadingMetrics.cacheState='不可用，使用浏览器缓存'; return null;}
  })();
  return persistent;
}
export async function assetResponse(url, version) {
  const request = new Request(version ? url+(url.includes('?')?'&':'?')+'v='+encodeURIComponent(version) : url);
  if(url.startsWith('/asset/')||url.startsWith('/cached-asset/')||url.startsWith('/api/texture-png/')){
    const response=await fetch(request,{cache:'force-cache'});
    if(!response.ok)throw new Error('资源请求失败 '+response.status+' '+url);
    loadingMetrics.downloads++;loadingMetrics.bytes+=Number(response.headers.get('content-length')||0);
    loadingMetrics.cacheState='版本化 HTTP 缓存';return response;
  }
  const c = await storage();
  if(c){const hit=await c.match(request).catch(()=>null);if(hit){loadingMetrics.cacheHits++;return hit;}}
  const response = await fetch(request);
  if(!response.ok)throw new Error('资源请求失败 '+response.status+' '+url);
  loadingMetrics.downloads++; loadingMetrics.bytes+=Number(response.headers.get('content-length')||0);
  // Quota/disabled storage must never prevent rendering. Versions invalidate changed exports.
  if(c)c.put(request,response.clone()).catch(()=>{loadingMetrics.cacheState='空间不足，使用浏览器缓存';});
  return response;
}
export async function modelBuffer(url) {
  const {models}=await assetManifest;
  return (await assetResponse(url,models[url])).arrayBuffer();
}
export async function textureBlob(url, quality='preview') {
  const {textures}=await assetManifest, desc=textures[url];
  const target=quality==='preview'&&desc ? desc.preview : url;
  try{return await (await assetResponse(target,desc?.version)).blob();}
  catch(e){if(target===url)throw e;return (await assetResponse(url,desc?.version)).blob();}
}
export async function textureBuffer(url){return (await assetResponse(url)).arrayBuffer();}
