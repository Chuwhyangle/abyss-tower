// 渲染器注册表：渲染器模块在自身作用域自注册构造类，render.js 只按 id 创建实例，
// 不再逐个静态 import 具体渲染器。新增渲染器 = 自己的文件里 registerRenderer + 清单加一行。
const renderers = new Map();

export function registerRenderer(id, Renderer) {
  if (typeof id !== 'string' || id.length === 0) throw new Error('registerRenderer: id required');
  if (typeof Renderer !== 'function') throw new Error(`registerRenderer: class expected (${id})`);
  renderers.set(id, Renderer);
}

export function createRenderer(id, ...args) {
  const Renderer = renderers.get(id);
  if (!Renderer) throw new Error(`unknown renderer: ${id}`);
  return new Renderer(...args);
}

export function rendererIds() {
  return [...renderers.keys()];
}

// 仅供测试隔离：清空注册状态。
export function resetRenderers() {
  renderers.clear();
}
