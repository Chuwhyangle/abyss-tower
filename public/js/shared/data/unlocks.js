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
