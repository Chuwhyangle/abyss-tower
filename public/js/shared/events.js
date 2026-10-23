// 局内事件节点：每 5 波一次的三选一事件。纯数据 + 纯函数，服务端与浏览器共用。
// 事件类型与选项只在这里定义；前端只展示，效果结算也走这里的纯函数。
import { RNG } from './rng.js';

// 触发波次：第 5/10/15/20/25 波清除后进入事件阶段。
export const EVENT_WAVES = Object.freeze([5, 10, 15, 20, 25]);

export const EVENT_ORDER = Object.freeze(['altar', 'caravan', 'gamble']);

// requires：执行该选项的最低资源（gold 为金币，hp 为当前生命，maxHp 为生命上限）。
// deltas：固定增减；gamble：确定性赌局，按 ${seed}:event:${wave}:${eventId}:${optionId} 掷骰。
export const EVENTS = Object.freeze({
  altar: {
    id: 'altar',
    name: '祭坛',
    desc: '古老石台上还留着未冷的灰烬。',
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
});

export function isEventWave(wave) {
  return EVENT_WAVES.includes(Number(wave));
}

// 同一 seed + 波次永远得到同一个事件节点；用独立 RNG，不触碰战斗 RNG。
export function rollEvent(seed, wave) {
  if (!isEventWave(wave)) return null;
  const rng = new RNG(`${seed}:event:${wave}`);
  const id = rng.pick(EVENT_ORDER);
  return EVENTS[id];
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
