// 每日/每周挑战规则：确定性轮换的单条规则（每日）与复合规则组（每周）。
// 规则复用地图词缀的生效 schema（hpMul/speedMul/goldMul/rangeMul，1 = 不变），
// 服务端在 run-rules.mjs 把规则叠加到固定地图候选的词缀上（与随机词缀同一路径），
// 因此规则只改战斗数值、不改开局参数，也不影响正常模式与爬塔。
import { RNG } from '../rng.js';

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

// 每日规则池：每天轮换一条。
const DAILY_RULE_DEFS = [
  { id: 'enemy_might', name: '敌军强化', desc: '敌人生命 +20%。', hpMul: 1.2, speedMul: 1, goldMul: 1, rangeMul: 1 },
  { id: 'swift_foes', name: '疾风骤雨', desc: '敌人移速 +15%。', hpMul: 1, speedMul: 1.15, goldMul: 1, rangeMul: 1 },
  { id: 'austerity', name: '经济紧缩', desc: '击杀金币 -12%。', hpMul: 1, speedMul: 1, goldMul: 0.88, rangeMul: 1 },
  { id: 'short_leash', name: '射程受限', desc: '塔射程 -10%。', hpMul: 1, speedMul: 1, goldMul: 1, rangeMul: 0.9 },
  { id: 'hardened', name: '铜墙铁壁', desc: '敌人生命 +12%、移速 +6%。', hpMul: 1.12, speedMul: 1.06, goldMul: 1, rangeMul: 1 },
];

const DAILY_RULE_BY_ID = Object.fromEntries(DAILY_RULE_DEFS.map((rule) => [rule.id, rule]));

export const DAILY_RULES = DAILY_RULE_DEFS.map((rule) => ({ ...rule, id: `daily:${rule.id}` }));

// 每周规则组池：每周固定一组，2–3 条每日规则复合，效果相乘。
const WEEKLY_RULE_GROUP_DEFS = [
  { id: 'onslaught', name: '全线进逼', desc: '敌军强化 + 疾风骤雨。', rules: ['enemy_might', 'swift_foes'] },
  { id: 'siege', name: '坚壁清野', desc: '经济紧缩 + 射程受限。', rules: ['austerity', 'short_leash'] },
  { id: 'gauntlet', name: '绝境试炼', desc: '敌军强化 + 经济紧缩 + 射程受限。', rules: ['enemy_might', 'austerity', 'short_leash'] },
  { id: 'blitz', name: '闪电战', desc: '疾风骤雨 + 铜墙铁壁。', rules: ['swift_foes', 'hardened'] },
  { id: 'fortress', name: '铜墙铁壁 + 经济紧缩', desc: '铜墙铁壁 + 经济紧缩。', rules: ['hardened', 'austerity'] },
];

// 复合规则组：把成员规则的 hpMul/speedMul/goldMul/rangeMul 逐项相乘。
function composeRuleGroup(ids) {
  const result = { hpMul: 1, speedMul: 1, goldMul: 1, rangeMul: 1 };
  for (const id of ids) {
    const def = DAILY_RULE_BY_ID[id];
    result.hpMul *= def.hpMul;
    result.speedMul *= def.speedMul;
    result.goldMul *= def.goldMul;
    result.rangeMul *= def.rangeMul;
  }
  return {
    hpMul: round3(result.hpMul),
    speedMul: round3(result.speedMul),
    goldMul: round3(result.goldMul),
    rangeMul: round3(result.rangeMul),
  };
}

export const WEEKLY_RULE_GROUPS = WEEKLY_RULE_GROUP_DEFS.map((group) => ({
  id: `weekly:${group.id}`,
  name: group.name,
  desc: group.desc,
  // 组成该组的每日规则基础 id（不含 daily: 前缀），供客户端展示与测试核对复合效果。
  rules: group.rules,
  ...composeRuleGroup(group.rules),
}));

// 确定性选规则：与 run 种子无关的独立随机流，同一 key 服务端与浏览器结果一致。
function ruleIndex(key, namespace, length) {
  return new RNG(`${namespace}:${key}`).int(length);
}

// 当日规则：纯函数、无随机，同一天恒返回同一条规则（含词缀效果字段）。
export function dailyRule(day) {
  return DAILY_RULES[ruleIndex(String(day), 'daily-rule', DAILY_RULES.length)];
}

// 本周规则组：纯函数、无随机，同一周恒返回同一组（含复合词缀效果字段）。
export function weeklyRuleGroup(week) {
  return WEEKLY_RULE_GROUPS[ruleIndex(String(week), 'weekly-rule', WEEKLY_RULE_GROUPS.length)];
}
