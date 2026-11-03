// 大厅天赋树面板：三系 8 节点可视，花传承之核投入节点；投入由服务端在事务内扣材料并持久化。
// 视觉沿用成就面板的既有样式，只补少量节点专用规则（meta-tree-*），不新增第三方依赖。
import { api } from '../api.js';
import { escapeHtml } from './kit/dom.js';
import { createPanel } from './kit/panel.js';
import { t, tData } from '../i18n.js';
import { TALENT_BY_ID, TALENT_CATEGORIES, TALENT_NODES } from '../shared/data/meta.js';

const PANEL_ID = 'meta-tree-panel';
const LIST_ID = 'meta-tree-list';
const BUTTON_ID = 'btn-meta-tree';
const BALANCE_ID = 'meta-tree-balance';
const SUMMARY_ID = 'meta-tree-summary';

// 展示顺序与服务端数据表一致（塔防 → 技能 → 经济）。
const CATEGORY_ORDER = ['tower', 'skill', 'economy'];

function fmt(value) {
  return Number(value || 0).toLocaleString('en-US');
}

// 节点名/描述来自词典 data.talent.<id>.*；数据表中文只是 tData 的不可达回退。
function nodeName(id) {
  return tData('talent', id, 'name', TALENT_BY_ID[id]?.name || id);
}

function nodeDesc(id) {
  return tData('talent', id, 'desc', TALENT_BY_ID[id]?.desc || '');
}

function categoryName(categoryId) {
  return tData('talent.category', categoryId, 'name', TALENT_CATEGORIES[categoryId]?.name || categoryId);
}

function legacyCoreName() {
  return tData('legacy.material', 'legacy_core', 'name', '传承之核');
}

function investButton(node, view) {
  if (view.maxed) {
    return `<button class="btn small" type="button" disabled>${escapeHtml(t('talent.maxed'))}</button>`;
  }
  const label = t('talent.invest');
  return `<button class="btn small primary" type="button" data-invest="${escapeHtml(node.id)}" ${view.canInvest ? '' : 'disabled'}>${escapeHtml(label)}</button>`;
}

function nodeCard(node, view) {
  const rank = Math.max(0, Math.floor(Number(view.rank) || 0));
  const cost = Math.max(0, Math.floor(Number(view.cost) || 0));
  const investedClass = rank > 0 ? ' unlocked' : '';
  return `
    <article class="achievement-card rarity-common talent-node${investedClass}" data-node="${escapeHtml(node.id)}">
      <h3>
        <span>${escapeHtml(nodeName(node.id))}</span>
        <span class="achievement-rarity">${rank} / ${node.maxRank}</span>
      </h3>
      <p>${escapeHtml(nodeDesc(node.id))}</p>
      <div class="talent-node-actions">
        ${investButton(node, view)}
        <span class="talent-cost">${cost} ${escapeHtml(legacyCoreName())}</span>
      </div>
    </article>`;
}

function categorySection(categoryId, views) {
  const nodes = TALENT_NODES.filter((node) => node.category === categoryId);
  if (!nodes.length) return '';
  return `
    <section class="achievement-group">
      <h4 class="achievement-group-title">${escapeHtml(categoryName(categoryId))}</h4>
      <div class="achievement-group-grid">${nodes.map((node) => nodeCard(node, views.get(node.id))).join('')}</div>
    </section>`;
}

function render(panel, data) {
  const balance = panel.querySelector(`#${BALANCE_ID}`);
  const summary = panel.querySelector(`#${SUMMARY_ID}`);
  const list = panel.querySelector(`#${LIST_ID}`);

  const cores = Math.max(0, Math.floor(Number(data?.wallet?.legacyCores) || 0));
  if (balance) balance.textContent = `${fmt(cores)} ${legacyCoreName()}`;
  if (summary) {
    const spent = Math.max(0, Math.floor(Number(data?.talent?.spent) || 0));
    summary.textContent = t('talent.spent', { spent });
  }

  const views = new Map(
    (Array.isArray(data?.nodes) ? data.nodes : []).map((node) => [node.id, node])
  );
  list.innerHTML = CATEGORY_ORDER.map((categoryId) => categorySection(categoryId, views)).join('');
  for (const button of list.querySelectorAll('[data-invest]')) {
    button.addEventListener('click', () => invest(panel, button.dataset.invest));
  }
}

async function invest(panel, nodeId) {
  const list = panel.querySelector(`#${LIST_ID}`);
  try {
    await api.request('/api/talent/invest', {
      method: 'POST',
      body: { nodeId },
    });
    await load(panel);
  } catch (error) {
    const note = document.createElement('p');
    note.className = 'achievement-hint';
    note.textContent = error.message || t('diagnostics.fallback');
    list.prepend(note);
  }
}

async function load(panel) {
  const list = panel.querySelector(`#${LIST_ID}`);
  list.innerHTML = `<p class="achievement-hint">${escapeHtml(t('seasonPass.loading'))}</p>`;
  try {
    const data = await api.request('/api/talent');
    render(panel, data);
  } catch (error) {
    if (error?.status === 401) {
      list.innerHTML = `<p class="achievement-hint">${escapeHtml(t('seasonPass.loginRequired'))}</p>`;
      return;
    }
    list.innerHTML = `<p class="achievement-hint">${escapeHtml(error?.message || t('seasonPass.loadFailed'))}</p>`;
  }
}

function install() {
  const button = document.getElementById(BUTTON_ID);
  const panel = document.getElementById(PANEL_ID);
  if (!button || !panel) return;

  createPanel({
    id: PANEL_ID,
    trigger: button,
    closeSelector: '#btn-meta-tree-close',
    onOpen: (node) => load(node),
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, { once: true });
} else {
  install();
}
