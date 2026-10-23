// 大厅外观面板：展示已解锁的称号、头像框与塔/敌人皮肤，选择结果由服务端持久化。
// 未解锁的外观只作为目标提示，不能点击选择；本模块不参与任何战斗数值。
import { tOr } from './i18n.js';
import { setActiveSkins } from './shared/skins.js';

const ENDPOINT = '/api/profile/cosmetics';
const SKINS_ENDPOINT = '/api/profile/skins';
const SKIN_TARGETS = ['tower', 'enemy'];

const STYLE_ID = 'cosmetics-style';
const STYLE = `
.cosmetics-body { display: grid; gap: var(--space-4, 16px); }
.cosmetic-preview { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3, 12px); padding: var(--space-4, 16px); border: 1px solid var(--line, rgba(255,255,255,.12)); border-radius: var(--radius-lg, 16px); background: var(--surface-1, rgba(255,255,255,.04)); }
.cosmetic-preview-card { display: flex; align-items: center; gap: 12px; padding: 10px 18px; border: 2px solid var(--cosmetic-frame, var(--line, rgba(255,255,255,.16))); border-radius: var(--radius-pill, 999px); background: var(--surface-2, rgba(255,255,255,.05)); }
.cosmetic-preview-name { font-size: var(--text-lg, 18px); font-weight: 700; }
.cosmetic-preview-title { color: var(--cyan, #5bc8ff); font-size: var(--text-sm, 13px); }
.cosmetic-preview-note { color: var(--muted, #9fb0c3); font-size: var(--text-sm, 13px); }
.cosmetic-section h3 { margin: 0 0 8px; font-size: var(--text-md, 15px); }
.cosmetic-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.cosmetic-chip { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border: 1px solid var(--line, rgba(255,255,255,.12)); border-radius: var(--radius-sm, 8px); background: var(--surface-2, rgba(255,255,255,.05)); color: var(--text, #e6edf3); font: inherit; text-align: left; cursor: pointer; }
.cosmetic-chip:hover:not(:disabled) { border-color: var(--cyan, #5bc8ff); }
.cosmetic-chip:focus-visible { outline: 2px solid var(--focus-ring, #5bc8ff); outline-offset: 2px; }
.cosmetic-chip:disabled { opacity: .45; cursor: not-allowed; }
.cosmetic-chip.active { border-color: var(--cyan, #5bc8ff); box-shadow: inset 0 0 0 1px var(--cyan, #5bc8ff); }
.cosmetic-chip-head { display: flex; align-items: center; gap: 6px; font-weight: 600; }
.cosmetic-chip-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--cosmetic-color, currentColor); }
.cosmetic-chip-source { color: var(--muted, #9fb0c3); font-size: var(--text-xs, 12px); }
.cosmetic-set-list { display: grid; gap: 8px; }
.cosmetic-set { display: grid; gap: 8px; padding: 10px 12px; border: 1px solid var(--line, rgba(255,255,255,.12)); border-radius: var(--radius-md, 12px); background: var(--surface-1, rgba(255,255,255,.04)); }
.cosmetic-set.complete { border-color: var(--set-accent, #5bc8ff); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--set-accent, #5bc8ff) 40%, transparent); }
.cosmetic-set.complete .cosmetic-set-title { color: var(--set-accent, #5bc8ff); }
.cosmetic-set-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.cosmetic-set-title { font-weight: 700; }
.cosmetic-set-progress { color: var(--muted, #9fb0c3); font-size: var(--text-xs, 12px); }
.cosmetic-set-note { margin: 0; color: var(--muted, #9fb0c3); font-size: var(--text-xs, 12px); }
.cosmetic-set-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 6px; }
.cosmetic-thumb { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px; border: 1px solid var(--line, rgba(255,255,255,.12)); border-radius: var(--radius-sm, 8px); background: var(--surface-2, rgba(255,255,255,.05)); opacity: .5; }
.cosmetic-thumb.unlocked { opacity: 1; border-color: var(--thumb-color, var(--cyan, #5bc8ff)); }
.cosmetic-thumb-art { width: 30px; height: 30px; border-radius: 50%; background: radial-gradient(circle at 34% 30%, var(--thumb-glow, #fff), var(--thumb-color, #7a8794) 70%); box-shadow: 0 0 8px color-mix(in srgb, var(--thumb-glow, #fff) 45%, transparent); }
.cosmetic-thumb-label { font-size: var(--text-xs, 12px); text-align: center; }
.cosmetic-thumb-source { color: var(--muted, #9fb0c3); font-size: 11px; text-align: center; }
.cosmetic-status { min-height: 1.2em; color: var(--muted, #9fb0c3); font-size: var(--text-sm, 13px); }
.player-title-badge { padding: 2px 8px; border-radius: var(--radius-pill, 999px); border: 1px solid var(--cosmetic-frame, var(--line, rgba(255,255,255,.2))); background: color-mix(in srgb, var(--cosmetic-frame, #5bc8ff) 14%, transparent); color: var(--text, #e6edf3); font-size: var(--text-xs, 12px); white-space: nowrap; }
@media (max-width: 640px) { .cosmetic-grid { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); } }
`;

let current = null;
let currentSkins = null;
let panel = null;
let body = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);
}

async function request(method = 'GET', payload = null, pathname = ENDPOINT) {
  const response = await fetch(pathname, {
    method,
    credentials: 'same-origin',
    headers: payload ? { 'content-type': 'application/json' } : {},
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.error || tOr('cosmetics.error', '外观加载失败'));
    error.code = data?.code || null;
    error.status = response.status;
    throw error;
  }
  return data;
}

function setStatus(message) {
  if (!body) return;
  const status = body.querySelector('.cosmetic-status');
  if (status) status.textContent = message || '';
}

function sourceLabel(item) {
  if (item.unlocked) return tOr('cosmetics.unlocked', '已解锁');
  const hint = item.achievementTitle
    ? tOr('cosmetics.source', '解锁成就「{name}」', { name: item.achievementTitle })
    : tOr('cosmetics.locked', '未解锁');
  return hint;
}

function chip(kind, item) {
  const selected = current?.selected?.[kind] === item.id;
  const classes = ['cosmetic-chip'];
  if (selected) classes.push('active');
  const color = item.color ? ` style="--cosmetic-color:${escapeHtml(item.color)}"` : '';
  return `
    <button type="button" class="${classes.join(' ')}" data-kind="${kind}" data-value="${escapeHtml(item.id)}"
      aria-pressed="${selected ? 'true' : 'false'}" ${item.unlocked ? '' : 'disabled'}
      title="${escapeHtml(`${item.name} · ${sourceLabel(item)}`)}">
      <span class="cosmetic-chip-head"><span class="cosmetic-chip-dot"${color} aria-hidden="true"></span>${escapeHtml(item.name)}</span>
      <span class="cosmetic-chip-source">${escapeHtml(sourceLabel(item))}</span>
    </button>`;
}

function section(kind, label, items) {
  return `
    <section class="cosmetic-section" data-section="${kind}">
      <h3>${escapeHtml(label)}</h3>
      <div class="cosmetic-grid">
        ${items.length ? items.map((item) => chip(kind, item)).join('') : `<p class="cosmetic-preview-note">${escapeHtml(tOr('cosmetics.empty', '暂无可用外观'))}</p>`}
      </div>
      <button type="button" class="btn small" data-kind="${kind}" data-value="">${escapeHtml(tOr('cosmetics.unequip', '卸下'))}</button>
    </section>`;
}

function skinChip(target, item) {
  const selected = currentSkins?.selected?.[target] === item.id;
  const classes = ['cosmetic-chip'];
  if (selected) classes.push('active');
  const color = item.outline?.color || '#7a8794';
  return `
    <button type="button" class="${classes.join(' ')}" data-kind="skin-${target}" data-value="${escapeHtml(item.id)}"
      aria-pressed="${selected ? 'true' : 'false'}" ${item.unlocked ? '' : 'disabled'}
      title="${escapeHtml(`${item.name} · ${sourceLabel(item)}`)}">
      <span class="cosmetic-chip-head"><span class="cosmetic-chip-dot" style="--cosmetic-color:${escapeHtml(color)}" aria-hidden="true"></span>${escapeHtml(item.name)}</span>
      <span class="cosmetic-chip-source">${escapeHtml(sourceLabel(item))}</span>
    </button>`;
}

function skinSection(target, label, items) {
  return `
    <section class="cosmetic-section" data-section="skin-${target}">
      <h3>${escapeHtml(label)}</h3>
      <div class="cosmetic-grid">
        ${items.length ? items.map((item) => skinChip(target, item)).join('') : `<p class="cosmetic-preview-note">${escapeHtml(tOr('cosmetics.empty', '暂无可用外观'))}</p>`}
      </div>
      <button type="button" class="btn small" data-kind="skin-${target}" data-value="">${escapeHtml(tOr('cosmetics.skinDefault', '恢复默认'))}</button>
    </section>`;
}

function skinSetThumb(set, member) {
  const color = member.outline?.color || '#7a8794';
  const glow = set.glow || color;
  const classes = ['cosmetic-thumb', member.unlocked ? 'unlocked' : 'locked'];
  const hint = `${member.name} · ${sourceLabel(member)}`;
  return `
    <div class="${classes.join(' ')}" data-target="${escapeHtml(member.target)}" data-type="${escapeHtml(member.type)}"
      style="--thumb-color:${escapeHtml(color)};--thumb-glow:${escapeHtml(glow)}"
      title="${escapeHtml(hint)}">
      <span class="cosmetic-thumb-art" aria-hidden="true"></span>
      <span class="cosmetic-thumb-label">${escapeHtml(member.name)}</span>
      ${member.unlocked ? '' : `<span class="cosmetic-thumb-source">${escapeHtml(sourceLabel(member))}</span>`}
    </div>`;
}

function skinSetCard(set) {
  const progress = set.progress || { unlocked: 0, total: 0 };
  const classes = ['cosmetic-set'];
  if (set.unlocked) classes.push('complete');
  const progressText = tOr('cosmetics.setProgress', '已收集 {done}/{total}', {
    done: progress.unlocked,
    total: progress.total,
  });
  const completeNote = set.unlocked ? ` · ${tOr('cosmetics.setComplete', '已集齐')}` : '';
  return `
    <article class="${classes.join(' ')}" data-set="${escapeHtml(set.id)}"
      style="--set-accent:${escapeHtml(set.accent || '#5bc8ff')}">
      <header class="cosmetic-set-head">
        <span class="cosmetic-set-title">${escapeHtml(set.name)}${escapeHtml(completeNote)}</span>
        <span class="cosmetic-set-progress">${escapeHtml(progressText)}</span>
      </header>
      ${set.description ? `<p class="cosmetic-set-note">${escapeHtml(set.description)}</p>` : ''}
      <div class="cosmetic-set-grid">
        ${(set.members || []).map((member) => skinSetThumb(set, member)).join('')}
      </div>
    </article>`;
}

function skinSetsSection(skins) {
  if (!skins?.sets?.length) return '';
  return `
    <section class="cosmetic-section" data-section="skin-sets">
      <h3>${escapeHtml(tOr('cosmetics.skinSets', '皮肤套装'))}</h3>
      <div class="cosmetic-set-list">
        ${skins.sets.map(skinSetCard).join('')}
      </div>
    </section>`;
}

function skinsSection(skins) {
  if (!skins) return '';
  const labels = {
    tower: tOr('cosmetics.skinTower', '塔皮肤'),
    enemy: tOr('cosmetics.skinEnemy', '敌人皮肤'),
  };
  const targets = SKIN_TARGETS.map((target) =>
    skinSection(
      target,
      labels[target],
      Array.isArray(skins.skins) ? skins.skins.filter((item) => item.target === target) : []
    )
  ).join('');
  return targets + skinSetsSection(skins);
}

function selectedSkinName(skins, target) {
  const id = skins?.selected?.[target];
  return skins?.skins?.find((item) => item.target === target && item.id === id)?.name || null;
}

function preview() {
  const title = current?.titles?.find((item) => item.id === current.selected?.title && item.unlocked);
  const frame = current?.frames?.find((item) => item.id === current.selected?.frame && item.unlocked);
  const frameStyle = frame ? ` style="--cosmetic-frame:${escapeHtml(frame.color)}"` : '';
  const skinNote = SKIN_TARGETS.map((target) => {
    const name = selectedSkinName(currentSkins, target);
    if (!name) return '';
    const label = target === 'tower' ? tOr('cosmetics.skinTower', '塔皮肤') : tOr('cosmetics.skinEnemy', '敌人皮肤');
    return `${label} · ${name}`;
  }).filter(Boolean).join(' / ');
  return `
    <div class="cosmetic-preview">
      <div class="cosmetic-preview-card"${frameStyle}>
        <span class="cosmetic-preview-name">${escapeHtml(title ? title.name : '')}</span>
        <span class="cosmetic-preview-title">${escapeHtml(title ? tOr('cosmetics.equippedTitle', '当前称号') : tOr('cosmetics.noTitle', '未佩戴称号'))}</span>
      </div>
      <span class="cosmetic-preview-note">${escapeHtml(frame ? `${tOr('cosmetics.equippedFrame', '当前头像框')} · ${frame.name}` : tOr('cosmetics.noFrame', '未佩戴头像框'))}</span>
      ${skinNote ? `<span class="cosmetic-preview-note">${escapeHtml(skinNote)}</span>` : ''}
    </div>`;
}

function applyActiveSkins(skins) {
  if (!skins?.selected) return;
  setActiveSkins(skins.selected);
}

function render(data, skins = currentSkins) {
  current = data;
  currentSkins = skins;
  applyActiveSkins(skins);
  if (!body) return;
  body.innerHTML = `
    ${preview()}
    ${section('title', tOr('cosmetics.titles', '称号'), data.titles || [])}
    ${section('frame', tOr('cosmetics.frames', '头像框'), data.frames || [])}
    ${skinsSection(skins)}
    <p class="cosmetic-status" role="status" aria-live="polite"></p>`;
  updateHallBadge(data);
}

function emptyState(message) {
  if (!body) return;
  body.innerHTML = `<p class="cosmetic-preview-note">${escapeHtml(message)}</p>`;
}

function ensureBadge() {
  const existing = document.getElementById('player-title');
  if (existing) return existing;
  const name = document.getElementById('player-name');
  if (!name) return null;
  const badge = document.createElement('span');
  badge.id = 'player-title';
  badge.className = 'player-title-badge';
  badge.hidden = true;
  name.insertAdjacentElement('afterend', badge);
  return badge;
}

function updateHallBadge(data) {
  const badge = ensureBadge();
  if (!badge) return;
  const title = data?.titles?.find((item) => item.id === data.selected?.title && item.unlocked);
  const frame = data?.frames?.find((item) => item.id === data.selected?.frame && item.unlocked);
  badge.textContent = title ? title.name : '';
  badge.hidden = !title;
  if (frame) {
    badge.dataset.frame = frame.color;
    badge.style.setProperty('--cosmetic-frame', frame.color);
  } else {
    delete badge.dataset.frame;
    badge.style.removeProperty('--cosmetic-frame');
  }
}

async function load() {
  if (!body) return;
  body.innerHTML = `<p class="cosmetic-preview-note">${escapeHtml(tOr('cosmetics.loading', '正在读取外观…'))}</p>`;
  try {
    const data = await request('GET');
    const skins = await request('GET', null, SKINS_ENDPOINT).catch(() => null);
    render(data, skins);
  } catch (error) {
    if (error.status === 401) {
      emptyState(tOr('cosmetics.login', '登录后可查看称号与头像框'));
      return;
    }
    emptyState(error.message || tOr('cosmetics.error', '外观加载失败'));
  }
}

async function chooseSkin(target, value) {
  if (!currentSkins) return;
  setStatus(tOr('cosmetics.saving', '正在保存…'));
  try {
    const data = await request('PUT', { [target]: value || null }, SKINS_ENDPOINT);
    render(current, data);
    setStatus(tOr('cosmetics.saved', '已保存'));
  } catch (error) {
    render(current, currentSkins);
    setStatus(error.message || tOr('cosmetics.error', '外观加载失败'));
  }
}

async function choose(kind, value) {
  if (kind === 'skin-tower' || kind === 'skin-enemy') {
    return chooseSkin(kind.slice('skin-'.length), value);
  }
  if (!current) return;
  setStatus(tOr('cosmetics.saving', '正在保存…'));
  try {
    const data = await request('PUT', { [kind]: value });
    render(data, currentSkins);
    setStatus(tOr('cosmetics.saved', '已保存'));
  } catch (error) {
    render(current, currentSkins);
    setStatus(error.message || tOr('cosmetics.error', '外观加载失败'));
  }
}

async function refreshBadge() {
  try {
    updateHallBadge(await request('GET'));
  } catch {
    /* 未登录或接口不可用时保持无称号 */
  }
}

// 大厅进入即同步已选皮肤，避免必须打开面板才生效。
async function refreshSkins() {
  try {
    const data = await request('GET', null, SKINS_ENDPOINT);
    currentSkins = data;
    applyActiveSkins(data);
    if (!panel?.hidden && current) render(current, data);
  } catch {
    /* 未登录或接口不可用时保持默认皮肤 */
  }
}

function install() {
  panel = document.getElementById('cosmetics-panel');
  body = document.getElementById('cosmetics-body');
  const trigger = document.getElementById('btn-cosmetics');
  if (!panel || !body || !trigger) return;
  ensureStyles();
  refreshBadge();
  refreshSkins();

  const close = document.getElementById('btn-cosmetics-close');
  const setOpen = (open) => {
    panel.hidden = !open;
    if (open) load();
  };

  trigger.addEventListener('click', () => setOpen(panel.hidden));
  close?.addEventListener('click', () => setOpen(false));
  body.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-kind]');
    if (!button || button.disabled) return;
    const value = button.dataset.value || null;
    choose(button.dataset.kind, value);
  });
  document.addEventListener('i18n:change', () => {
    if (!panel.hidden) load();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, { once: true });
} else {
  install();
}
