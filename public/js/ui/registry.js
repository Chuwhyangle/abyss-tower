// UI 面板注册表：面板模块在自身作用域自注册安装函数，入口只负责「按序装载 + 统一挂载」。
// 面板不 import ui.js：ui 实例经 mount 的参数注入，避免「门面 ↔ 面板」的静态环。
// 新增面板 = 自己的文件里 registerPanel + ui/bootstrap.js 清单加一行，不碰 ui.js / index.html。
const panels = new Map();
let mounted = false;

export function registerPanel(id, mount) {
  if (typeof id !== 'string' || id.length === 0) throw new Error('registerPanel: id required');
  if (typeof mount !== 'function') throw new Error(`registerPanel: mount must be a function (${id})`);
  panels.set(id, mount);
}

export function panelIds() {
  return [...panels.keys()];
}

// 仅供测试隔离：清空注册与挂载状态。
export function resetPanels() {
  panels.clear();
  mounted = false;
}

// order 由入口清单给出，保持与拆分前 index.html 一致的固定装载顺序；
// 未给出时按注册顺序挂载（动态 import 的完成顺序不确定，入口应始终传 order）。
export function mountPanels(context = {}, order = null) {
  if (mounted || typeof document === 'undefined') return false;
  mounted = true;
  const ids = Array.isArray(order) && order.length > 0 ? order : [...panels.keys()];
  const run = () => {
    for (const id of ids) {
      const mount = panels.get(id);
      if (!mount) continue;
      try {
        mount(context);
      } catch (error) {
        console.error('[ui] panel mount failed', id, error);
      }
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
  return true;
}
