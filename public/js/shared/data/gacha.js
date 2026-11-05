// 抽卡池配置与纯函数：池、概率、价格、保底、碎片，全部按 docs/PHASE_抽卡.md §2-3 冻结。
// 纯数据 + 纯函数：无 DOM、无 Math.random、无 node 依赖。随机源由调用方注入（{ float() }），
// 服务端用 node:crypto 播种 shared/rng.js 的 RNG，测试用固定种子复现，绝不进入 sim.js 确定性流。
import { TOWER_RARITY } from './towers-rarity.js';

// 可抽塔：稀有度表里 poolable=true 的塔（6/5/4/3★，免费 1★ 不进池）。
export const GACHA_POOL_TOWER_IDS = Object.keys(TOWER_RARITY).filter(
  (id) => TOWER_RARITY[id].poolable
);

// 稀有度档位 → 概率（不含 1★/2★）。
export const GACHA_RATES = { 6: 0.05, 5: 0.12, 4: 0.28, 3: 0.55 };

// 单抽 / 十连价格（星核）。
export const GACHA_PRICE = { single: 15, ten: 150 };

// 保底：软保底 30 抽后每抽 +2%（31 抽 7%…），60 抽硬保底必出 6★。
export const GACHA_PITY = { softStart: 30, softStep: 0.02, hardCap: 60 };

// 重复转化碎片：按出货档位折算（升星消耗为阶段 2，本表只定义产出）。
export const GACHA_SHARDS = { 6: 40, 5: 20, 4: 10, 3: 5 };

function towersOfStar(star) {
  return GACHA_POOL_TOWER_IDS.filter((id) => TOWER_RARITY[id].star === star);
}

function pickUniform(rng, arr) {
  return arr[Math.min(arr.length - 1, Math.floor(rng.float() * arr.length))];
}

// 6★ 概率：基础 5%；软保底 30 抽后每抽 +2%；60 抽硬保底必出。
function sixStarRate(pity) {
  if (pity >= GACHA_PITY.hardCap - 1) return 1;
  return GACHA_RATES[6] + Math.max(0, pity - GACHA_PITY.softStart + 1) * GACHA_PITY.softStep;
}

// 单抽档位：先判定 6★，未中则在 5/4/3 之间按 12:28:55 权重归一化抽取。
function rollTier(rng, pity) {
  if (rng.float() < sixStarRate(pity)) return 6;
  const total = GACHA_RATES[5] + GACHA_RATES[4] + GACHA_RATES[3];
  let roll = rng.float() * total;
  if ((roll -= GACHA_RATES[5]) < 0) return 5;
  if ((roll -= GACHA_RATES[4]) < 0) return 4;
  return 3;
}

// 档位内选塔：6★ 首出必未拥有（优先从未拥有的 6★ 池塔中抽）；其余档位均匀抽取。
function rollTower(rng, star, owned) {
  const candidates = towersOfStar(star);
  if (star === 6) {
    const fresh = candidates.filter((id) => !owned.has(id));
    if (fresh.length > 0) return { towerId: pickUniform(rng, fresh), isNew: true };
  }
  const towerId = pickUniform(rng, candidates);
  return { towerId, isNew: !owned.has(towerId) };
}

// 抽卡主函数：注入随机源（{ float(): [0,1) }）保证确定性可复现。
// owned 为已拥有塔 id（数组或 Set），pity 为当前 6★ 保底计数（账号级，跨次继承）。
// 返回 { results: [{ towerId, star, rarity, isNew, shards }], pity6 }。
export function rollGacha(rng, count = 1, owned = [], pity = 0) {
  if (!rng || typeof rng.float !== 'function') {
    throw new Error('rollGacha 需要注入 { float() } 随机源');
  }
  const ownedSet = new Set(Array.isArray(owned) ? owned : owned ?? []);
  const n = Math.max(1, Math.floor(Number(count) || 1));
  const results = [];
  let pity6 = Math.max(0, Math.floor(Number(pity) || 0));
  for (let i = 0; i < n; i += 1) {
    const star = rollTier(rng, pity6);
    const { towerId, isNew } = rollTower(rng, star, ownedSet);
    results.push({
      towerId,
      star,
      rarity: TOWER_RARITY[towerId].rarity,
      isNew,
      shards: isNew ? 0 : GACHA_SHARDS[star],
    });
    ownedSet.add(towerId);
    pity6 = star === 6 ? 0 : pity6 + 1;
  }
  // 十连保底：全部 3★ 时强制末位升档为 4★。
  if (n === 10 && results.every((entry) => entry.star === 3)) {
    const last = results[results.length - 1];
    const towerId = pickUniform(rng, towersOfStar(4));
    last.towerId = towerId;
    last.star = 4;
    last.rarity = TOWER_RARITY[towerId].rarity;
    last.isNew = !ownedSet.has(towerId);
    last.shards = last.isNew ? 0 : GACHA_SHARDS[4];
  }
  return { results, pity6 };
}
