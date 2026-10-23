// 局内事件节点：每 5 波一次的事件。纯数据 + 纯函数，服务端与浏览器共用。
// 事件类型与选项只在这里定义；前端只展示，效果结算也走这里的纯函数。
import { RNG } from './rng.js';

// 触发波次：第 5/10/15/20/25 波清除后进入事件阶段。
export const EVENT_WAVES = Object.freeze([5, 10, 15, 20, 25]);

// 事件池：5 类常规事件 + 3 类稀有事件。weight 越大越常见，rare 仅用于展示。
export const EVENT_ORDER = Object.freeze([
  'altar',
  'caravan',
  'gamble',
  'tower-smith',
  'supply-drop',
  'abyss-contract',
  'relic-forge',
  'fate-wheel',
]);

// requires：执行该选项的最低资源（gold 为金币，hp 为当前生命，maxHp 为生命上限）。
// deltas：固定增减；gamble：确定性赌局，按 ${seed}:event:${wave}:${eventId}:${optionId} 掷骰。
// 每个非“离开”选项都必须有明确代价，避免无脑选。
export const EVENTS = Object.freeze({
  altar: {
    id: 'altar',
    name: '祭坛',
    desc: '古老石台上还留着未冷的灰烬。',
    weight: 10,
    rare: false,
    options: [
      {
        id: 'blood',
        name: '血祭',
        desc: '失去 2 点基地生命，换取 60 金币。',
        requires: { hp: 3 },
        deltas: { gold: 60, hp: -2 },
      },
      {
        id: 'offering',
        name: '供奉',
        desc: '花费 50 金币，基地生命上限 +3 并回复 3 点。',
        requires: { gold: 50 },
        deltas: { gold: -50, hp: 3, maxHp: 3 },
      },
      {
        id: 'leave',
        name: '离开',
        desc: '不冒犯，也不索取。',
        deltas: {},
      },
    ],
  },
  caravan: {
    id: 'caravan',
    name: '商队',
    desc: '一支风尘仆仆的商队停靠在塔下。',
    weight: 10,
    rare: false,
    options: [
      {
        id: 'supplies',
        name: '购买补给',
        desc: '花费 40 金币，回复 5 点基地生命。',
        requires: { gold: 40 },
        deltas: { gold: -40, hp: 5 },
      },
      {
        id: 'barter',
        name: '拆卖建材',
        desc: '获得 55 金币，基地生命上限 -1。',
        requires: { maxHp: 2 },
        deltas: { gold: 55, maxHp: -1 },
      },
      {
        id: 'leave',
        name: '送行',
        desc: '不为所动，目送商队远去。',
        deltas: {},
      },
    ],
  },
  gamble: {
    id: 'gamble',
    name: '赌局',
    desc: '骰子在陶碗里翻滚，发出细碎的响声。',
    weight: 10,
    rare: false,
    options: [
      {
        id: 'small',
        name: '小赌',
        desc: '押 30 金币：五成赢 60，五成血本无归。',
        requires: { gold: 30 },
        gamble: { chance: 0.5, win: { gold: 60 }, lose: { gold: -30 } },
      },
      {
        id: 'big',
        name: '豪赌',
        desc: '押 60 金币：四成赢 150，六成血本无归。',
        requires: { gold: 60 },
        gamble: { chance: 0.4, win: { gold: 150 }, lose: { gold: -60 } },
      },
      {
        id: 'leave',
        name: '收手',
        desc: '把骰子推回去，转身离开。',
        deltas: {},
      },
    ],
  },
  'tower-smith': {
    id: 'tower-smith',
    name: '塔匠',
    desc: '一位背着石锤的老匠人绕着塔基打量。',
    weight: 10,
    rare: false,
    options: [
      {
        id: 'fortify',
        name: '加固塔基',
        desc: '花费 60 金币，基地生命上限 +3 并回复 2 点。',
        requires: { gold: 60 },
        deltas: { gold: -60, hp: 2, maxHp: 3 },
      },
      {
        id: 'repair',
        name: '修补裂痕',
        desc: '花费 30 金币，回复 4 点基地生命。',
        requires: { gold: 30 },
        deltas: { gold: -30, hp: 4 },
      },
      {
        id: 'leave',
        name: '谢绝',
        desc: '让匠人继续赶路。',
        deltas: {},
      },
    ],
  },
  'supply-drop': {
    id: 'supply-drop',
    name: '补给空投',
    desc: '一只补给箱砸在塔外的碎石地上。',
    weight: 10,
    rare: false,
    options: [
      {
        id: 'salvage',
        name: '拆箱回收',
        desc: '获得 45 金币，但拆走一块承重石：基地生命上限 -1。',
        requires: { maxHp: 2 },
        deltas: { gold: 45, maxHp: -1 },
      },
      {
        id: 'triage',
        name: '紧急救治',
        desc: '花费 25 金币，把药品用在守军身上：回复 3 点基地生命。',
        requires: { gold: 25 },
        deltas: { gold: -25, hp: 3 },
      },
      {
        id: 'leave',
        name: '不去理会',
        desc: '箱子里也许只有碎石。',
        deltas: {},
      },
    ],
  },
  'abyss-contract': {
    id: 'abyss-contract',
    name: '深渊契约',
    desc: '塔基深处传来低语，仿佛在替你起草一份契约。',
    weight: 2,
    rare: true,
    options: [
      {
        id: 'blood-pact',
        name: '血契',
        desc: '失去 3 点基地生命，换取 120 金币。',
        requires: { hp: 4 },
        deltas: { gold: 120, hp: -3 },
      },
      {
        id: 'borrow',
        name: '预支财富',
        desc: '获得 80 金币，代价是基地生命上限 -2。',
        requires: { maxHp: 3 },
        deltas: { gold: 80, maxHp: -2 },
      },
      {
        id: 'refuse',
        name: '拒绝',
        desc: '把契约撕碎，低语随之沉寂。',
        deltas: {},
      },
    ],
  },
  'relic-forge': {
    id: 'relic-forge',
    name: '遗物熔炉',
    desc: '一尊无人看管的熔炉仍在燃烧，炉膛里沉着旧时代的碎片。',
    weight: 3,
    rare: true,
    options: [
      {
        id: 'temper',
        name: '淬炼塔基',
        desc: '花费 100 金币，将熔液浇进塔基：基地生命上限 +5。',
        requires: { gold: 100 },
        deltas: { gold: -100, maxHp: 5 },
      },
      {
        id: 'scrap',
        name: '拆解边角',
        desc: '徒手撬下炉边的金属：获得 70 金币，失去 1 点基地生命。',
        requires: { hp: 2 },
        deltas: { gold: 70, hp: -1 },
      },
      {
        id: 'leave',
        name: '熄火离开',
        desc: '让炉火自行熄灭。',
        deltas: {},
      },
    ],
  },
  'fate-wheel': {
    id: 'fate-wheel',
    name: '命运轮盘',
    desc: '一只石轮嵌在塔壁上，刻度深浅不一。',
    weight: 2,
    rare: true,
    options: [
      {
        id: 'spin-small',
        name: '轻转',
        desc: '押 25 金币：五成五赢 50，其余血本无归。',
        requires: { gold: 25 },
        gamble: { chance: 0.55, win: { gold: 50 }, lose: { gold: -25 } },
      },
      {
        id: 'spin-big',
        name: '全力一掷',
        desc: '押 80 金币：三成五赢 200，其余血本无归。',
        requires: { gold: 80 },
        gamble: { chance: 0.35, win: { gold: 200 }, lose: { gold: -80 } },
      },
      {
        id: 'leave',
        name: '不转',
        desc: '把手从石轮上移开。',
        deltas: {},
      },
    ],
  },
});

export function isEventWave(wave) {
  return EVENT_WAVES.includes(Number(wave));
}

// 同一 seed + 波次永远得到同一个事件节点；用独立 RNG，不触碰战斗 RNG。
// 权重按事件定义读取，稀有事件 weight 低，整局序列仍可复现。
export function rollEvent(seed, wave) {
  if (!isEventWave(wave)) return null;
  const rng = new RNG(`${seed}:event:${wave}`);
  return rng.weighted(EVENT_ORDER.map((id) => EVENTS[id]));
}

export function findEventOption(event, optionId) {
  if (!event || !Array.isArray(event.options)) return null;
  return event.options.find((option) => option.id === String(optionId)) || null;
}

// 以“当前资源”判断选项是否可执行；只读，不结算。
export function canAffordEventOption(option, { gold = 0, baseHp = 1, maxHp = 1 } = {}) {
  if (!option) return false;
  const requires = option.requires || {};
  if ((requires.gold || 0) > gold) return false;
  if ((requires.hp || 0) > baseHp) return false;
  if ((requires.maxHp || 0) > maxHp) return false;
  return true;
}

/**
 * 结算事件选项：返回增量，不直接修改调用方状态。
 * @returns {{ok:true, eventId:string, optionId:string, deltas:object,
 *   gamble:null|{roll:number, won:boolean, chance:number}}|{ok:false, reason:string, optionId?:string}}
 */
export function resolveEventOption(event, optionId, ctx = {}) {
  const option = findEventOption(event, optionId);
  if (!option) return { ok: false, reason: 'unknown-option' };
  if (!canAffordEventOption(option, ctx)) {
    return { ok: false, reason: 'unaffordable', optionId: option.id };
  }

  if (option.gamble) {
    const rng = new RNG(`${ctx.seed}:event:${ctx.wave}:${event.id}:${option.id}`);
    const roll = rng.float();
    const won = roll < option.gamble.chance;
    const deltas = won ? option.gamble.win : option.gamble.lose;
    return {
      ok: true,
      eventId: event.id,
      optionId: option.id,
      deltas: { ...deltas },
      gamble: { roll, won, chance: option.gamble.chance },
    };
  }

  return {
    ok: true,
    eventId: event.id,
    optionId: option.id,
    deltas: { ...(option.deltas || {}) },
    gamble: null,
  };
}

// 事件历史（快照/服务端审计共用）：每波只能记一次，未知事件或选项一律丢弃。
export function normalizeEventHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const history = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const wave = Number(item.wave);
    const event = EVENTS[item.eventId];
    if (!Number.isInteger(wave) || !isEventWave(wave) || !event) continue;
    const option = findEventOption(event, item.optionId);
    if (!option) continue;
    if (history.some((entry) => entry.wave === wave)) continue;
    history.push({ wave, eventId: event.id, optionId: option.id });
  }
  return history.sort((a, b) => a.wave - b.wave);
}

export function hasResolvedEvent(history, wave) {
  return (history || []).some((entry) => entry.wave === Number(wave));
}
