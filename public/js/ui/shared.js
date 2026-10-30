// UI 公共工具：文案取值、数字格式化、图标注入与 HTML 转义，供 ui/ 各面板复用。
import { SKILLS, skillStats, skillUnlockText } from '../shared/data.js';
import { t, tData, tOr } from '../i18n.js';

// 转义与图标注入只有一份实现，放在 ui/kit/dom.js；这里转出以兼容既有导入。
export { escapeHtml, hydrateIcons } from './kit/dom.js';

export const $ = (id) => document.getElementById(id);

export const fmt = (n) => Number(n || 0).toLocaleString('en-US');

// 数据表只保存中文名；按 id 取当前语言译名，缺译名时回退原值。
export const towerName = (def) => tData('tower', def.id, 'name', def.name);
export const enemyName = (def) => tData('enemy', def.id, 'name', def.name);
export const diffName = (def) => tData('difficulty', def.id, 'name', def.name);
export const diffDesc = (def) => tData('difficulty', def.id, 'desc', def.desc);
export const modifierName = (modifier) =>
  modifier ? tData('modifier', modifier.id, 'name', modifier.name) : null;
export const modifierDesc = (modifier) =>
  modifier ? tData('modifier', modifier.id, 'desc', modifier.desc) : null;
export const ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ'];
// 角色标签表存词典键：文案在渲染时按当前语言解析，模块级常量不得调用 t()。
export const ROLE_LABELS = Object.freeze({
  control: 'skill.role.control',
  burst: 'skill.role.burst',
  ultimate: 'skill.role.ultimate',
});

// 进化修正展示：mods 统一是乘法系数，转成百分比文案；表里存词典键，渲染时再取译文。
export const EVOLUTION_LABELS = Object.freeze({
  dmg: 'uiShared.evolution.dmg',
  rate: 'uiShared.evolution.rate',
  range: 'uiShared.evolution.range',
  splash: 'uiShared.evolution.splash',
  slow: 'uiShared.evolution.slow',
  slowDur: 'uiShared.evolution.slowDur',
  chain: 'uiShared.evolution.chain',
  dot: 'uiShared.evolution.dot',
  dotDur: 'uiShared.evolution.dotDur',
  knockback: 'uiShared.evolution.knockback',
  buffDmg: 'uiShared.evolution.buffDmg',
  buffRate: 'uiShared.evolution.buffRate',
});

export function evolutionEffectText(evolution) {
  return Object.entries(evolution.mods || {})
    .map(([key, mul]) => {
      const pct = Math.round((mul - 1) * 100);
      const label = EVOLUTION_LABELS[key] ? t(EVOLUTION_LABELS[key]) : key;
      return `${label} ${pct >= 0 ? '+' : ''}${pct}%`;
    })
    .join(' · ');
}

// 「三选一」这类补充分支数量文案，避免写死二选一；表里存词典键。
export const CHOICE_LABELS = Object.freeze([
  '',
  'uiShared.choice.single',
  'uiShared.choice.two',
  'uiShared.choice.three',
  'uiShared.choice.four',
]);
export const choiceLabel = (count) =>
  CHOICE_LABELS[count] ? t(CHOICE_LABELS[count]) : t('uiShared.choice.n', { count });

// 技能数据表只有中文；按 id 取当前语言文案，缺译名回退数据原值。
export const skillName = (entry) => tOr(`skill.${entry.id}.name`, entry.name);
export const skillDesc = (entry) => tOr(`skill.${entry.id}.desc`, entry.desc);
export const skillRole = (entry) =>
  tOr(ROLE_LABELS[entry.role] || `skill.role.${entry.role}`, '');
export const skillUnlock = (entry) =>
  tOr(`skill.unlock.${SKILLS[entry.id]?.unlock}`, entry.unlockHint || skillUnlockText(entry.id));

// 技能卡摘要：只展示一个最能代表当前等级的数值。
export function skillSummary(id, level) {
  const stats = skillStats(id, level);
  if (!stats) return '';
  if (id === 'aurora') {
    return tOr(`skill.${id}.summary`, '', {
      freeze: stats.freeze.toFixed(1),
      slow: Math.round(stats.slow * 100),
      cd: Math.round(stats.cd),
    });
  }
  if (id === 'meteor') {
    return tOr(`skill.${id}.summary`, '', {
      meteors: stats.meteors,
      dmg: Math.round(stats.dmgPct * 100),
      cd: Math.round(stats.cd),
    });
  }
  return tOr(`skill.${id}.summary`, '', {
    stop: stats.stop.toFixed(1),
    overdrive: stats.overdrive.toFixed(1),
    cd: Math.round(stats.cd),
  });
}

// 选图缩略图：直接按固定地图的真实数据绘制——lane 折线、入口、基地与固定岩石，
// 不另画示意图，保证卡片预览与实际进入战斗的地形一致。
export function mapPreviewSvg(map) {
  const w = 220;
  const h = 120;
  const pad = 7;
  const sx = (w - pad * 2) / map.cols;
  const sy = (h - pad * 2) / map.rows;
  const rocks = (map.rocks || [])
    .map((rock) => {
      const size = Math.max(1.6, (rock.size || 0.3) * Math.min(sx, sy) * 1.7);
      const x = pad + (rock.c + 0.5) * sx - size / 2;
      const y = pad + (rock.r + 0.5) * sy - size / 2;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${size.toFixed(1)}" height="${size.toFixed(1)}" rx="${(size * 0.3).toFixed(1)}" fill="#26323a" opacity="0.85" />`;
    })
    .join('');
  const lanes = (map.lanes || [])
    .map((lane) => {
      const points = lane.polyline
        .map((p) => `${(pad + p.x * sx).toFixed(1)},${(pad + p.y * sy).toFixed(1)}`)
        .join(' ');
      return `<polyline points="${points}" fill="none" stroke="${lane.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.9" />`;
    })
    .join('');
  const spawns = (map.spawns || [])
    .map(
      (spawn) =>
        `<circle cx="${(pad + spawn.x * sx).toFixed(1)}" cy="${(pad + spawn.y * sy).toFixed(1)}" r="4.2" fill="${spawn.color}" stroke="#071014" stroke-width="1.5" />`
    )
    .join('');
  const base = `<circle cx="${(pad + map.base.x * sx).toFixed(1)}" cy="${(pad + map.base.y * sy).toFixed(1)}" r="5" fill="#4fd8c8" stroke="#d8fff9" stroke-width="1.5" />`;
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${t('mapSelect.preview')}">
    <rect width="${w}" height="${h}" rx="10" fill="#0a1319" />
    <g opacity="0.12" stroke="#6fa78a" stroke-width="0.5">
      ${Array.from({ length: map.cols + 1 }, (_, i) => `<line x1="${pad + i * sx}" y1="${pad}" x2="${pad + i * sx}" y2="${h - pad}" />`).join('')}
      ${Array.from({ length: map.rows + 1 }, (_, i) => `<line x1="${pad}" y1="${pad + i * sy}" x2="${w - pad}" y2="${pad + i * sy}" />`).join('')}
    </g>
    ${rocks}
    ${lanes}
    ${spawns}
    ${base}
  </svg>`;
}

// 契约卡（§5）：与遗物卡共用草稿弹窗、仍是 3 张；债契在刷新次数耗尽时置灰（代价不成立不可选）。
export function contractCardHtml(offer, index, { used = 0, max = 0 } = {}) {
  const scope = offer.chip?.scope === 'wave' ? 'wave' : 'run';
  const unaffordable = offer.id === 'debt' && used >= max;
  const factionTag = offer.faction
    ? `<span class="faction-tag">${t('draft.faction')} · ${t(`faction.${offer.faction}.name`)}</span>`
    : '';
  return `
    <button class="relic-card contract-card ${unaffordable ? 'locked' : ''}" data-index="${index}" ${unaffordable ? 'disabled' : ''} style="--rarity:#b26bff">
      <span class="rarity">${t('contract.eyebrow')} · ${t(`contract.chip.${scope}`)}</span>
      ${factionTag}
      <h3>${t(offer.nameKey)}</h3>
      <div class="relic-effect"><span>${t('draft.effect')}</span>${t(offer.descKey)}</div>
      <p class="relic-flavor">${t('contract.flavor')}</p>
      <span class="pick">${unaffordable ? t('contract.unaffordable') : t('draft.pick')}</span>
    </button>
  `;
}
