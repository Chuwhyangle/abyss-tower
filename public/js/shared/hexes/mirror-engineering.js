// 主海克斯：镜像工程。本体塔建成后，玩家自选位置落一座连体镜像：
// 同类型同等级、0 造价、60% 属性（含 dot/slow/splash/chain 等次要属性）、
// 随本体升级/消失、不可单独升级、单独出售 0 金消失。
//
// 落位流程复用「选塔→点格子」手感：建本体后由 onTowerBuilt 把本体写进模拟层的
// 待落位镜像槽（sim.pendingMirror）并进入镜像落位模式，玩家点空位由 sim.placeMirror
// 经 createMirror 钩子把镜像塔落进去；Esc 由 sim.cancelMirrorPlacement 暂存不丢弃
// （一次一个待落位槽，建新本体会覆盖旧槽）。
//
// 镜像身份直接写在塔上（tower.mirrorOf = 本体 id）并随快照往返：snapshot.js 把
// mirrorOf 序列化成本体格坐标，读档时模拟层映射回重建后的本体 id。旧档镜像会失去
// 60% 折扣（瞬态单局存档，接受，不写迁移）。
export const COST_MUL = 1.45;
export const MIRROR_STAT_MUL = 0.6;

function isMirror(tower) {
  return tower != null && tower.mirrorOf != null;
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mirrorsOf(sim, body) {
  return (sim?.towers || []).filter((tower) => tower && tower.mirrorOf === body.id);
}

// 镜像塔由模拟层工厂创建后直接入列：不扣金币、不触发 onTowerBuilt（防递归），
// 也不计入任何建造次数。mirrorOf 直接挂在塔上，随快照往返。
function spawnMirror(sim, body, site) {
  if (!sim || typeof sim.makeTower !== 'function' || !Array.isArray(sim.towers)) return null;
  const mirror = sim.makeTower(
    body.type,
    site.c,
    site.r,
    body.level,
    0,
    body.evolutions ?? body.evolution ?? null
  );
  mirror.mirrorOf = body.id;
  sim.towers.push(mirror);
  return mirror;
}

// 60% 折扣覆盖全部数值属性：伤害/攻速/射程、dot/slow/splash/chain/knockback 等次要属性，
// 以及战旗塔的增伤/攻速光环（避免免费镜像提供满额光环）。
const MIRROR_STAT_KEYS = Object.freeze([
  'dmg',
  'rate',
  'range',
  'splash',
  'slow',
  'slowDur',
  'chain',
  'dot',
  'dotDur',
  'knockback',
  'buffDmg',
  'buffRate',
]);

function scaleMirrorStat(stats, key) {
  const value = finiteNumber(stats?.[key]);
  return value === null ? stats?.[key] : value * MIRROR_STAT_MUL;
}

const hooks = Object.freeze({
  // 所有塔造价 ×1.45；模拟层随后统一套用遗物 costMul 与下限。
  buildCost(type, base) {
    const value = finiteNumber(base);
    return value === null ? base : value * COST_MUL;
  },
  // 建本体塔：写进待落位镜像槽并进入镜像落位模式（不在这里直接生成镜像）。
  onTowerBuilt(tower, ctx) {
    const sim = ctx?.sim;
    if (!tower || isMirror(tower) || !sim) return;
    if (typeof sim.setPendingMirror === 'function') sim.setPendingMirror(tower);
  },
  // 镜像落位：模拟层在玩家点空位时调用，返回落成的镜像塔（失败返回 null）。
  createMirror(body, site, ctx) {
    return spawnMirror(ctx?.sim, body, site);
  },
  // 本体升级：镜像同步等级（属性随模拟层 recomputeTowerStats 重算）。
  onTowerUpgraded(tower, ctx) {
    const sim = ctx?.sim;
    if (!tower || isMirror(tower) || !sim || !Array.isArray(sim.towers)) return;
    for (const mirror of mirrorsOf(sim, tower)) mirror.level = tower.level;
  },
  // 本体出售/被摧毁：镜像一起消失；镜像被单独出售：0 金消失（不回位）。
  onTowerRemoved(tower, reason, ctx) {
    const sim = ctx?.sim;
    if (!tower || !sim || !Array.isArray(sim.towers)) return;
    if (isMirror(tower)) return;
    for (const mirror of mirrorsOf(sim, tower)) {
      if (typeof sim.removeTower === 'function') sim.removeTower(mirror, 'mirror');
    }
    // 本体移除时，其未落位的镜像槽一并取消。
    if (typeof sim.clearPendingMirror === 'function') sim.clearPendingMirror(tower);
  },
  // 镜像不能单独升级：返回 null 让模拟层判定「不可升级」。
  upgradeCost(tower, base) {
    return isMirror(tower) ? null : base;
  },
  // 镜像全部数值属性 ×0.60（含次要属性）；非镜像/无海克斯时原样返回。
  modifyTowerStats(tower, stats, ctx) {
    if (!tower || !isMirror(tower)) return stats;
    const out = { ...stats };
    for (const key of MIRROR_STAT_KEYS) out[key] = scaleMirrorStat(stats, key);
    return out;
  },
});

export default Object.freeze({
  id: 'mirror_engineering',
  name: '镜像工程',
  glyph: '🪞',
  color: '#38bdf8',
  tags: Object.freeze(['空间', '复制']),
  pitch: '建塔后自选位置落 60% 属性镜像',
  desc: '建塔后自选位置落一座 60% 属性镜像，随本体升级，但造价 +45%。',
  downside: '造价 +45%',
  scoreMul: 1.1,
  hooks,
  implemented: true,
});
