// 抽卡页（docs/PHASE_抽卡.md §6）：全屏三态页面、单抽/十连、分档出货动画、
// 概率公示与抽卡历史弹窗。数据只走 /api/gacha/*，随机与保底全部由服务端决定，
// 本模块不碰 sim.js 的确定性战斗流。所有计时器归 GachaPage 管理，切屏时统一清理。
import { api } from '../api.js';
import { getLocale, t } from '../i18n.js';
import { TOWERS } from '../shared/data.js';
import { GACHA_PITY, GACHA_POOL_TOWER_IDS } from '../shared/data/gacha.js';
import { TOWER_RARITY } from '../shared/data/towers-rarity.js';
import { drawPortrait } from '../render/portrait-draw.js';
import { escapeHtml, fmt, towerName } from './shared.js';

// 稀有度 key → 档位（服务端旧响应缺 star 时的兜底，与 towers-rarity.js 一致）。
const STAR_BY_RARITY = { legendary: 6, epic: 5, rare: 4, uncommon: 2, common: 3, basic: 1 };
// 出货动画节奏：十连逐张翻开；4★/5★/6★ 逐档拉长停顿，给高稀有度留出「揭晓」时间。
const TIMING = { lead: 320, step: 130, hold4: 380, hold5: 700, hold6: 1000, settle: 420 };
const PORTRAIT_SIZE = 132;

function newRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function towerLabel(towerId) {
  const def = TOWERS[towerId];
  return def ? towerName(def) : String(towerId || '');
}

// 抽取结果归一化：服务端契约用 camelCase，历史接口来自 DB 行（snake_case），两种都接。
function normalizeEntry(raw = {}) {
  const towerId = raw.towerId ?? raw.tower_id ?? '';
  const rarity = raw.rarity || TOWER_RARITY[towerId]?.rarity || 'common';
  const star = Number(raw.star) || TOWER_RARITY[towerId]?.star || STAR_BY_RARITY[rarity] || 3;
  return {
    towerId: String(towerId),
    rarity,
    star,
    isNew: Boolean(raw.isNew ?? raw.is_new ?? false),
    shards: Math.max(0, Number(raw.shards) || 0),
    drawnAt: Number(raw.drawnAt ?? raw.drawn_at) || null,
  };
}

function normalizePool(raw = {}) {
  const price = raw.price || {};
  return {
    balance: Math.max(0, Number(raw.balance) || 0),
    price: {
      single: Number(price.single) || 15,
      ten: Number(price.ten) || 150,
    },
    rates: raw.rates && typeof raw.rates === 'object' ? raw.rates : null,
    pity6: Math.max(0, Number(raw.pity6) || 0),
    owned: Array.isArray(raw.owned) ? raw.owned.map(String) : [],
    shards: raw.shards && typeof raw.shards === 'object' ? { ...raw.shards } : {},
  };
}

// 概率文案：0.05 → 5%，0.055 → 5.5%，避免无意义的尾随 0。
function percentText(rate) {
  const value = Number(rate);
  if (!Number.isFinite(value)) return t('gacha.rates.percent', { rate: '—' });
  const pct = Math.round(value * 1000) / 10;
  return t('gacha.rates.percent', { rate: String(pct) });
}

function starsText(star) {
  return '★'.repeat(Math.max(0, Math.min(6, Number(star) || 0)));
}

function formatTime(timestamp) {
  if (!timestamp) return '';
  try {
    return new Date(timestamp).toLocaleString(getLocale(), {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export class GachaPage {
  constructor(ui) {
    this.ui = ui;
    this.pool = null;
    this.entries = [];
    this.timers = new Set();
    this.busy = false;
    this.modalKind = null;
    this._session = 0;
    this._load = 0;
  }

  get el() {
    return this.ui.el;
  }

  // ---------- 生命周期 ----------

  open() {
    this.stop();
    this.entries = [];
    this.el.gachaResult.classList.remove('gacha-result-grid', 'gacha-result-revealing', 'clickable');
    this.el.gachaResult.innerHTML = `<p class="gacha-empty">${t('gacha.empty')}</p>`;
    this.el.gachaPool.innerHTML = `<span class="gacha-loading">${t('gacha.loading')}</span>`;
    this.el.gachaPity.textContent = '';
    this.el.gachaShardsBar.innerHTML = '';
    this.el.gachaShards.textContent = t('gacha.shardsEmpty');
    this.setPrices(null);
    this.updateControls();
    this.refresh();
  }

  // 切屏（回标题 / 进战斗 / 关页）时统一清理：孤儿计时器是 AC 明确点名的风险。
  stop() {
    this._session += 1;
    this.clearTimers();
    this.busy = false;
    this.modalKind = null;
  }

  clearTimers() {
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
  }

  schedule(fn, delay) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, Math.max(0, delay));
    this.timers.add(id);
    return id;
  }

  async refresh() {
    const token = ++this._load;
    try {
      const pool = normalizePool(await api.request('/api/gacha/pool'));
      if (token !== this._load) return;
      this.pool = pool;
      this.renderPool();
    } catch (error) {
      if (token !== this._load) return;
      this.pool = null;
      this.renderPoolError(error);
    }
  }

  // ---------- 渲染 ----------

  renderPool() {
    const pool = this.pool;
    if (!pool) return;
    this.el.gachaCores.textContent = fmt(pool.balance);
    this.setPrices(pool.price);
    this.el.gachaPity.textContent = this.pityText(pool.pity6);
    this.el.gachaPity.title = t('gacha.pitySoft', { n: pool.pity6 });
    this.renderPoolTowers();
    this.renderShards();
    this.updateControls();
  }

  setPrices(price) {
    this.el.gachaSinglePrice.textContent = price ? t('gacha.price', { n: price.single }) : '—';
    this.el.gachaTenPrice.textContent = price ? t('gacha.price', { n: price.ten }) : '—';
  }

  pityText(pity6) {
    const left = Math.max(0, GACHA_PITY.hardCap - (Number(pity6) || 0));
    return left <= 1 ? t('gacha.pityMax') : t('gacha.pity', { n: left });
  }

  renderPoolTowers() {
    this.el.gachaPool.innerHTML = GACHA_POOL_TOWER_IDS.map((id) => {
      const meta = TOWER_RARITY[id];
      if (!meta) return '';
      return `<span class="gacha-pool-chip" style="--rarity:${meta.color}" title="${escapeHtml(
        `${towerLabel(id)} · ${t(`gacha.rarity.${meta.rarity}`)}`
      )}"><span class="gacha-pool-stars" aria-hidden="true">${starsText(meta.star)}</span>${escapeHtml(
        towerLabel(id)
      )}</span>`;
    }).join('');
  }

  renderShards() {
    const shards = this.pool?.shards || {};
    const owned = Object.entries(shards).filter(([, count]) => Number(count) > 0);
    const total = owned.reduce((sum, [, count]) => sum + Number(count), 0);
    this.el.gachaShards.textContent = total > 0 ? fmt(total) : t('gacha.shardsEmpty');
    if (!owned.length) {
      this.el.gachaShardsBar.innerHTML = `<span class="muted">${t('gacha.shardsEmpty')}</span>`;
      return;
    }
    this.el.gachaShardsBar.innerHTML = owned
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .map(([id, count]) => {
        const color = TOWER_RARITY[id]?.color || 'currentColor';
        return `<span class="gacha-shard-chip" style="--rarity:${color}">${escapeHtml(
          t('gacha.shardsRow', { tower: towerLabel(id), n: count })
        )}</span>`;
      })
      .join('');
  }

  renderPoolError() {
    this.el.gachaCores.textContent = '—';
    this.el.gachaPity.textContent = '';
    this.setPrices(null);
    this.el.gachaShards.textContent = t('gacha.shardsEmpty');
    this.el.gachaShardsBar.innerHTML = '';
    this.el.gachaPool.innerHTML = `
      <div class="gacha-pool-error">
        <span>${t('gacha.poolError')}</span>
        <button class="btn small ghost" type="button" data-gacha-retry>${t('gacha.retry')}</button>
      </div>`;
    this.el.gachaPool.querySelector('[data-gacha-retry]')?.addEventListener('click', () => {
      this.el.gachaPool.innerHTML = `<span class="gacha-loading">${t('gacha.loading')}</span>`;
      this.refresh();
    });
    this.updateControls();
  }

  updateControls() {
    const pool = this.pool;
    const disabled = this.busy || !pool;
    for (const button of [this.el.gachaSingle, this.el.gachaTen]) {
      if (!button) continue;
      button.disabled = disabled;
      button.setAttribute('aria-busy', this.busy ? 'true' : 'false');
    }
    if (pool) {
      this.el.gachaSingle.classList.toggle('poor', pool.balance < pool.price.single);
      this.el.gachaTen.classList.toggle('poor', pool.balance < pool.price.ten);
    }
  }

  // ---------- 抽卡 ----------

  async draw(count) {
    if (this.busy) return;
    if (!this.pool) {
      this.ui.toast(t('gacha.poolError'), 2600);
      return;
    }
    const price = count === 10 ? this.pool.price.ten : this.pool.price.single;
    if (this.pool.balance < price) {
      this.ui.toast(t('gacha.insufficient', { n: price }), 2600);
      return;
    }
    const token = this._session;
    this.busy = true;
    this.updateControls();
    this.el.gachaResult.classList.remove('gacha-result-grid', 'gacha-result-revealing');
    this.el.gachaResult.innerHTML = `<p class="gacha-empty">${t('gacha.busy')}</p>`;
    try {
      const data = await api.request('/api/gacha/draw', {
        method: 'POST',
        body: { count, request_id: newRequestId() },
      });
      if (token !== this._session) return;
      const entries = (Array.isArray(data?.results) ? data.results : [])
        .map(normalizeEntry)
        .filter((entry) => entry.towerId);
      if (!entries.length) throw new Error(t('gacha.poolError'));
      this.applyDraw(entries, data);
      this.renderResults(entries, { animate: true });
    } catch (error) {
      if (token !== this._session) return;
      this.busy = false;
      this.el.gachaResult.innerHTML = `<p class="gacha-empty">${t('gacha.empty')}</p>`;
      this.ui.toast(t('gacha.error', { message: error.message }), 3200);
      this.updateControls();
      this.refresh();
    }
  }

  // 用服务端返回的余额/保底/结果增量更新本地卡池视图；碎片按重复条目累加。
  applyDraw(entries, data = {}) {
    const pool = this.pool;
    const balance = Number(data.balance);
    if (Number.isFinite(balance)) {
      pool.balance = balance;
      if (this.ui.profile) this.ui.profile.cores = balance;
    }
    if (data.pity6 != null) pool.pity6 = Math.max(0, Number(data.pity6) || 0);
    for (const entry of entries) {
      if (!pool.owned.includes(entry.towerId)) pool.owned.push(entry.towerId);
      if (entry.shards > 0) {
        pool.shards[entry.towerId] = (Number(pool.shards[entry.towerId]) || 0) + entry.shards;
      }
    }
    this.renderPool();
  }

  // ---------- 结果与出货动画 ----------

  renderResults(entries, { animate = false } = {}) {
    this.entries = entries;
    const html = `
      <div class="gacha-result-head">
        <span class="gacha-result-title">${t('gacha.result.summary')}</span>
        <span class="gacha-result-count">${t('gacha.starCount', { n: entries.length })}</span>
        <span class="gacha-result-skip" hidden>${t('gacha.result.skip')}</span>
      </div>
      <div class="gacha-cards">${entries.map((entry) => this.cardHtml(entry)).join('')}</div>`;
    const node = this.el.gachaResult;
    node.classList.toggle('gacha-result-grid', entries.length > 1);
    node.innerHTML = html;
    this.paintPortraits(node, entries);

    const cards = [...node.querySelectorAll('.gacha-card')];
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!animate || reduced) {
      for (const card of cards) this.revealCard(card);
      this.finishReveal();
      return;
    }
    node.classList.add('gacha-result-revealing');
    node.querySelector('.gacha-result-skip')?.removeAttribute('hidden');
    node.classList.add('clickable');
    let at = TIMING.lead;
    for (const card of cards) {
      const star = Number(card.dataset.star) || 3;
      at += star >= 6 ? TIMING.hold6 : star === 5 ? TIMING.hold5 : star === 4 ? TIMING.hold4 : 0;
      this.schedule(() => this.revealCard(card), at);
      at += TIMING.step;
    }
    this.schedule(() => this.finishReveal(), at + TIMING.settle);
  }

  cardHtml(entry) {
    const color = TOWER_RARITY[entry.towerId]?.color || '#a9c6a0';
    const tag = entry.isNew
      ? `<span class="gacha-card-tag new">${t('gacha.result.new')}</span>`
      : entry.shards > 0
        ? `<span class="gacha-card-tag dupe">${t('gacha.result.dupe', { n: entry.shards })}</span>`
        : '';
    return `
      <article class="gacha-card pending" data-star="${entry.star}" data-rarity="${escapeHtml(
        entry.rarity
      )}" style="--rarity:${color}" aria-label="${escapeHtml(towerLabel(entry.towerId))}">
        <span class="gacha-card-glow" aria-hidden="true"></span>
        <span class="gacha-card-stars" aria-hidden="true">${starsText(entry.star)}</span>
        <span class="gacha-card-art"><canvas width="${PORTRAIT_SIZE}" height="${PORTRAIT_SIZE}"></canvas></span>
        <span class="gacha-card-body">
          <b class="gacha-card-name">${escapeHtml(towerLabel(entry.towerId))}</b>
          <span class="gacha-card-rarity">${t(`gacha.rarity.${entry.rarity}`)}</span>
          ${tag}
        </span>
      </article>`;
  }

  // 程序化立绘是唯一绘制来源：美术资源缺失/加载失败时卡面仍完整（不依赖图片）。
  paintPortraits(root, entries) {
    root.querySelectorAll('.gacha-card canvas').forEach((canvas, index) => {
      const entry = entries[index];
      if (!entry) return;
      const ctx = canvas.getContext('2d');
      if (ctx) drawPortrait(ctx, `tower.${entry.towerId}`, PORTRAIT_SIZE);
    });
  }

  revealCard(card) {
    if (!card.classList.contains('pending')) return;
    card.classList.remove('pending');
    card.classList.add('revealed');
    if (Number(card.dataset.star) >= 6) this.flashScreen();
  }

  // 6★ 全屏金光：纯 CSS 动画一次性播完，不挂清理计时器（切屏也不会残留）。
  flashScreen() {
    const flash = this.el.gachaFlash;
    if (!flash) return;
    flash.classList.remove('active');
    void flash.offsetWidth;
    flash.classList.add('active');
  }

  skipReveal() {
    if (!this.busy) return;
    this.clearTimers();
    for (const card of this.el.gachaResult.querySelectorAll('.gacha-card.pending')) {
      this.revealCard(card);
    }
    this.finishReveal();
  }

  finishReveal() {
    this.busy = false;
    const node = this.el.gachaResult;
    node.classList.remove('gacha-result-revealing', 'clickable');
    node.querySelector('.gacha-result-skip')?.setAttribute('hidden', '');
    this.updateControls();
  }

  // ---------- 概率公示 / 历史 ----------

  async showRates() {
    if (!this.pool) {
      await this.refresh();
      if (!this.pool) return this.ui.toast(t('gacha.poolError'), 2600);
    }
    this.openRates();
  }

  openRates() {
    const rates = this.pool?.rates || {};
    const rows = Object.keys(rates)
      .map(Number)
      .filter((star) => Number.isFinite(star) && star >= 3)
      .sort((a, b) => b - a)
      .map((star) => {
        const rarity = Object.keys(STAR_BY_RARITY).find((key) => STAR_BY_RARITY[key] === star) || 'common';
        const color = TOWER_RARITY[GACHA_POOL_TOWER_IDS.find((id) => TOWER_RARITY[id]?.star === star)]?.color;
        const names = GACHA_POOL_TOWER_IDS.filter((id) => TOWER_RARITY[id]?.star === star)
          .map((id) => towerLabel(id))
          .join(' / ');
        return `
          <li class="gacha-rate-row" style="--rarity:${color || 'currentColor'}">
            <span class="gacha-rate-star" aria-hidden="true">${starsText(star)}</span>
            <span class="gacha-rate-rarity">${t(`gacha.rarity.${rarity}`)}</span>
            <span class="gacha-rate-value">${percentText(rates[star])}</span>
            <span class="gacha-rate-towers">${escapeHtml(t('gacha.rates.available', { names }))}</span>
          </li>`;
      })
      .join('');
    this.modalKind = 'rates';
    const modal = this.ui.openModal(
      `
        <div class="gacha-rates">
          <p class="eyebrow">${t('gacha.kicker')}</p>
          <h2>${t('gacha.rates.title')}</h2>
          <ul class="gacha-rate-list">${rows}</ul>
          <p class="muted gacha-rates-note">${t('gacha.rates.note', {
            soft: GACHA_PITY.softStart,
            step: Math.round(GACHA_PITY.softStep * 100),
            cap: GACHA_PITY.hardCap,
          })}</p>
          <div class="modal-actions">
            <button class="btn ghost" type="button" data-gacha-close>${t('gacha.close')}</button>
          </div>
        </div>`,
      { className: 'gacha-modal', closable: true, onClose: () => (this.modalKind = null) }
    );
    modal.querySelector('[data-gacha-close]').onclick = () => this.ui.closeModal();
  }

  async showHistory() {
    try {
      const data = await api.request('/api/gacha/history');
      const raw = Array.isArray(data) ? data : data?.entries || data?.history || [];
      this.openHistory(raw.map(normalizeEntry).filter((entry) => entry.towerId));
    } catch (error) {
      this.ui.toast(t('gacha.historyError', { message: error.message }), 3000);
    }
  }

  openHistory(entries) {
    const rows = entries
      .map((entry) => {
        const color = TOWER_RARITY[entry.towerId]?.color || 'currentColor';
        const reward = entry.isNew
          ? `<span class="gacha-history-tag new">${t('gacha.history.new')}</span>`
          : entry.shards > 0
            ? `<span class="gacha-history-tag">${t('gacha.history.shards', { n: entry.shards })}</span>`
            : '';
        return `
          <li class="gacha-history-row" style="--rarity:${color}">
            <span class="gacha-history-stars" aria-hidden="true">${starsText(entry.star)}</span>
            <span class="gacha-history-name">${escapeHtml(towerLabel(entry.towerId))}</span>
            ${reward}
            <span class="gacha-history-time">${escapeHtml(formatTime(entry.drawnAt))}</span>
          </li>`;
      })
      .join('');
    this.modalKind = 'history';
    const modal = this.ui.openModal(
      `
        <div class="gacha-history">
          <p class="eyebrow">${t('gacha.kicker')}</p>
          <h2>${t('gacha.history.title')}</h2>
          ${rows ? `<ul class="gacha-history-list">${rows}</ul>` : `<p class="muted">${t('gacha.history.empty')}</p>`}
          <div class="modal-actions">
            <button class="btn ghost" type="button" data-gacha-close>${t('gacha.close')}</button>
          </div>
        </div>`,
      { className: 'gacha-modal', closable: true, onClose: () => (this.modalKind = null) }
    );
    modal.querySelector('[data-gacha-close]').onclick = () => this.ui.closeModal();
  }

  // 切语言：静态文案由 i18n 层统一刷新，动态区（卡池/碎片/结果/打开中的弹窗）在这里重建。
  refreshLocale() {
    if (this.pool) this.renderPool();
    else if (this.el.gachaPool?.querySelector('.gacha-pool-error')) this.renderPoolError();
    if (this.entries.length) {
      this.renderResults(this.entries, { animate: false });
    } else if (!this.busy && this.el.gachaResult?.querySelector('.gacha-empty')) {
      this.el.gachaResult.innerHTML = `<p class="gacha-empty">${t('gacha.empty')}</p>`;
    }
    if (this.modalKind === 'rates') this.openRates();
    else if (this.modalKind === 'history') this.showHistory();
  }
}

// 挂在 UI 原型上的门面：页面单例懒创建，UI 只负责三态翻转与事件接线。
export const gachaMethods = {
  showGacha() {
    if (!this.el?.gacha || !this.profile) return;
    this._gachaPage ||= new GachaPage(this);
    this.el.title.hidden = true;
    this.el.game.hidden = true;
    this.el.gacha.hidden = false;
    this.game = null;
    this.stopMenuBackground();
    this.closeModal();
    this.hideTowerPanel();
    this.playViewEnter(this.el.gacha);
    this._gachaPage.open();
  },

  hideGacha() {
    this.stopGacha();
    if (this.el?.gacha) this.el.gacha.hidden = true;
    if (this.profile) this.showTitle(this.profile, this._titleExtras);
  },

  // 标题页/战斗页切回时调用：停掉出货动画与所有待触发的翻牌计时器。
  stopGacha() {
    this._gachaPage?.stop();
  },

  drawGacha(count) {
    this._gachaPage?.draw(count);
  },

  skipGachaReveal() {
    this._gachaPage?.skipReveal();
  },

  showGachaRates() {
    this._gachaPage?.showRates();
  },

  showGachaHistory() {
    this._gachaPage?.showHistory();
  },
};
