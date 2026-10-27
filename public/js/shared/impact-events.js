// 结构化命中事件：伤害汇点的只读观测面。
// 只做数据归一化与环形入队，不读设置、不调用随机数、不改变模拟状态。
// 见 docs/TECH_DESIGN.md §4.6「结构化命中事件」。

export const IMPACT_EVENT_LIMIT = 240;

const finiteOrZero = (value) => (Number.isFinite(value) ? value : 0);
const textOr = (value, fallback) => (typeof value === 'string' && value ? value : fallback);

// 归一化一次命中：字段缺失/非法时退化为安全默认值，消费者可无条件读取。
export function makeImpactEvent(fields = {}) {
  const target = fields.target || {};
  return {
    t: finiteOrZero(fields.t),
    x: finiteOrZero(fields.x),
    y: finiteOrZero(fields.y),
    target: {
      id: finiteOrZero(target.id),
      type: textOr(target.type, ''),
    },
    weapon: textOr(fields.weapon, 'unknown'),
    source: textOr(fields.source, 'tower'),
    towerId: Number.isFinite(fields.towerId) ? fields.towerId : null,
    amount: finiteOrZero(fields.amount),
    armorAbsorbed: finiteOrZero(fields.armorAbsorbed),
    shieldAbsorbed: finiteOrZero(fields.shieldAbsorbed),
    hpLost: finiteOrZero(fields.hpLost),
    crit: fields.crit === true,
    lethal: fields.lethal === true,
  };
}

// 推入模拟的环形事件流：超过上限裁掉最旧的一条。
export function pushImpactEvent(sim, fields) {
  if (!sim || !Array.isArray(sim.impactEvents)) return null;
  const event = makeImpactEvent(fields);
  sim.impactEvents.push(event);
  if (sim.impactEvents.length > IMPACT_EVENT_LIMIT) {
    sim.impactEvents.splice(0, sim.impactEvents.length - IMPACT_EVENT_LIMIT);
  }
  return event;
}
