// UI 公共工具：文案取值、数字格式化、图标注入与 HTML 转义，供 ui/ 各面板复用。
import { SKILLS, skillStats, skillUnlockText } from '../shared/data.js';
import { t, tData, tOr } from '../i18n.js';
import { iconSvg } from '../render/canvas-shapes.js';

export const $ = (id) => document.getElementById(id);

// 静态页面用 data-icon 占位，初始化时统一注入程序化图标，避免在 HTML 里散落字符图标。
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((node) => {
    const markup = iconSvg(node.dataset.icon);
    if (markup) node.innerHTML = markup;
  });
}

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
export const ROLE_LABELS = { control: '控场', burst: '爆发', ultimate: '终极' };

// 进化修正展示：mods 统一是乘法系数，转成百分比文案。
export const EVOLUTION_LABELS = {
  dmg: '伤害',
  rate: '攻速',
  range: '射程',
  splash: '溅射',
  slow: '减速',
  slowDur: '减速时长',
  chain: '连锁',
  dot: '毒伤',
  dotDur: '毒伤时长',
  knockback: '击退',
  buffDmg: '光环增伤',
  buffRate: '光环攻速',
};

export function evolutionEffectText(evolution) {
  return Object.entries(evolution.mods || {})
    .map(([key, mul]) => {
      const pct = Math.round((mul - 1) * 100);
      return `${EVOLUTION_LABELS[key] || key} ${pct >= 0 ? '+' : ''}${pct}%`;
    })
    .join(' · ');
}

// 「三选一」这类补充分支数量文案，避免写死二选一。
export const CHOICE_LABELS = ['', '单选', '二选一', '三选一', '四选一'];
export const choiceLabel = (count) => CHOICE_LABELS[count] || `${count} 选一`;

// 技能数据表只有中文；按 id 取当前语言文案，缺译名回退数据原值。
export const skillName = (entry) => tOr(`skill.${entry.id}.name`, entry.name);
export const skillDesc = (entry) => tOr(`skill.${entry.id}.desc`, entry.desc);
export const skillRole = (entry) => tOr(`skill.role.${entry.role}`, ROLE_LABELS[entry.role] || '');
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

export function mapPreviewSvg(map) {
  const w = 220;
  const h = 120;
  const pad = 7;
  const sx = (w - pad * 2) / map.cols;
  const sy = (h - pad * 2) / map.rows;
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
    ${lanes}
    ${spawns}
    ${base}
  </svg>`;
}

export function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
