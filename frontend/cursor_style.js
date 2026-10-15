// 光标外观：大喵猫爪 或 系统光标。
// 初始状态由页面 <head> 的内联脚本读 localStorage 挂到 <html>，避免首帧闪一下猫爪；
// 这里只负责设置项本身，并以 <html> 上的类作为运行时的唯一事实来源。
const CLASS = 'system-cursor';

export function installCursorStyle() {
  const select = document.getElementById('cursorStyle');
  if (!select) return;
  select.value = document.documentElement.classList.contains(CLASS) ? 'system' : 'paw';
  select.onchange = () => {
    document.documentElement.classList.toggle(CLASS, select.value === 'system');
    try { localStorage.setItem('nikki.cursorStyle', select.value); } catch {}
  };
}
