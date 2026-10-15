// Transient notices along the bottom edge, centred. `info`/`success` fade on their own;
// `warn`/`error` stay until the condition clears or the user closes them, because
// missing a "the game changed, re-validate" notice silently produces wrong exports.
const LEVEL_CLASS = {info: 'notice-info', success: 'notice-success', warn: 'notice-warn', error: 'notice-error'};
const AUTO_DISMISS = {info: 4000, success: 4000, warn: 0, error: 0};
const LEAVE_MS = 180;
const live = new Map();
let host = null;
let sequence = 0;

function ensureHost() {
  if (host?.isConnected) return host;
  host = document.createElement('div');
  host.className = 'notice-host';
  host.setAttribute('role', 'status');
  host.setAttribute('aria-live', 'polite');
  document.body.append(host);
  return host;
}

export function dismissNotice(key) {
  const entry = live.get(key);
  if (!entry) return false;
  live.delete(key);
  clearTimeout(entry.timer);
  entry.node.classList.add('notice-leaving');
  entry.node.addEventListener('transitionend', () => entry.node.remove(), {once: true});
  setTimeout(() => entry.node.remove(), LEAVE_MS * 3);
  return true;
}

function control(className, label, onClick) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.textContent = label;
  if (className === 'notice-close') node.setAttribute('aria-label', '关闭提示');
  node.addEventListener('click', onClick);
  return node;
}

export function notify(message, {key, level = 'info', timeout, action} = {}) {
  const id = key ?? `auto:${++sequence}`;
  dismissNotice(id);
  const node = document.createElement('div');
  node.className = `notice ${LEVEL_CLASS[level] ?? LEVEL_CLASS.info}`;
  node.dataset.key = id;
  const body = document.createElement('span');
  body.className = 'notice-body';
  body.textContent = message;
  node.append(body);
  if (action) {
    const target = document.createElement(action.href ? 'a' : 'button');
    target.className = 'notice-action';
    target.textContent = action.label;
    if (action.href) {
      target.href = action.href;
      target.target = '_blank';
      target.rel = 'noopener';
    } else {
      target.type = 'button';
      target.addEventListener('click', () => { action.onClick?.(); dismissNotice(id); });
    }
    node.append(target);
  }
  node.append(control('notice-close', '✕', () => dismissNotice(id)));
  ensureHost().append(node);
  const ttl = timeout ?? AUTO_DISMISS[level] ?? 0;
  const entry = {node, timer: ttl > 0 ? setTimeout(() => dismissNotice(id), ttl) : 0};
  live.set(id, entry);
  return id;
}
