// 单位精灵覆盖表：六类实体的权威 id 集、状态优先级与纯状态选择器。
// 导入期零 DOM、零随机、不 import sim/render：状态来源是模拟层已有的只读字段，
// 选择器只做「字段 → 状态名」的映射，未知输入返回 null（渲染器据此走既有程序化路径）。
// 覆盖集的权威定义见 docs/PHASE_FEEL_ART.md §4.3；新增实体必须同时进本表与覆盖测试。
import { ENEMIES, RELICS, TOWERS } from '../shared/data.js';
import { BOSS_VARIANTS } from '../shared/data/enemies.js';
import { DESTRUCTIBLE_BY_ID, DESTRUCTIBLE_TYPES } from '../shared/destructibles.js';

export const ENTITY_SPRITE_FAMILIES = Object.freeze([
  'tower',
  'enemy',
  'summon',
  'destructible',
  'portal',
  'base',
]);

// 召唤物 kind 的唯一来源是海克斯的 ctx.spawnAlly 调用；新增 kind 必须同步这里，
// 覆盖测试会扫描 public/js/shared/hexes/ 源码复核两边一致。
export const SUMMON_KINDS = Object.freeze(['skeleton']);
export const PORTAL_ENTITY_ID = 'spawn';
export const BASE_ENTITY_ID = 'crystal';

// 帧内形体的标称半径（逻辑像素）：渲染器据此把 48×48 帧等比缩放到实体的模拟半径，
// 生成器用同一常量作画，两边不会各写一个魔数。
export const ENEMY_SPRITE_RADIUS = 14;
export const SUMMON_SPRITE_RADIUS = 12;

// 每族的默认状态集与锚点；单实体可在 entityRecord 里覆盖（首领多一帧吟唱）。
export const ENTITY_FAMILY_DEFAULTS = Object.freeze({
  tower: Object.freeze({ anchor: 'center', states: Object.freeze(['idle', 'attack', 'disabled']) }),
  enemy: Object.freeze({ anchor: 'foot', states: Object.freeze(['move', 'hit']) }),
  summon: Object.freeze({ anchor: 'foot', states: Object.freeze(['idle', 'attack']) }),
  destructible: Object.freeze({ anchor: 'center', states: Object.freeze(['alive', 'ruined']) }),
  portal: Object.freeze({ anchor: 'center', states: Object.freeze(['idle', 'charge']) }),
  base: Object.freeze({ anchor: 'center', states: Object.freeze(['idle', 'hurt']) }),
});

// 实体状态 → art-tokens 的动效令牌：清单一律按令牌记录 states 字段，
// 实体自己的状态机（move/cast/ruined…）由本模块与覆盖测试持有。
export const ENTITY_STATE_TOKENS = Object.freeze({
  idle: 'idle',
  attack: 'attack',
  disabled: 'hit',
  move: 'idle',
  hit: 'hit',
  cast: 'attack',
  alive: 'idle',
  ruined: 'death',
  charge: 'attack',
  hurt: 'hit',
});

// 精灵 id 命名：<family>.<entity-id>.<state>（PHASE_FEEL_ART §4.1）。
export function entitySpriteName(family, entityId, state) {
  return `${family}.${entityId}.${state}`;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

// 独塔为王 3/6/9/10 级视觉分层：tower.level 为 0 起索引，3/6/9 级各解锁一条进化、
// 10 级解锁大招。这里把「等级索引 → 视觉档位」压成纯函数，渲染层据此叠加进化符文与大招光环。
export function towerVisualTier(level) {
  if (!Number.isFinite(level) || level < 0) return 0;
  if (level >= 9) return 4;
  if (level >= 8) return 3;
  if (level >= 5) return 2;
  if (level >= 2) return 1;
  return 0;
}

// 已记上塔的进化 id：evolutions 完整列表，evolution 仅为旧字段兼容；只保留该塔真实存在的路线。
export function towerAppliedEvolutions(tower) {
  if (!tower || typeof tower !== 'object') return [];
  const def = TOWERS[tower.type];
  if (!def) return [];
  const applied = Array.isArray(tower.evolutions)
    ? tower.evolutions
    : typeof tower.evolution === 'string'
      ? [tower.evolution]
      : [];
  return applied.filter((id) => def.evolutions?.some((evolution) => evolution.id === id));
}

// 大招专属特效（独塔 10 级）：每塔一档，形态/配色与命中签名同源，但粒子、半径、时长整体放大，
// 形成「这一发是大招」的专属爆发层。8 塔形态两两不同（shape + accent 各不重复）。
export const ULTIMATE_VISUALS = deepFreeze({
  arrow: { shape: 'needle', color: '#8fe0a8', accent: '#d8ffe3', particles: 9, spread: 0.5, duration: 0.16, size: 2.2, ring: 0.5, spin: 0.2 },
  cannon: { shape: 'burst', color: '#f0a35e', accent: '#ffe2bd', particles: 14, spread: 1.1, duration: 0.3, size: 3.6, ring: 0.9, spin: 0.04 },
  frost: { shape: 'crystal', color: '#7cd4f5', accent: '#d9f2ff', particles: 11, spread: 0.8, duration: 0.2, size: 2.8, ring: 0.55, spin: 0.3 },
  arc: { shape: 'arc', color: '#b48cff', accent: '#e8dcff', particles: 13, spread: 0.95, duration: 0.22, size: 3, ring: 0.6, spin: 0.45 },
  poison: { shape: 'motes', color: '#9adf6a', accent: '#d9f7bb', particles: 18, spread: 1.4, duration: 0.2, size: 2.5, ring: 0.7, spin: 0.12 },
  banner: { shape: 'aura', color: '#f5c451', accent: '#ffe9a8', particles: 6, spread: 6.283, duration: 0.55, size: 3.2, ring: 1.6, spin: 0.6 },
  shock: { shape: 'wave', color: '#6fe3c8', accent: '#ccfff4', particles: 11, spread: 1.05, duration: 0.26, size: 3.6, ring: 1.0, spin: 0.08 },
  sniper: { shape: 'lance', color: '#8fb8ff', accent: '#dbe8ff', particles: 7, spread: 0.28, duration: 0.18, size: 2.6, ring: 0.4, spin: 0.5 },
});

export const ULTIMATE_TOWER_TYPES = Object.freeze(Object.keys(ULTIMATE_VISUALS).sort());

// 未知塔型返回 null（渲染层走既有命中签名，不叠加专属大招层）。
export function ultimateVisual(type) {
  return typeof type === 'string' && Object.hasOwn(ULTIMATE_VISUALS, type) ? ULTIMATE_VISUALS[type] : null;
}

function entityRecord(family, entityId, states = ENTITY_FAMILY_DEFAULTS[family].states) {
  const map = {};
  for (const state of states) map[state] = entitySpriteName(family, entityId, state);
  return deepFreeze({
    id: `${family}.${entityId}`,
    family,
    entityId,
    states: map,
    anchor: ENTITY_FAMILY_DEFAULTS[family].anchor,
    scale: 1,
  });
}

// 塔形态：8 型底座 + 每型 3 条进化（进化形态是独立实体，取最后一个已应用形态）。
function towerForms() {
  const forms = [];
  for (const [typeId, def] of Object.entries(TOWERS)) {
    forms.push(entityRecord('tower', typeId));
    for (const evolution of def.evolutions || []) forms.push(entityRecord('tower', evolution.id));
  }
  return forms;
}

// 敌人：12 型 + 3 个首领变体；首领（含变体）多一帧吟唱，其余两帧。
function enemyForms() {
  const forms = [];
  for (const [typeId, def] of Object.entries(ENEMIES)) {
    const states = def.boss ? ['move', 'hit', 'cast'] : ['move', 'hit'];
    forms.push(entityRecord('enemy', typeId, states));
  }
  for (const variantId of Object.keys(BOSS_VARIANTS)) {
    forms.push(entityRecord('enemy', variantId, ['move', 'hit', 'cast']));
  }
  return forms;
}

function buildSprites() {
  const records = [
    ...towerForms(),
    ...enemyForms(),
    ...SUMMON_KINDS.map((kind) => entityRecord('summon', kind)),
    ...DESTRUCTIBLE_TYPES.map((type) => entityRecord('destructible', type.id)),
    entityRecord('portal', PORTAL_ENTITY_ID),
    entityRecord('base', BASE_ENTITY_ID),
  ];
  const table = {};
  for (const record of records) table[record.id] = record;
  return deepFreeze(table);
}

// entity id（`<family>.<entity>`）→ { id, family, entityId, states, anchor, scale }。
export const ENTITY_SPRITES = buildSprites();

export function entitySprite(id) {
  return typeof id === 'string' && Object.hasOwn(ENTITY_SPRITES, id) ? ENTITY_SPRITES[id] : null;
}

// 稳定的实体顺序：塔 → 敌人 → 召唤物 → 可破坏物 → 传送门 → 基地。
export function entityRecords() {
  return Object.values(ENTITY_SPRITES);
}

// 全部状态级精灵 id（生成器与覆盖测试共同枚举）。
export function entitySpriteIds() {
  const ids = [];
  for (const record of entityRecords()) ids.push(...Object.values(record.states));
  return ids;
}

const ENTITY_ID_PATTERN = /^(tower|enemy|summon|destructible|portal|base)\./;

// 覆盖缺口：清单缺哪些实体状态帧、又多了哪些未登记的实体帧。
// 只关心实体命名空间，散图/其它类目（如 fx/probe）不参与比较。
export function coverageGaps(manifest) {
  const list = Array.isArray(manifest) ? manifest : Array.isArray(manifest?.entries) ? manifest.entries : [];
  const declared = new Set(list.map((entry) => entry?.id).filter((id) => typeof id === 'string' && id));
  const required = entitySpriteIds();
  const missing = required.filter((id) => !declared.has(id));
  const extra = [...declared]
    .filter((id) => ENTITY_ID_PATTERN.test(id) && !required.includes(id))
    .sort();
  return { required, missing, extra };
}

// 形态选择：进化是完整列表时取最后一个已应用形态（规则冻结，见 §4.3）。
export function towerFormId(tower) {
  if (!tower || typeof tower !== 'object') return null;
  const def = TOWERS[tower.type];
  if (!def) return null;
  const applied = Array.isArray(tower.evolutions)
    ? tower.evolutions
    : typeof tower.evolution === 'string'
      ? [tower.evolution]
      : [];
  for (let index = applied.length - 1; index >= 0; index -= 1) {
    const id = applied[index];
    if (def.evolutions?.some((evolution) => evolution.id === id)) return id;
  }
  return tower.type;
}

// 状态优先级：disabled > attack（后坐） > idle。
export function towerSpriteState(tower, now = 0) {
  if (!tower || typeof tower !== 'object' || !TOWERS[tower.type]) return null;
  const time = Number.isFinite(now) ? now : 0;
  if ((Number(tower.disabledUntil) || 0) > time) return 'disabled';
  return (Number(tower.recoil) || 0) > 0 ? 'attack' : 'idle';
}

export function towerSpriteId(tower, now = 0) {
  const form = towerFormId(tower);
  if (!form) return null;
  const state = towerSpriteState(tower, now);
  return state ? ENTITY_SPRITES[`tower.${form}`]?.states[state] ?? null : null;
}

// 首领变体优先：enemy.variant 命中 BOSS_VARIANTS 时用变体 id，否则用类型 id（null 变体即通用首领）。
export function enemyEntityId(enemy) {
  if (!enemy || typeof enemy !== 'object') return null;
  if (typeof enemy.variant === 'string' && BOSS_VARIANTS[enemy.variant]) return enemy.variant;
  return ENEMIES[enemy.type] ? enemy.type : null;
}

// 状态优先级：cast > hit > move；实体没有该状态时向下降级（不发散到未登记状态）。
export function enemySpriteState(enemy) {
  const id = enemyEntityId(enemy);
  if (!id) return null;
  const states = ENTITY_SPRITES[`enemy.${id}`]?.states;
  if (!states) return null;
  if (enemy.cast && states.cast) return 'cast';
  if ((Number(enemy.hitFlash) || 0) > 0 && states.hit) return 'hit';
  return states.move ? 'move' : null;
}

export function enemySpriteId(enemy) {
  const id = enemyEntityId(enemy);
  const state = enemySpriteState(enemy);
  return id && state ? ENTITY_SPRITES[`enemy.${id}`]?.states[state] ?? null : null;
}

// 盟友：出手后坐期间为攻击帧，其余待机；未知 kind 返回 null。
export function summonSpriteState(ally) {
  if (!ally || typeof ally !== 'object') return null;
  if (!SUMMON_KINDS.includes(ally.kind)) return null;
  return (Number(ally.recoil) || 0) > 0 ? 'attack' : 'idle';
}

export function summonSpriteId(ally) {
  const state = summonSpriteState(ally);
  return state ? ENTITY_SPRITES[`summon.${ally.kind}`]?.states[state] ?? null : null;
}

// 可破坏物：已毁 → ruined，存活 → alive；未知类型返回 null。
export function destructibleSpriteState(item) {
  if (!item || typeof item !== 'object' || !DESTRUCTIBLE_BY_ID[item.type]) return null;
  return item.destroyed === true ? 'ruined' : 'alive';
}

export function destructibleSpriteId(item) {
  const state = destructibleSpriteState(item);
  return state ? ENTITY_SPRITES[`destructible.${item.type}`]?.states[state] ?? null : null;
}

// 传送门：波次满格充能；整备阶段按蓄能呼吸在待机/充能两帧间切换；其余相位回退程序化。
export function portalSpriteState(phase, time = 0) {
  if (phase === 'wave') return 'charge';
  if (phase !== 'prep') return null;
  const t = Number.isFinite(time) ? time : 0;
  return Math.sin(t * 2.4) > 0 ? 'charge' : 'idle';
}

export function portalSpriteId(phase, time = 0) {
  const state = portalSpriteState(phase, time);
  return state ? ENTITY_SPRITES[`portal.${PORTAL_ENTITY_ID}`]?.states[state] ?? null : null;
}

// 基地：受击闪白优先，其次低血（≤35%）常驻受损帧；血量比非法返回 null。
export function baseSpriteState(hpRatio, hurtFlash = 0) {
  if (typeof hpRatio !== 'number' || !Number.isFinite(hpRatio)) return null;
  const ratio = Math.max(0, Math.min(1, hpRatio));
  const flash = Number.isFinite(hurtFlash) ? hurtFlash : 0;
  return flash > 0.05 || ratio <= 0.35 ? 'hurt' : 'idle';
}

export function baseSpriteId(hpRatio, hurtFlash = 0) {
  const state = baseSpriteState(hpRatio, hurtFlash);
  return state ? ENTITY_SPRITES[`base.${BASE_ENTITY_ID}`]?.states[state] ?? null : null;
}

// ── 程序化美术内容（立绘 + 遗物图标）的覆盖登记 ─────────────────────────────
// 与单位精灵同源：共享数据表是唯一权威，登记表只做「数据实体 → 覆盖 id」的映射。
// 立绘覆盖 8 塔 + 全部敌人 + 3 首领变体；遗物图标覆盖全部遗物。绘制在
// portrait-draw.js / relic-art.js（运行时程序化绘制，不进实体精灵图集）。

export const ART_KINDS = Object.freeze(['portrait', 'relic-icon']);

// 立绘实体 id：<family>.<entity>，塔 / 敌人 / 首领变体三族共用同一命名空间。
export function portraitEntityIds() {
  return [
    ...Object.keys(TOWERS).map((id) => `tower.${id}`),
    ...Object.keys(ENEMIES).map((id) => `enemy.${id}`),
    ...Object.keys(BOSS_VARIANTS).map((id) => `enemy.${id}`),
  ];
}

// 遗物图标 id：relic.<id>，覆盖 RELICS 全表。
export function relicIconIds() {
  return RELICS.map((relic) => `relic.${relic.id}`);
}

// 覆盖登记表：art kind → 覆盖 id 列表。绘制模块据此枚举要支持的实体，测试据此复核。
export const ART_COVERAGE = deepFreeze({
  portrait: deepFreeze(portraitEntityIds()),
  'relic-icon': deepFreeze(relicIconIds()),
});

// 覆盖缺口：绘制模块支持集与登记表是否一致（对称校验，多 / 少都报）。
export function artCoverageGaps(supported, kind) {
  const expected = ART_COVERAGE[kind];
  if (!expected) return { kind, missing: [], extra: [], valid: false };
  const declared = new Set(expected);
  const actual = new Set(Array.isArray(supported) ? supported : []);
  const missing = expected.filter((id) => !actual.has(id));
  const extra = [...actual].filter((id) => !declared.has(id)).sort();
  return { kind, missing, extra, valid: missing.length === 0 && extra.length === 0 };
}
