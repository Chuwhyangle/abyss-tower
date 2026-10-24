// 主海克斯：过载电网。奖励密集建造（塔阵），惩罚分散布防。
// 每有一座上下左右（4 邻接）相邻的塔：攻速 +10%、伤害 +3%，各自封顶 4 层（+40% / +12%）；
// 作为代价，全场所有塔射程 ×0.80——孤立塔拿不到任何加成，只剩射程惩罚。
// 当前没有生效的海克斯时本模块的钩子不会被运行时调用，模拟行为与无海克斯完全一致。

const RATE_PER_NEIGHBOR = 0.1;
const DMG_PER_NEIGHBOR = 0.03;
const MAX_NEIGHBORS = 4;
const RANGE_MUL = 0.8;

// 相邻计数只读塔的格子坐标，不消耗 RNG，也不依赖遍历顺序。
// recomputeTowerStats 会对每座塔各调用一次本钩子，逐塔扫描全场是 O(n²)；
// 这里按 Simulation 缓存一份计数表：塔只在建造/出售时增删（push/splice 原地改数组、不换引用），
// 升级与遗物变化只改属性、不改坐标，因此「数组引用 + 长度」足以判定缓存仍然有效；
// 读档/换图会整体替换 towers 数组，引用一变缓存即自动失效。
const neighborCounts = new WeakMap();

function buildCounts(towers) {
  const counts = new Map();
  for (const tower of towers) {
    let count = 0;
    for (const other of towers) {
      if (other === tower) continue;
      const dc = Math.abs(other.c - tower.c);
      const dr = Math.abs(other.r - tower.r);
      // 只算 4 邻接；镜像塔与普通塔一样是场上的塔，自然计入。
      if (dc + dr === 1) {
        count += 1;
        if (count >= MAX_NEIGHBORS) break; // 4 邻接最多 4 个，提前收手
      }
    }
    counts.set(tower, count);
  }
  return counts;
}

function countNeighbors(tower, ctx) {
  const sim = ctx?.sim;
  const towers = sim?.towers;
  // 没有模拟上下文（注册表契约的单测/工具直接调用）时无从统计，保持入参不变。
  if (!Array.isArray(towers)) return null;
  // 预览用的幽灵塔不在场上：不享受相邻加成（射程惩罚仍由下方统一施加）。
  if (!towers.includes(tower)) return 0;
  let cache = neighborCounts.get(sim);
  if (!cache || cache.towers !== towers || cache.length !== towers.length) {
    cache = { towers, length: towers.length, counts: buildCounts(towers) };
    neighborCounts.set(sim, cache);
  }
  return cache.counts.get(tower) || 0;
}

const hooks = Object.freeze({
  // 塔属性重算末尾调用：按 4 邻接数量加成攻速/伤害，并对所有塔统一降低射程。
  modifyTowerStats(tower, stats, ctx) {
    const neighbors = countNeighbors(tower, ctx);
    if (neighbors === null) return stats;
    return {
      ...stats,
      dmg: stats.dmg * (1 + DMG_PER_NEIGHBOR * neighbors),
      rate: stats.rate * (1 + RATE_PER_NEIGHBOR * neighbors),
      range: stats.range * RANGE_MUL,
    };
  },
});

export default Object.freeze({
  id: 'overload_grid',
  name: '过载电网',
  glyph: '⚡',
  color: '#eab308',
  tags: Object.freeze(['邻接', '阵型']),
  pitch: '相邻塔提供攻速/伤害加成',
  desc: '相邻塔提供攻速/伤害加成，但射程 -20%。',
  downside: '射程 -20%',
  scoreMul: 1.05,
  hooks,
  implemented: true,
});
