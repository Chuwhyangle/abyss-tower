// 爬塔·阶段 1 UI：节点地图选择弹窗 + 商人弹窗。复用 modals.js 的 openModal 骨架，
// 不新开弹窗系统；纯函数（节点/商品展示模型）供单测直接调用，DOM 方法只做渲染与事件绑定。
// 节点只露类型 + 词缀，不露具体收益（docs/PHASE_TOWER.md §4.2 三闸之一）。
import { RELIC_BY_ID, RARITY, RELIC_LEVEL_LABELS } from '../shared/data.js';
import { TOWER_NODE_TYPES, successors } from '../shared/tower.js';
import { t, tOr } from '../i18n.js';
import { audio } from '../audio.js';
import { iconSvg } from '../render/canvas-shapes.js';
import { escapeHtml, fmt } from './shared.js';

// 节点类型 → 徽章配色：沿用既有稀有度/类型色系，无新色板。
const NODE_TYPE_COLOR = {
  fight: '#c9a227',
  event: '#b26bff',
  merchant: '#5ce2d0',
  elite: '#ff8a5c',
  boss: '#ff5c7a',
  treasure: '#ffd76a',
};

// 节点展示模型：只落类型 + 词缀文案（i18n），不落具体收益（纯函数）。
export function towerNodeView(node) {
  const type = TOWER_NODE_TYPES.includes(node?.type) ? node.type : 'fight';
  return {
    key: node?.key ?? null,
    layer: Number(node?.layer) || 0,
    column: Number(node?.column) || 0,
    type,
    label: t(`tower.node.${type}.name`),
    hint: t(`tower.node.${type}.hint`),
    color: NODE_TYPE_COLOR[type],
  };
}

// 节点状态分类（纯函数）：当前游标 / 已通过 / 未开放；可达后继由调用方用 successors 判定。
export function towerNodeState(node, { currentKey = null, path = [] } = {}) {
  if (node?.key === currentKey) return 'current';
  if (path.includes(node?.key)) return 'reached';
  return 'locked';
}

// 商人商品展示模型（纯函数）：遗物名 / 稀有度 / 价格 / 可负担；价格缺失按 0。
export function merchantOfferView(offer, { gold } = {}) {
  const relic = RELIC_BY_ID[offer?.id];
  const rarity = RARITY[offer?.rarity] || RARITY.common;
  const price = Number(offer?.price);
  const normalized = Number.isFinite(price) ? price : 0;
  return {
    id: offer?.id ?? null,
    name: relic ? tOr(`codex.relic.${relic.id}.name`, relic.name) : (offer?.id ?? ''),
    rarityKey: rarity.id,
    rarityName: rarity.name,
    color: rarity.color,
    price: normalized,
    affordable: !(Number(gold) < normalized),
    missing: !relic,
  };
}

// 商人出售条目展示模型（纯函数）：遗物名 / 等级 / 卖价；等级夹取到 1–3。
export function merchantSellView(entry) {
  const relic = RELIC_BY_ID[entry?.id];
  const level = Math.min(3, Math.max(1, Number(entry?.level) || 1));
  const price = Number(entry?.price);
  return {
    id: entry?.id ?? null,
    name: relic ? tOr(`codex.relic.${relic.id}.name`, relic.name) : (entry?.id ?? ''),
    levelLabel: RELIC_LEVEL_LABELS[level - 1],
    price: Number.isFinite(price) ? price : 0,
    missing: !relic,
  };
}

export const towerMethods = {
  // 标题页爬塔入口动态插入：排在无尽模式之后，保持标题页既有结构不变（放本模块避免 title.js 超行限）。
  buildTowerEntry() {
    if (this.el.tower || !this.el.endless) return;
    const button = document.createElement('button');
    button.id = 'btn-tower';
    button.type = 'button';
    button.className = 'btn ghost';
    button.innerHTML = `<span data-i18n="title.tower">${t('title.tower')}</span> <span id="tower-label" class="muted" data-i18n="title.tower.tag">${t('title.tower.tag')}</span>`;
    button.onclick = () => this.handlers.onTower?.();
    this.el.endless.insertAdjacentElement('afterend', button);
    this.el.tower = button;
  },

  // 节点地图选择弹窗：逐层渲染 30 层 DAG，只露类型 + 词缀；点击可达后继触发选路。
  showNodeMap({ graph, currentNode, path = [], onChoose }) {
    if (!graph || !Array.isArray(graph.nodes)) return;
    const currentKey = typeof currentNode === 'string' ? currentNode : currentNode?.key ?? null;
    const reachable = new Set(successors(graph, currentKey).map((node) => node.key));
    const byLayer = new Map();
    for (const node of graph.nodes) {
      const layer = Number(node.layer);
      if (!byLayer.has(layer)) byLayer.set(layer, []);
      byLayer.get(layer).push(node);
    }
    const rows = [...byLayer.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([layer, nodes]) => {
        const chips = nodes
          .sort((a, b) => a.column - b.column)
          .map((node) => {
            const view = towerNodeView(node);
            const state = towerNodeState(node, { currentKey, path });
            const selectable = reachable.has(node.key) && state !== 'current' && state !== 'reached';
            const effective = selectable ? 'reachable' : state;
            return `
              <button class="tower-node ${effective}" data-key="${escapeHtml(node.key)}"
                ${selectable ? '' : 'disabled'} style="--node:${view.color}" aria-label="${escapeHtml(view.label)}">
                <span class="tower-node-label">${escapeHtml(view.label)}</span>
                <span class="tower-node-hint">${escapeHtml(view.hint)}</span>
              </button>`;
          })
          .join('');
        return `
          <div class="tower-layer">
            <span class="tower-layer-num">${t('tower.map.layer', { n: layer })}</span>
            <div class="tower-layer-nodes">${chips}</div>
          </div>`;
      })
      .join('');

    const modal = this.openModal(
      `
        <div class="tower-map">
          <p class="eyebrow">${t('tower.map.eyebrow')}</p>
          <h2>${t('tower.map.title')}</h2>
          <p class="muted">${t('tower.map.note')}</p>
          <div class="tower-map-scroll">${rows}</div>
        </div>
      `,
      { className: 'tower-map-modal', closable: false }
    );

    modal.querySelectorAll('.tower-node.reachable').forEach((button) => {
      button.onclick = () => onChoose?.(button.dataset.key);
    });
    audio.play('draft');
  },

  // 商人弹窗：商品列表（买遗物）+ 刷新 + 卖遗物；购买/刷新/卖出的状态推进交给调用方。
  showMerchant({ inventory, gold = 0, sellable = [], onBuy, onRefresh, onSell }) {
    const offers = inventory?.offers || [];
    const refreshFee = Number(inventory?.refreshFee);
    const hasRefresh = Number.isFinite(refreshFee);
    const offerCards = offers
      .map((offer, index) => {
        const view = merchantOfferView(offer, { gold });
        if (view.missing) return '';
        return `
          <div class="merchant-offer ${view.affordable ? '' : 'locked'}" style="--rarity:${view.color}">
            <span class="rarity">${escapeHtml(view.rarityName)}</span>
            <h3>${escapeHtml(view.name)}</h3>
            <span class="merchant-price">${iconSvg('gold', 'icon-inline')}${fmt(view.price)}</span>
            <button class="btn small primary" data-buy="${index}" ${view.affordable ? '' : 'disabled'}>
              ${view.affordable ? t('tower.merchant.buy') : t('tower.merchant.insufficient')}
            </button>
          </div>`;
      })
      .join('');
    const sellCards = sellable
      .map((entry, index) => {
        const view = merchantSellView(entry);
        if (view.missing) return '';
        return `
          <div class="merchant-sell-row">
            <span class="merchant-sell-name">${escapeHtml(view.name)} <em>${view.levelLabel}</em></span>
            <button class="btn small ghost" data-sell="${index}">
              ${t('tower.merchant.sell')} · ${iconSvg('gold', 'icon-inline')}${fmt(view.price)}
            </button>
          </div>`;
      })
      .join('');

    const modal = this.openModal(
      `
        <div class="tower-merchant">
          <p class="eyebrow">${t('tower.merchant.eyebrow')}</p>
          <h2>${t('tower.merchant.title')}</h2>
          <p class="muted">${t('tower.merchant.gold', { gold: fmt(gold) })}</p>
          <section class="merchant-goods">
            <h3>${t('tower.merchant.goods')}</h3>
            <div class="merchant-offers">
              ${offerCards || `<p class="muted">${t('tower.merchant.emptyGoods')}</p>`}
            </div>
          </section>
          ${sellable.length ? `<section class="merchant-sell">
            <h3>${t('tower.merchant.sellTitle')}</h3>
            <div class="merchant-sell-list">${sellCards}</div>
          </section>` : ''}
          <div class="modal-actions">
            <button class="btn ghost" id="btn-merchant-refresh" ${hasRefresh && gold >= refreshFee ? '' : 'disabled'}>
              ${t('tower.merchant.refresh', { cost: fmt(hasRefresh ? refreshFee : 0) })}
            </button>
            <button class="btn primary" id="btn-merchant-close">${t('common.close')}</button>
          </div>
        </div>
      `,
      { className: 'tower-merchant-modal' }
    );

    modal.querySelectorAll('[data-buy]').forEach((button) => {
      if (button.disabled) return;
      button.onclick = () => onBuy?.(Number(button.dataset.buy));
    });
    modal.querySelectorAll('[data-sell]').forEach((button) => {
      button.onclick = () => onSell?.(Number(button.dataset.sell));
    });
    const refresh = modal.querySelector('#btn-merchant-refresh');
    if (refresh && !refresh.disabled) refresh.onclick = () => onRefresh?.();
    modal.querySelector('#btn-merchant-close').onclick = () => this.closeModal();
    audio.play('draft');
  },
};
