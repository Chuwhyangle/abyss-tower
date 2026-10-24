// 主海克斯：熔火核心。攻击附带持续灼烧，代价是攻击间隔 +25%（攻速 ×0.80）。
// 复用敌人已有的 burnDps/burnUntil 字段：不开平行灼烧系统，跳伤由模拟层统一结算。
const BURN_DURATION = 3; // 秒
const BURN_DPS_RATIO = 0.3; // 每秒造成该次命中伤害的 30%
const ATTACK_RATE_MUL = 0.8; // 攻速 ×0.80 ⇒ 攻击间隔 ×1.25

const hooks = Object.freeze({
  // 塔属性重算末尾调用：攻速降为 80%（攻击间隔 ×1.25）。
  // rate 非有限数（旧档/形状不全）时原样返回，不把 NaN 带进模拟层。
  modifyTowerStats(tower, stats, ctx) {
    if (!stats || !Number.isFinite(stats.rate)) return stats;
    return { ...stats, rate: stats.rate * ATTACK_RATE_MUL };
  },
  // 塔攻击命中：写入 3 秒灼烧；重复命中只刷新持续时间，DPS 取较高值（不叠层）。
  onHit(enemy, tower, damage, ctx) {
    // 只有塔的攻击命中才附加灼烧（技能/盟友命中不传出手塔）。
    if (!enemy || enemy.dead || !tower || !(damage > 0)) return;
    const now = ctx?.sim?.time ?? 0;
    const dps = damage * BURN_DPS_RATIO;
    // 已过期的旧灼烧不参与取高，避免残留 DPS 被“复活”。
    const activeDps = (enemy.burnUntil || 0) > now ? enemy.burnDps || 0 : 0;
    enemy.burnDps = Math.max(activeDps, dps);
    enemy.burnUntil = Math.max(enemy.burnUntil || 0, now + BURN_DURATION);
  },
});

export default Object.freeze({
  id: 'molten_core',
  name: '熔火核心',
  glyph: '🔥',
  color: '#fb923c',
  tags: Object.freeze(['持续伤害', '长线']),
  pitch: '攻击附带灼烧',
  desc: '攻击附带灼烧，但攻击间隔 +25%。',
  downside: '攻击间隔 +25%',
  scoreMul: 1.05,
  hooks,
  implemented: true,
});
