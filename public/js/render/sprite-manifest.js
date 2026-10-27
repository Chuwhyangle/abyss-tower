// 精灵清单的纯数据/纯函数层：归一化、DPR 变体选择与图集切帧。
// 导入期不触碰 document / Image / fetch，Node 与浏览器共用同一份实现。
// 字段与命名的权威定义见 docs/ASSET_PIPELINE.md；本模块只做运行时归一化与几何换算。

export const ANCHORS = Object.freeze(['center', 'foot', 'top-left', 'muzzle']);
export const ENTRY_STATUS = Object.freeze(['placeholder', 'ready', 'deprecated']);
// id 允许两种写法：ASSET_PIPELINE 的 `<类别>/<名称>` 与 PHASE_FEEL_ART §4.1 的
// `<family>.<entity-id>.<state>`；都只允许小写段，拒绝空格/大写/空段。
export const SPRITE_ID_PATTERN = /^[a-z][a-z0-9-]*(?:[./][a-z0-9-]+)+$/;

const DEFAULT_PIVOT = Object.freeze({ x: 0.5, y: 0.5 });
const DEFAULT_SIZE = Object.freeze({ w: 1, h: 1 });

function isPositiveInt(value) {
  return Number.isInteger(value) && value > 0;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// pivot 是归一化坐标：只有 [0, 1] 内的有限数字才算合法（越界即「锚点越界」）。
function inUnitRange(value) {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

// 清单里的 path 是仓库相对路径（文档必填字段），src 是浏览器可直接取的 URL。
// 两者可互相推导：public/assets/x.png ↔ /assets/x.png。
export function srcFromPath(path) {
  if (!nonEmptyString(path)) return null;
  const clean = path.trim().replace(/^\.\//, '');
  if (clean.startsWith('/')) return clean;
  if (clean.startsWith('public/')) return `/${clean.slice('public/'.length)}`;
  return null;
}

export function normalizeDeviceDpr(value) {
  return isFiniteNumber(value) && value > 0 ? value : 1;
}

// 条目声明或从 srcs 推断的 DPR 档位：正数、去重、升序。
export function dprVariants(entry) {
  const raw = Array.isArray(entry?.dpr)
    ? entry.dpr
    : entry?.srcs && typeof entry.srcs === 'object'
      ? Object.keys(entry.srcs)
      : [1];
  const variants = [...new Set(raw.map(Number).filter((value) => isFiniteNumber(value) && value > 0))]
    .sort((a, b) => a - b);
  return variants.length ? variants : [1];
}

// 取不超过设备 DPR 的最高档；没有更低档时回落到条目最低档。
// 设备 DPR 非法（0 / 负数 / NaN / undefined）一律按 1 处理。
export function resolveDprVariant(entry, deviceDpr) {
  const variants = dprVariants(entry);
  const device = normalizeDeviceDpr(deviceDpr);
  let best = null;
  for (const variant of variants) {
    if (variant <= device && (best === null || variant > best)) best = variant;
  }
  return best ?? variants[0];
}

// 归一化单条清单条目；不合法时把原因写进 errors 并返回 null，绝不抛错。
function normalizeEntry(item, index, errors) {
  const fail = (code, message) => {
    errors.push({
      index,
      id: nonEmptyString(item?.id) ? item.id.trim() : null,
      code,
      message,
    });
    return null;
  };

  if (!item || typeof item !== 'object') return fail('entry-shape', '条目不是对象');

  const id = nonEmptyString(item.id) ? item.id.trim() : '';
  if (!id) return fail('missing-id', '缺少 id');
  if (!SPRITE_ID_PATTERN.test(id)) return fail('invalid-id', `id 不符合 <类别>/<名称>：${id}`);

  const src = nonEmptyString(item.src) ? item.src.trim() : srcFromPath(item.path);
  if (!src) return fail('missing-src', '缺少 src/path');

  const size = item.size ?? DEFAULT_SIZE;
  if (!size || !isPositiveInt(size.w) || !isPositiveInt(size.h)) {
    return fail('invalid-size', 'size 必须是正整数 { w, h }');
  }

  const anchor = item.anchor ?? 'center';
  if (!ANCHORS.includes(anchor)) return fail('anchor-invalid', `未知锚点：${anchor}`);

  const pivot = item.pivot ?? DEFAULT_PIVOT;
  if (!pivot || !inUnitRange(pivot.x) || !inUnitRange(pivot.y)) {
    return fail('pivot-range', 'pivot 越界：必须是 [0, 1] 内的归一化坐标');
  }

  const dpr = item.dpr ?? [1];
  if (!Array.isArray(dpr) || dpr.length === 0 || !dpr.every((value) => isFiniteNumber(value) && value > 0)) {
    return fail('invalid-dpr', 'dpr 必须是非空正数数组');
  }

  const frames = item.frames ?? 1;
  if (!isPositiveInt(frames)) return fail('invalid-frames', 'frames 必须是正整数');

  const states = Array.isArray(item.states) && item.states.length ? item.states.filter(nonEmptyString) : ['idle'];
  const status = ENTRY_STATUS.includes(item.status) ? item.status : 'placeholder';

  const srcs = {};
  if (item.srcs && typeof item.srcs === 'object' && !Array.isArray(item.srcs)) {
    for (const [key, url] of Object.entries(item.srcs)) {
      const scale = Number(key);
      if (isFiniteNumber(scale) && scale > 0 && nonEmptyString(url)) srcs[scale] = url.trim();
    }
  }
  for (const scale of dprVariants({ dpr })) {
    if (!srcs[scale]) srcs[scale] = src;
  }

  return {
    id,
    src,
    srcs,
    size: { w: size.w, h: size.h },
    anchor,
    pivot: { x: pivot.x, y: pivot.y },
    frames,
    states: [...states],
    status,
    dpr: [...dpr],
    atlas: nonEmptyString(item.atlas) ? item.atlas.trim() : null,
    frame: nonEmptyString(item.frame) ? item.frame.trim() : null,
    compression: nonEmptyString(item.compression) ? item.compression : 'lossless',
    provenance: item.provenance && typeof item.provenance === 'object' ? item.provenance : null,
    license: nonEmptyString(item.license) ? item.license : null,
    generator: nonEmptyString(item.generator) ? item.generator : null,
  };
}

// 归一化整份清单。返回 { entries, errors }；非法条目只进 errors，不中断其它条目。
// 重复 id 保留最后一条，并记一条 duplicate-id。
export function normalizeManifest(raw) {
  const errors = [];
  const entries = [];
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.entries) ? raw.entries : null;
  if (!list) {
    errors.push({ index: -1, id: null, code: 'manifest-shape', message: '清单缺少 entries 数组' });
    return { entries, errors };
  }

  const byId = new Map();
  list.forEach((item, index) => {
    const entry = normalizeEntry(item, index, errors);
    if (!entry) return;
    const previous = byId.get(entry.id);
    if (previous) {
      errors.push({
        index,
        id: entry.id,
        code: 'duplicate-id',
        message: `重复 id，只保留最后一条：${entry.id}`,
      });
      const at = entries.indexOf(previous);
      if (at !== -1) entries.splice(at, 1);
    }
    byId.set(entry.id, entry);
    entries.push(entry);
  });

  return { entries, errors };
}

// 图集切帧：返回逻辑像素（@1x）下的源矩形与锚点偏移。
//   sx/sy/sw/sh —— 帧在图集里的矩形
//   ax/ay       —— pivot 相对帧内容左上角的偏移（已扣除 trimmed 的裁剪位移）
//   sourceW/sourceH —— 未裁剪的整帧尺寸，调用方按 DPR 档缩放
// 未知帧、旋转帧（本管线不支持旋转打包）与畸形数据一律返回 null，不抛错。
export function atlasFrame(atlas, name) {
  const frames = atlas?.frames;
  if (!frames || typeof frames !== 'object' || typeof name !== 'string' || !name) return null;
  const raw = frames[name];
  if (!raw || typeof raw !== 'object') return null;
  if (raw.rotated === true) return null;

  const rect = raw.frame && typeof raw.frame === 'object' ? raw.frame : raw;
  const x = rect.x;
  const y = rect.y;
  const w = rect.w;
  const h = rect.h;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isPositiveInt(w) || !isPositiveInt(h)) return null;

  const sourceSize = raw.sourceSize && typeof raw.sourceSize === 'object' ? raw.sourceSize : { w, h };
  if (!isPositiveInt(sourceSize.w) || !isPositiveInt(sourceSize.h)) return null;

  const offset = raw.offset && typeof raw.offset === 'object' ? raw.offset : { x: 0, y: 0 };
  const offsetX = isFiniteNumber(offset.x) ? offset.x : 0;
  const offsetY = isFiniteNumber(offset.y) ? offset.y : 0;

  const pivot = raw.pivot && typeof raw.pivot === 'object' ? raw.pivot : atlas?.pivot;
  const pivotX = inUnitRange(pivot?.x) ? pivot.x : 0.5;
  const pivotY = inUnitRange(pivot?.y) ? pivot.y : 0.5;

  return {
    sx: x,
    sy: y,
    sw: w,
    sh: h,
    ax: pivotX * sourceSize.w - offsetX,
    ay: pivotY * sourceSize.h - offsetY,
    sourceW: sourceSize.w,
    sourceH: sourceSize.h,
    offsetX,
    offsetY,
    trimmed: raw.trimmed === true,
    rotated: false,
  };
}
