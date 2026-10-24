// 主海克斯：镜像工程。一次建造得到两座塔，用空间换经济。
// 只用 HEX-002 运行时暴露的钩子，不改 sim.js / 渲染 / UI：
//   buildCost        所有塔造价 ×1.35（升级费用沿用表价）
//   onTowerBuilt     在中心对称格生成一座镜像塔（同类型同等级、0 造价、mirrorOf = 本体 id）
//   onTowerUpgraded  本体升级时同步镜像等级
//   onTowerRemoved   本体出售/被摧毁时镜像消失；镜像被单独出售时回位（模拟层无 tower 级出售拦截钩子）
//   upgradeCost      镜像不能单独升级（返回 null）
//   modifyTowerStats 镜像伤害/攻速/射程 ×0.60
//
// 镜像身份：快照只保存塔的 type/c/r/level/invested，mirrorOf 会丢；
// 因此镜像格写进 hexState.mirrorSites，读档后首次属性重算时按格把身份补回来，
// 避免镜像塔读档后变成满属性普通塔。
const COST_MUL = 1.35;
const MIRROR_STAT_MUL = 0.6;
// 对称格不可建时的搜索顺序：顺时针一圈（上 → 右上 → 右 → 右下 → 下 → 左下 → 左 → 左上），最多 8 格。
const CLOCKWISE = Object.freeze([
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
]);

function isMirror(tower) {
  return tower != null && tower.mirrorOf != null;
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// 中心对称格：以地图中心 (cols/2, rows/2) 为对称点，(c+0.5, r+0.5) 的对称点是
// (cols-c-0.5, rows-r-0.5)，对应格子 (cols-1-c, rows-1-r)。
function symmetricCell(sim, tower) {
  const cols = finiteNumber(sim?.map?.cols);
  const rows = finiteNumber(sim?.map?.rows);
  if (cols === null || rows === null) return null;
  return { c: cols - 1 - tower.c, r: rows - 1 - tower.r };
}

// 对称格优先；不可建/已有塔时顺时针找最近的空可建格（只搜相邻一圈，共 8 格）；都不可用则不生成。
function findMirrorSite(sim, tower) {
  if (typeof sim?.canBuild !== 'function') return null;
  const center = symmetricCell(sim, tower);
  if (!center) return null;
  if (sim.canBuild(center.c, center.r)) return center;
  for (const [dc, dr] of CLOCKWISE) {
    const c = center.c + dc;
    const r = center.r + dr;
    if (sim.canBuild(c, r)) return { c, r };
  }
  return null;
}

// 镜像塔由模拟层工厂创建后直接入列：不扣金币、不触发 onTowerBuilt（防递归），也不计入任何建造次数。
function createMirror(sim, body, site) {
  if (typeof sim?.makeTower !== 'function' || !Array.isArray(sim.towers)) return null;
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

// ---------- hexState.mirrorSites：镜像格记录（本体格 → 镜像格），随快照往返 ----------

// 读记录不创建：没有镜像时 hexState 保持为空，无镜像的对局存档结构不变。
function siteRecords(state, { create = false } = {}) {
  if (state == null) return null;
  if (Array.isArray(state.mirrorSites)) return state.mirrorSites;
  if (!create) return null;
  state.mirrorSites = [];
  return state.mirrorSites;
}

function rememberSite(state, body, site) {
  const sites = siteRecords(state, { create: true });
  if (!sites) return;
  if (sites.some((record) => record?.c === site.c && record?.r === site.r)) return;
  sites.push({ bc: body.c, br: body.r, c: site.c, r: site.r });
}

// 原地过滤，保持 ctx.state 对象引用不变（状态由模拟层持有并直接序列化）。
function forgetSite(state, c, r) {
  const sites = siteRecords(state);
  if (!sites) return;
  const kept = sites.filter((record) => !(record?.c === c && record?.r === r));
  sites.length = 0;
  sites.push(...kept);
}

// 读档修复：快照不保存 mirrorOf，按镜像格记录把身份与等级补回；记录失效（本体不在了）时顺手清理。
function repairMirrorIdentity(tower, ctx) {
  const sim = ctx?.sim;
  if (!tower || isMirror(tower)) return;
  // 预览用的临时塔不在 sim.towers 里，不参与修复，也不会被误判成镜像。
  if (!sim || !Array.isArray(sim.towers) || !sim.towers.includes(tower)) return;
  const sites = siteRecords(ctx?.state);
  if (!sites || sites.length === 0) return;
  const record = sites.find((item) => item?.c === tower.c && item?.r === tower.r);
  if (!record) return;
  const body = sim.towers.find(
    (item) => item && !isMirror(item) && item.c === record.bc && item.r === record.br
  );
  if (!body) {
    forgetSite(ctx.state, tower.c, tower.r);
    return;
  }
  tower.mirrorOf = body.id;
  tower.level = body.level;
}

function mirrorsOf(sim, body) {
  return sim.towers.filter((tower) => tower && tower.mirrorOf === body.id);
}

// 镜像不能单独出售：模拟层没有 tower 级的出售拦截钩子（sellRatio 只收 base），
// 因此在「镜像被 sold 移除」的回调里按本体当前等级原样回位；本体也已不在时正常消失。
function restoreSoldMirror(sim, mirror) {
  const body = sim.towers.find((tower) => tower && tower.id === mirror.mirrorOf) || null;
  if (!body || isMirror(body)) return false;
  return createMirror(sim, body, { c: mirror.c, r: mirror.r }) !== null;
}

function scaleMirrorStat(stats, key) {
  const value = finiteNumber(stats?.[key]);
  return value === null ? stats?.[key] : value * MIRROR_STAT_MUL;
}

const hooks = Object.freeze({
  // 所有塔造价 ×1.35；模拟层随后统一套用遗物 costMul 与下限。
  buildCost(type, base) {
    const value = finiteNumber(base);
    return value === null ? base : value * COST_MUL;
  },
  // 建塔：本体落成后立刻在对称格（或顺时针最近的空可建格）生成镜像。
  onTowerBuilt(tower, ctx) {
    const sim = ctx?.sim;
    if (!tower || isMirror(tower) || !sim || !Array.isArray(sim.towers)) return;
    if (typeof sim.makeTower !== 'function' || typeof sim.canBuild !== 'function') return;
    const site = findMirrorSite(sim, tower);
    if (!site) return;
    if (!createMirror(sim, tower, site)) return;
    rememberSite(ctx.state, tower, site);
  },
  // 本体升级：镜像同步等级（属性随模拟层随后的 recomputeTowerStats 重算）。
  onTowerUpgraded(tower, ctx) {
    const sim = ctx?.sim;
    if (!tower || isMirror(tower) || !sim || !Array.isArray(sim.towers)) return;
    for (const mirror of mirrorsOf(sim, tower)) mirror.level = tower.level;
  },
  // 本体出售/被摧毁：镜像一起消失；镜像被单独出售：回位（见 restoreSoldMirror）。
  onTowerRemoved(tower, reason, ctx) {
    const sim = ctx?.sim;
    if (!tower || !sim || !Array.isArray(sim.towers)) return;
    if (isMirror(tower)) {
      if (reason === 'sold' && restoreSoldMirror(sim, tower)) return;
      forgetSite(ctx?.state, tower.c, tower.r);
      return;
    }
    for (const mirror of mirrorsOf(sim, tower)) {
      forgetSite(ctx?.state, mirror.c, mirror.r);
      if (typeof sim.removeTower === 'function') sim.removeTower(mirror, 'mirror');
    }
  },
  // 镜像不能单独升级：返回 null 让模拟层判定「不可升级」，不动本体。
  upgradeCost(tower, base) {
    return isMirror(tower) ? null : base;
  },
  // 镜像伤害/攻速/射程 ×0.60（战旗塔的增伤/攻速光环同样打折，避免免费镜像提供满额光环）。
  modifyTowerStats(tower, stats, ctx) {
    if (!tower) return stats;
    repairMirrorIdentity(tower, ctx);
    if (!isMirror(tower)) return stats;
    return {
      ...stats,
      dmg: scaleMirrorStat(stats, 'dmg'),
      rate: scaleMirrorStat(stats, 'rate'),
      range: scaleMirrorStat(stats, 'range'),
      buffDmg: scaleMirrorStat(stats, 'buffDmg'),
      buffRate: scaleMirrorStat(stats, 'buffRate'),
    };
  },
});

export default Object.freeze({
  id: 'mirror_engineering',
  name: '镜像工程',
  glyph: '🪞',
  color: '#38bdf8',
  tags: Object.freeze(['空间', '复制']),
  pitch: '对称位置生成 60% 属性镜像塔',
  desc: '建塔时对称位置生成 60% 属性镜像塔，但造价 +35%。',
  downside: '造价 +35%',
  scoreMul: 1.1,
  hooks,
  implemented: true,
});
