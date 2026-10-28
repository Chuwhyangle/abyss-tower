// 遗物图鉴的文案推导与 HTML 渲染：效果/周期/套装进度文案，详情卡片与列表主体。
// 只读共享数据与效果注册表；数据表在 relic-codex-data.js，面板接线在 relic-codex-ui.js。
import { t, tData, tOr } from './i18n.js';
import {
  RARITY,
  RELICS,
  RELIC_LEVEL_LABELS,
  RELIC_MAX_LEVEL,
  TOWERS,
  relicModsAtLevel,
} from './shared/data.js';
import {
  RELIC_SET_BONUSES,
  effectPeriodicInfo,
  relicSetMaxPieces,
  relicSetTierBonuses,
} from './shared/effects.js';
import { escapeHtml } from './ui/kit/dom.js';
import { RARITY_ORDER, effectValueText } from './relic-codex-data.js';

export function effectLine(key, value, towerType = null) {
  const params = effectValueText(key, value);
  if (key === 'dmg' && towerType) {
    params.tower = tData('tower', towerType, 'name', TOWERS[towerType]?.name || towerType);
  }
  return tOr(`codex.effect.${key}`, `${key} ${params.value}`, params);
}

// 某件遗物在指定等级的全部效果文案；顺序与 RELICS 里的 mods 声明顺序一致。
export function effectSummary(relicOrId, level = 1) {
  const mods = relicModsAtLevel(relicOrId, level);
  const parts = [];
  for (const [key, value] of Object.entries(mods)) {
    if (key === 'dmg') {
      for (const [type, amount] of Object.entries(value)) {
        if (amount) parts.push(effectLine('dmg', amount, type));
      }
    } else if (typeof value === 'number' && value !== 0) {
      parts.push(effectLine(key, value));
    }
  }
  return parts.join(t('codex.effectJoiner'));
}

export function rarityName(rarity) {
  return tOr(`codex.rarity.${rarity}`, RARITY[rarity]?.name || rarity);
}

export function setName(setId) {
  return tOr(`codex.set.${setId}`, RELIC_SET_BONUSES[setId]?.name || setId);
}

// 回合型遗物的触发周期（只读查询，周期本身由效果注册表声明）；非回合型返回空数组。
export function relicPeriodInfo(relicOrId, level = 1) {
  const infos = [];
  for (const [key, value] of Object.entries(relicModsAtLevel(relicOrId, level))) {
    if (typeof value !== 'number' || !value) continue;
    const periodic = effectPeriodicInfo(key);
    if (periodic) infos.push({ key, value, ...periodic });
  }
  return infos;
}

export function periodicText(relicOrId, level = 1) {
  const periods = [...new Set(relicPeriodInfo(relicOrId, level).map((info) => info.period))]
    .sort((a, b) => a - b);
  return periods.map((period) => t('codex.period', { period })).join(t('codex.effectJoiner'));
}

// 套装进度：只统计已收录的不同遗物；分母取共享数据里的最高档位（当前为 4）。
export function setProgress(setId, discovered = []) {
  if (!setId || !RELIC_SET_BONUSES[setId]) return null;
  const known = discovered instanceof Set ? discovered : new Set(discovered || []);
  const owned = RELICS.filter((relic) => relic.set === setId && known.has(relic.id)).length;
  const total = relicSetMaxPieces(setId);
  const pieces = Math.min(owned, total);
  return {
    id: setId,
    name: setName(setId),
    owned,
    pieces,
    total,
    activeTiers: relicSetTierBonuses(setId, owned),
    text: t('codex.setProgress', { name: setName(setId), pieces, total }),
  };
}

// 等级对比：Ⅰ→Ⅲ 的数值文案全部来自 relicModsAtLevel 的共享等级因子。
export function levelComparison(relicOrId, currentLevel = 1) {
  return Array.from({ length: RELIC_MAX_LEVEL }, (_, index) => ({
    level: index + 1,
    label: RELIC_LEVEL_LABELS[index],
    current: index + 1 === currentLevel,
    summary: effectSummary(relicOrId, index + 1),
  }));
}

export function filterRelics(relics, { rarity = 'all', set = 'all', query = '', discovered = [] } = {}) {
  const known = discovered instanceof Set ? discovered : new Set(discovered || []);
  const needle = String(query ?? '').trim().toLowerCase();
  return (relics || []).filter((relic) => {
    if (!relic) return false;
    if (rarity !== 'all' && relic.rarity !== rarity) return false;
    if (set === 'none') {
      if (relic.set) return false;
    } else if (set !== 'all' && relic.set !== set) {
      return false;
    }
    if (!needle) return true;
    const haystack = [
      relic.name,
      tOr(`codex.relic.${relic.id}.name`, relic.name),
      rarityName(relic.rarity),
      relic.set ? setName(relic.set) : t('codex.noSet'),
    ];
    // 未收录的条目只按可见信息检索，避免用搜索探测隐藏的效果描述。
    if (known.has(relic.id)) {
      haystack.push(relic.desc, tOr(`codex.relic.${relic.id}.desc`, relic.desc));
    }
    return haystack.filter(Boolean).join(' ').toLowerCase().includes(needle);
  });
}

export function groupByRarity(relics) {
  return RARITY_ORDER.map((rarity) => ({
    rarity,
    name: rarityName(rarity),
    items: (relics || []).filter((relic) => relic.rarity === rarity),
  })).filter((group) => group.items.length > 0);
}

export function renderRelicCard(relic, known, { discovered = [], currentLevel = 1 } = {}) {
  const rarity = RARITY[relic.rarity] ? relic.rarity : 'common';
  const name = tOr(`codex.relic.${relic.id}.name`, relic.name);
  const setTag = relic.set
    ? `<span class="codex-set">${escapeHtml(setName(relic.set))}</span>`
    : '';
  const head = `
    <header>
      <h3>${escapeHtml(name)}</h3>
      <span class="codex-rarity">${escapeHtml(rarityName(rarity))}</span>
      ${setTag}
    </header>`;
  if (!known) {
    return `
      <article class="codex-card rarity-${rarity}" data-relic-id="${escapeHtml(relic.id)}" data-known="false">
        ${head}
        <p class="codex-desc">${escapeHtml(t('codex.unknownEffects'))}</p>
      </article>`;
  }
  const desc = tOr(`codex.relic.${relic.id}.desc`, relic.desc);
  const period = periodicText(relic.id);
  const progress = setProgress(relic.set, discovered);
  const levels = levelComparison(relic.id, currentLevel)
    .map(
      ({ label, summary, level, current }) => `
        <li data-level="${level}"${current ? ' data-current="true"' : ''}>
          <span class="codex-level">${escapeHtml(label)}</span>
          <span>${escapeHtml(summary)}</span>
        </li>`
    )
    .join('');
  const periodLine = period
    ? `<p class="codex-period">${escapeHtml(period)}</p>`
    : '';
  const progressLine = progress
    ? `<p class="codex-set-progress">${escapeHtml(progress.text)}</p>`
    : '';
  return `
    <article class="codex-card rarity-${rarity}" data-relic-id="${escapeHtml(relic.id)}" data-known="true">
      ${head}
      <p class="codex-desc">${escapeHtml(desc)}</p>
      ${periodLine}
      ${progressLine}
      <ul class="codex-levels" aria-label="${escapeHtml(t('codex.levelCompare'))}">${levels}</ul>
    </article>`;
}

// 图鉴主体（列表）：筛选 + 按稀有度分组 + 未知条目遮罩。
export function renderCodex({ relics = RELICS, discovered = [], filters = {} } = {}) {
  const known = discovered instanceof Set ? discovered : new Set(discovered || []);
  const list = filterRelics(relics, { ...filters, discovered: known });
  const knownCount = (relics || []).filter((relic) => known.has(relic.id)).length;
  const progressText = t('codex.progress', { known: knownCount, total: (relics || []).length });
  const body = list.length
    ? groupByRarity(list)
        .map(
          (group) => `
            <section class="codex-group" data-rarity="${group.rarity}">
              <h3 class="codex-group-title">${escapeHtml(group.name)} · ${group.items.length}</h3>
              <div class="codex-grid">
                ${group.items
                  .map((relic) => renderRelicCard(relic, known.has(relic.id), { discovered: known }))
                  .join('')}
              </div>
            </section>`
        )
        .join('')
    : `<p class="codex-empty">${escapeHtml(t('codex.empty'))}</p>`;
  return { progressText, body };
}
