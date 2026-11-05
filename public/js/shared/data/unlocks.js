// 解锁项定义与可建造塔过滤。
import { TOWERS, TOWER_ORDER } from './towers.js';

export const UNLOCKS = [
  { id: 'tower_arc', name: '电弧塔', cost: 30, type: 'tower', desc: '解锁可建造的连锁闪电塔，无视护甲。' },
  { id: 'tower_poison', name: '毒雾塔', cost: 30, type: 'tower', desc: '解锁持续毒伤塔，毒伤无视护甲。' },
  { id: 'tower_banner', name: '战旗塔', cost: 30, type: 'tower', desc: '解锁为范围内防御塔提供伤害与攻速光环的战旗塔。' },
  { id: 'tower_shock', name: '震荡塔', cost: 30, type: 'tower', desc: '解锁范围减速与击退的震荡塔。' },
  { id: 'tower_sniper', name: '狙击塔', cost: 40, type: 'tower', desc: '解锁超远射程的单体狙击塔。' },
  { id: 'start_gold', name: '启动资金', cost: 20, type: 'perk', desc: '每局初始金币 +40。' },
  { id: 'start_hp', name: '加固基地', cost: 20, type: 'perk', desc: '每局基地生命 +3。' },
  { id: 'extra_reroll', name: '命运骰子', cost: 15, type: 'perk', desc: '每局遗物刷新次数 +2。' },
  { id: 'start_relic', name: '先见之明', cost: 40, type: 'perk', desc: '开局随机获得一件遗物。' },
];

export const UNLOCK_BY_ID = Object.fromEntries(UNLOCKS.map((u) => [u.id, u]));

export function unlockedTowerIds(unlocks) {
  return TOWER_ORDER.filter((id) => !TOWERS[id].unlock || unlocks.includes(TOWERS[id].unlock));
}

// —— 塔升星（星核长期消耗出口）——
// 账号级星级：每座可解锁塔从 1★ 起步，消耗星核逐级升到 TOWER_STAR_MAX 星。
// 纯数据 + 纯函数，不 import 运行时模块；星级只做账号收藏/展示，不改变战斗数值（不碰 sim/确定性）。
export const TOWER_STAR_MAX = 5;

// 升到对应星级所需星核（从低到高逐级累加，拉长毕业周期）。
export const TOWER_STAR_COST = Object.freeze({ 2: 30, 3: 60, 4: 120, 5: 240 });

// 从 currentStar 升到下一级的花费；已满级或非法星级返回 null。
export function towerStarUpCost(currentStar) {
  const star = Math.max(1, Math.floor(Number(currentStar) || 1));
  const next = star + 1;
  return next <= TOWER_STAR_MAX ? TOWER_STAR_COST[next] : null;
}

// 可升星塔 id 列表：只允许有 unlock 门槛的塔（免费基础塔保持 1★ 不参与升星）。
export function towerStarTowerIds() {
  return TOWER_ORDER.filter((id) => TOWERS[id].unlock);
}

// 归一化账号星级状态：脏输入收敛到 { stars: { towerId: star } }，star ∈ [1, TOWER_STAR_MAX]。
export function normalizeTowerStars(raw) {
  const stars = {};
  if (raw && raw.stars && typeof raw.stars === 'object') {
    for (const id of towerStarTowerIds()) {
      const star = Math.max(1, Math.min(TOWER_STAR_MAX, Math.floor(Number(raw.stars[id]) || 1)));
      if (star > 1) stars[id] = star;
    }
  }
  return { stars };
}

// 指定塔的当前星级；未升过返回 1。
export function towerStarOf(state, towerId) {
  return Math.max(1, Math.floor(Number(state?.stars?.[towerId]) || 1));
}
