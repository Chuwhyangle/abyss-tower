// 缺资源回退：默认加载器、加载结果归一、告警去重与内存预算裁剪策略。
// 任何资源不可用时调用方继续走程序化绘制，画面与接入前逐像素一致。
// 导入期不触碰 document / Image / fetch（Node 下可直接 import）。
import { dprVariants } from './sprite-manifest.js';

// 浏览器默认加载器：只在被调用时引用 Image，模块求值期保持无 DOM。
export function createImageLoader() {
  return (url) =>
    new Promise((resolve, reject) => {
      if (typeof Image === 'undefined') {
        reject(new Error(`当前环境没有 Image，无法加载精灵：${url}`));
        return;
      }
      const image = new Image();
      image.onload = () =>
        resolve({
          image,
          width: image.naturalWidth || image.width,
          height: image.naturalHeight || image.height,
        });
      image.onerror = () => reject(new Error(`精灵文件加载失败：${url}`));
      image.src = url;
    });
}

// 默认 JSON 加载（清单与图集 JSON 共用）：只在被调用时引用 fetch。
export async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`JSON 获取失败：${url}（HTTP ${response.status}）`);
  return response.json();
}

export function toPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

// 统一加载结果：默认加载器给 { image, width, height }，内置对象也行。
export function normalizeLoad(raw, url) {
  const image = raw && typeof raw === 'object' && raw.image ? raw.image : raw;
  const width = toPositiveNumber(raw?.width ?? raw?.naturalWidth ?? image?.naturalWidth ?? image?.width);
  const height = toPositiveNumber(raw?.height ?? raw?.naturalHeight ?? image?.naturalHeight ?? image?.height);
  if (!image || !width || !height) throw new Error(`加载结果缺少可用尺寸：${url}`);
  const bytes = typeof raw?.bytes === 'number' && raw.bytes >= 0 ? raw.bytes : width * height * 4;
  return { image, width, height, bytes };
}

// 告警去重：同一 key 只报一次；告警渠道自身异常不得影响加载流程。
export function warnOnce(warned, warnFn, key, message) {
  if (warned.has(key)) return;
  warned.add(key);
  try {
    warnFn(message);
  } catch {
    /* 告警渠道异常不得影响加载流程 */
  }
}

// 内存预算的第一档回退：已就绪的 @2x 条目若存在 @1x 变体，就降档重载。
export function downgradeCandidates(records) {
  const out = [];
  for (const record of records) {
    if (record.state !== 'ready' || record.variant <= 1) continue;
    if (!dprVariants(record.spec).includes(1)) continue;
    out.push(record);
  }
  return out;
}

// 内存预算的第二档回退：仍超预算时逐个丢弃最大的已就绪条目（字节数为 0 的无法再释放）。
export function budgetVictim(records) {
  const ready = [...records].filter((record) => record.state === 'ready');
  const victim = ready.sort((a, b) => b.bytes - a.bytes)[0];
  if (!victim || !(victim.bytes > 0)) return null;
  return victim;
}
