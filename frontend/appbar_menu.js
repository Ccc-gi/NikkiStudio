// 顶栏菜单（文件 / 游戏）。<details> 自身只负责展开收起，这里补上菜单该有的关闭行为：
// 点中任意一项后收起、点击外部收起、Esc 收起，以及同时只展开一个菜单。
export function installAppbarMenu(){
  const menus=[...document.querySelectorAll('.appbar-menu')];
  if(!menus.length)return;
  const closeOthers=menu=>{for(const other of menus)if(other!==menu)other.open=false;};
  for(const menu of menus){
    // <details> 的 toggle 事件是异步派发的，用它互斥会被连点时序搞乱；
    // click 时 open 还是旧值，未打开即表示「这次点击要展开」。
    menu.querySelector('summary').addEventListener('click',()=>{if(!menu.open)closeOthers(menu);});
    menu.addEventListener('click',event=>{if(event.target.closest('button'))menu.open=false;});
  }
  document.addEventListener('pointerdown',event=>{for(const menu of menus)if(menu.open&&!menu.contains(event.target))menu.open=false;});
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape')return;
    for(const menu of menus)if(menu.open){menu.open=false;menu.querySelector('summary').focus();}
  });
}
