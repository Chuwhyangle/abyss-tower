// 飘字分层与三档可见性：服务端与浏览器共用的纯数据/纯函数。
// 不依赖 DOM / Canvas / 模拟 / 渲染，不含随机源；同一输入永远得到同一输出。
//
// 契约（docs/PHASE_FEEL_ART.md §3.2/§3.3 的冻结表）：
//   - 六层 damage/heal/reward/status/penalty/crit，z 越大越在上层；
//   - 「关键」档判据沿用既有 key || big，不扩大；
//   - 每帧预算：off 0 / key 12 / all 28；
//   - 同层 + 0.3 格内 + 0.12s 窗口内合并数字，不可合并的重复项丢弃。

// 每层的 z 序取自阶段冻结表；armor/bossHit/shield 预留更高 z，由后续任务追加。
export const FLOATER_LAYERS = Object.freeze({
  damage: Object.freeze({ z: 10, size: 13, weight: 600, color: '#eef3f8' }),
  heal: Object.freeze({ z: 20, size: 14, weight: 600, color: '#7ef0a5' }),
  reward: Object.freeze({ z: 30, size: 15, weight: 700, color: '#ffd36b' }),
  status: Object.freeze({ z: 40, size: 16, weight: 700, color: '#ffd36b' }),
  penalty: Object.freeze({ z: 50, size: 17, weight: 700, color: '#ff6b6b' }),
  crit: Object.freeze({ z: 90, size: 15, weight: 800, color: '#ffd36b' }),
});

export const FLOATER_LAYER_NAMES = Object.freeze(Object.keys(FLOATER_LAYERS));

// 逐帧预算与合并参数：数值是契约，改动须同步阶段文档。
export const FLOATER_BUDGET = Object.freeze({ off: 0, key: 12, all: 28 });
export const MERGE_RADIUS = 0.3;
export const MERGE_WINDOW = 0.12;
export const CLUSTER_RADIUS = 0.22;
export const STACK_STEP = 0.16;
export const STACK_RADIUS = 0.3;
// big 的字号加成：让旧数据的「大号数字」仍比同层普通数字大一档。
export const BIG_SIZE_BONUS = 4;

// 预算裁剪的重要性：数字越小越先保留。
const IMPORTANCE = Object.freeze({
  crit: 1,
  penalty: 2,
  status: 3,
  reward: 4,
  heal: 5,
  damage: 6,
});

const HEAL_COLOR = '#7ef0a5';
const NUMERIC_TEXT = /^([+-]?)(\d+(?:\.\d+)?)(!?)$/;

function isLayerName(layer) {
  return typeof layer === 'string' && Object.prototype.hasOwnProperty.call(FLOATER_LAYERS, layer);
}

function parseNumericText(text) {
  if (typeof text !== 'string') return null;
  const match = NUMERIC_TEXT.exec(text);
  if (!match) return null;
  return { sign: match[1], value: Number(match[2]), bang: match[3] };
}

function isNumericText(text) {
  return parseNumericText(text) !== null;
}

// 推导层：显式 layer 优先；其余按真实调用签名（文本形状 + 颜色）判定。
export function floaterLayer(meta = {}) {
  const { layer, text, color, big } = meta || {};
  if (isLayerName(layer)) return layer;
  if (typeof text !== 'string' || text === '') return 'damage';
  if (big && text.endsWith('!')) return 'crit';
  if (!isNumericText(text)) return 'status';
  if (color === HEAL_COLOR) return 'heal';
  if (text.startsWith('+')) return 'reward';
  if (text.startsWith('-')) return 'penalty';
  return 'damage';
}

// 三档可见性：「关键」档保持既有 key || big 判据；未知档位按 all 处理。
export function floaterVisible(mode, meta = {}) {
  if (mode === 'off') return false;
  if (mode === 'key') return Boolean(meta && (meta.key || meta.big));
  return true;
}

export function floaterBudget(mode) {
  return Object.prototype.hasOwnProperty.call(FLOATER_BUDGET, mode)
    ? FLOATER_BUDGET[mode]
    : FLOATER_BUDGET.all;
}

// 规范飘字对象：补全 layer/color，ttl 沿用既有的 big ? 0.9 : 0.65。
export function createFloater({ x = 0, y = 0, text = '', color = null, big = false, key = false, layer = null } = {}) {
  const resolved = floaterLayer({ layer, text, color, big });
  const ttl = big ? 0.9 : 0.65;
  return {
    x,
    y,
    text,
    color: color || FLOATER_LAYERS[resolved].color,
    big: Boolean(big),
    key: Boolean(key),
    layer: resolved,
    ttl,
    maxTtl: ttl,
  };
}

// 数字文案求和：保留显式符号与感叹号；任一侧非数字返回 null。
export function mergeFloaterText(a, b) {
  const left = parseNumericText(a);
  const right = parseNumericText(b);
  if (!left || !right) return null;
  const signOf = (parsed) => (parsed.sign === '-' ? -1 : 1);
  const total = left.value * signOf(left) + right.value * signOf(right);
  let sign = '';
  if (left.sign && left.sign === right.sign) sign = left.sign;
  else if (total < 0) sign = '-';
  else if (left.sign === '+' || right.sign === '+') sign = '+';
  const magnitude = Math.abs(total);
  const rounded = Number.isInteger(magnitude) ? String(magnitude) : String(Number(magnitude.toFixed(2)));
  const bang = left.bang || right.bang ? '!' : '';
  return `${sign}${rounded}${bang}`;
}

function distanceSq(a, b) {
  const dx = (a.x || 0) - (b.x || 0);
  const dy = (a.y || 0) - (b.y || 0);
  return dx * dx + dy * dy;
}

// 入列前合并：同层 + 半径 + 时间窗内可合并则累加，不可合并的重复非数字丢弃。
// 返回被接受/合并后的飘字对象；被丢弃返回 null。
export function pushFloater(list, floater, now = 0, opts = {}) {
  const radius = opts.radius ?? MERGE_RADIUS;
  const window = opts.window ?? MERGE_WINDOW;
  const layer = floater.layer || floaterLayer(floater);
  const item = { ...floater, layer, t0: Number.isFinite(floater.t0) ? floater.t0 : now };
  const limitSq = radius * radius;

  for (let i = list.length - 1; i >= 0; i -= 1) {
    const existing = list[i];
    const existingLayer = existing.layer || floaterLayer(existing);
    if (existingLayer !== layer) continue;
    if (distanceSq(existing, item) > limitSq) continue;
    const age = item.t0 - (Number.isFinite(existing.t0) ? existing.t0 : item.t0);
    if (Math.abs(age) > window) continue;
    const merged = mergeFloaterText(existing.text, item.text);
    if (merged === null) return null;
    existing.text = merged;
    existing.t0 = item.t0;
    existing.ttl = Math.max(existing.ttl ?? item.ttl, item.ttl);
    existing.maxTtl = Math.max(existing.maxTtl ?? item.maxTtl, item.maxTtl);
    return existing;
  }

  list.push(item);
  return item;
}

// 帧内聚类：同层 CLUSTER_RADIUS 内的数字文案累加，其余保持独立。
function clusterVisible(candidates) {
  const clusters = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const item = candidates[index];
    let mergedInto = null;
    for (const cluster of clusters) {
      if (cluster.layer !== item.layer) continue;
      if (distanceSq(cluster, item) > CLUSTER_RADIUS * CLUSTER_RADIUS) continue;
      const merged = mergeFloaterText(cluster.text, item.text);
      if (merged === null) continue;
      cluster.text = merged;
      mergedInto = cluster;
      break;
    }
    if (!mergedInto) clusters.push({ ...item, index });
  }
  return clusters;
}

// 每帧绘制计划：过滤可见 → 聚类合并 → 重要性/ttl/下标排序 → 截预算 → 按 z 给绘制序与垂直错位。
// 不修改入参；返回 { draw, suppressed, visible }。
export function planFloaterFrame(floaters, { mode = 'all', budget } = {}) {
  const list = Array.isArray(floaters) ? floaters : [];
  const limit = Number.isFinite(budget) ? budget : floaterBudget(mode);

  const visibleItems = [];
  for (let index = 0; index < list.length; index += 1) {
    const floater = list[index];
    if (!floaterVisible(mode, floater)) continue;
    visibleItems.push({ ...floater, layer: floater.layer || floaterLayer(floater), index });
  }
  const visible = visibleItems.length;

  const clustered = clusterVisible(visibleItems);
  const ranked = clustered
    .map((item) => ({ item, importance: IMPORTANCE[item.layer] ?? IMPORTANCE.damage }))
    .sort(
      (a, b) =>
        a.importance - b.importance ||
        (b.item.ttl ?? 0) - (a.item.ttl ?? 0) ||
        a.item.index - b.item.index
    )
    .map((entry) => entry.item)
    .slice(0, Math.max(0, limit));

  // z 升序 = 绘制顺序（后画的盖在上面）；同 z 保持重要性排序的稳定序。
  const draw = ranked
    .map((item) => ({ ...item, z: FLOATER_LAYERS[item.layer]?.z ?? FLOATER_LAYERS.damage.z }))
    .sort((a, b) => a.z - b.z || a.index - b.index);

  // 同层近邻的垂直错位：逐层占用，距离内的项拿到互不相同的 stack。
  const taken = new Map();
  for (const item of draw) {
    const slots = taken.get(item.layer) || [];
    let stack = 0;
    while (slots.some((slot) => slot.stack === stack && distanceSq(slot.item, item) <= STACK_RADIUS * STACK_RADIUS)) {
      stack += 1;
    }
    item.stack = stack;
    slots.push({ stack, item });
    taken.set(item.layer, slots);
  }

  return { draw, suppressed: visible - draw.length, visible };
}
