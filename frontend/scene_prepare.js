export async function prepareScene(entries, progress) {
  const session=await fetch('/api/session',{cache:'no-store'}).then(r=>r.json());
  const items=[...new Set(entries.map(row=>String(row.id)))].map(id=>({id}));
  const response=await fetch('/api/prepare-scene',{method:'POST',headers:{'Content-Type':'application/json','X-Nikki-Token':session.token},body:JSON.stringify({items})});
  const started=await response.json();
  if(!response.ok)throw Error(started.error??'场景资源准备失败');
  const waitForResult=async(onGeometry)=>{while(true){
    const [job,status]=await Promise.all([
      fetch('/api/scene-result',{cache:'no-store'}).then(r=>r.json()),
      fetch('/api/status?fast=1',{cache:'no-store'}).then(r=>r.json())
    ]);
    if(job.id!==started.id)throw Error('场景资源任务已变化');
    progress(status.scene?.message??'正在准备资源');
    if(onGeometry&&job.geometry){return {...job.geometry,completion:waitForResult(false)};}
    if(!job.running){if(job.result?.error)throw Error(job.result.error);return job.result;}
    await new Promise(resolve=>setTimeout(resolve,250));
  }};
  return waitForResult(true);
}
