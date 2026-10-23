// DOM 界面层：HUD、商店、遗物、弹窗与提示。
import {
  TOWERS,
  TOWER_ORDER,
  ENEMIES,
  RELIC_BY_ID,
  RARITY,
  UNLOCKS,
  MAX_WAVE,
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  RELIC_LEVEL_LABELS,
  relicEffectText,
  SKILLS,
  SKILL_ORDER,
  skillStats,
  skillUpgradeCost,
  skillUnlockText,
  isSkillUnlocked,
} from './shared/data.js';
import { canAffordEventOption } from './shared/events.js';
import { weekKey, weeklyChallenge } from './shared/scoring.js';
import { normalizeSettings, detectPreset, presetSettings } from './settings.js';
import { audio } from './audio.js';
import { t, tData, tOr, initI18n, getLocale, setLocale, LOCALES } from './i18n.js';
import { iconSvg, relicIconName } from './render/canvas-shapes.js';

const $ = (id) => document.getElementById(id);

// 静态页面用 data-icon 占位，初始化时统一注入程序化图标，避免在 HTML 里散落字符图标。
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((node) => {
    const markup = iconSvg(node.dataset.icon);
    if (markup) node.innerHTML = markup;
  });
}

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

// 数据表只保存中文名；按 id 取当前语言译名，缺译名时回退原值。
const towerName = (def) => tData('tower', def.id, 'name', def.name);
const enemyName = (def) => tData('enemy', def.id, 'name', def.name);
const diffName = (def) => tData('difficulty', def.id, 'name', def.name);
const diffDesc = (def) => tData('difficulty', def.id, 'desc', def.desc);
const ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ'];
const ROLE_LABELS = { control: '控场', burst: '爆发', ultimate: '终极' };

// 进化修正展示：mods 统一是乘法系数，转成百分比文案。
const EVOLUTION_LABELS = {
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

function evolutionEffectText(evolution) {
  return Object.entries(evolution.mods || {})
    .map(([key, mul]) => {
      const pct = Math.round((mul - 1) * 100);
      return `${EVOLUTION_LABELS[key] || key} ${pct >= 0 ? '+' : ''}${pct}%`;
    })
    .join(' · ');
}

// 技能数据表只有中文；按 id 取当前语言文案，缺译名回退数据原值。
const skillName = (entry) => tOr(`skill.${entry.id}.name`, entry.name);
const skillDesc = (entry) => tOr(`skill.${entry.id}.desc`, entry.desc);
const skillRole = (entry) => tOr(`skill.role.${entry.role}`, ROLE_LABELS[entry.role] || '');
const skillUnlock = (entry) =>
  tOr(`skill.unlock.${SKILLS[entry.id]?.unlock}`, entry.unlockHint || skillUnlockText(entry.id));

// 技能卡摘要：只展示一个最能代表当前等级的数值。
function skillSummary(id, level) {
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

class UI {
  constructor() {
    this.handlers = {};
    this.game = null;
    this.profile = null;
    this.modalClosable = false;
    this._toastTimer = null;
    this._panelTower = null;
    this._skillState = null;
    this.selectedSkill = null;
  }

  init(handlers) {
    this.handlers = handlers;
    initI18n();
    document.addEventListener('i18n:change', () => this.refreshLocale());
    this.el = {
      title: $('title-screen'),
      game: $('game-screen'),
      playerName: $('player-name'),
      cores: $('cores'),
      play: $('btn-play'),
      daily: $('btn-daily'),
      dailyLabel: $('daily-label'),
      endless: $('btn-endless'),
      resume: $('btn-resume'),
      shop: $('btn-shop'),
      board: $('btn-board'),
      help: $('btn-help'),
      rename: $('btn-rename'),
      settingsTitle: $('btn-settings-title'),
      settingsGame: $('btn-settings-game'),
      relicsMobile: $('btn-relics-mobile'),
      hudRelics: $('hud-relics'),
      fullscreen: $('btn-fullscreen'),
      rotateHint: $('rotate-hint'),
      rotateRetry: $('btn-rotate-retry'),
      titleStats: $('title-stats'),
      titleSkills: $('title-skills'),
      btnSkill: $('btn-skill'),
      skillCount: $('skill-count'),
      hudWave: $('hud-wave'),
      hudGold: $('hud-gold'),
      hudHp: $('hud-hp'),
      hudHpMax: $('hud-hpmax'),
      hudKills: $('hud-kills'),
      hudDifficulty: $('hud-difficulty'),
      waveState: $('wave-state'),
      nextWave: $('btn-next-wave'),
      sound: $('btn-sound'),
      quit: $('btn-quit'),
      portalHint: null,
      relicList: $('relic-list'),
      relicCount: $('relic-count'),
      nextWavePanel: $('next-wave-panel'),
      nextWaveList: $('next-wave-list'),
      nextWaveMeta: $('next-wave-meta'),
      towerPanel: $('tower-panel'),
      shopList: $('shop-list'),
      tooltip: $('tooltip'),
      toast: $('toast'),
      modalRoot: $('modal-root'),
      hpStat: $('hud-hp')?.closest('.stat'),
    };

    hydrateIcons();

    this.el.play.onclick = () => this.handlers.onPlay?.();
    this.el.daily.onclick = () => this.handlers.onDaily?.();
    this.buildWeeklyEntry();
    if (this.el.endless) this.el.endless.onclick = () => this.handlers.onEndless?.();
    this.el.resume.onclick = () => this.handlers.onResume?.();
    this.el.rename.onclick = () => this.handlers.onRename?.();
    this.el.settingsTitle.onclick = () => this.handlers.onSettings?.();
    this.el.settingsGame.onclick = () => this.handlers.onSettings?.();
    this.el.relicsMobile.onclick = () => this.handlers.onRelics?.();
    this.el.fullscreen.onclick = () => this.handlers.onFullscreen?.();
    this.el.rotateRetry.onclick = () => this.handlers.onForceLandscape?.();
    this.el.shop.onclick = () => this.handlers.onShop?.();
    this.el.board.onclick = () => this.handlers.onBoard?.('normal');
    this.el.help.onclick = () => this.handlers.onHelp?.();
    this.el.quit.onclick = () => this.handlers.onQuit?.();
    this.el.nextWave.onclick = () => this.handlers.onNextWave?.();
    this.el.sound.onclick = () => this.handlers.onSound?.();
    if (this.el.btnSkill) this.el.btnSkill.onclick = () => this.handlers.onSkill?.();

    document.querySelectorAll('.speed-btn').forEach((button) => {
      button.onclick = () => this.handlers.onSpeed?.(Number(button.dataset.speed));
    });

    this.buildPortalHint();
    this.bindTooltips();
    this.bindClickSound();
    this.updateSoundIcon();
  }

  // 本周挑战入口动态插入，避免改动静态标题页结构（与 HUD 提示同一做法）。
  buildWeeklyEntry() {
    if (this.el.weekly || !this.el.daily?.parentElement) return;
    const button = document.createElement('button');
    button.id = 'btn-weekly';
    button.type = 'button';
    button.className = 'btn ghost';
    button.innerHTML = '<span data-weekly-title></span> <span id="weekly-label"></span>';
    button.onclick = () => {
      if (this.handlers.onWeekly) return this.handlers.onWeekly();
      this.showWeeklySelect();
    };
    this.el.daily.insertAdjacentElement('afterend', button);
    this.el.weekly = button;
    this.el.weeklyTitle = button.querySelector('[data-weekly-title]');
    this.el.weeklyLabel = button.querySelector('#weekly-label');
  }

  // 周规则来自共享派生函数：同一周键与服务端派生同一套种子和词缀。
  showWeeklySelect() {
    this.showDifficultySelect('weekly', {
      weekly: weeklyChallenge(),
      skillState: this._titleExtras?.skillState,
      selectedSkill: this.selectedSkill,
    });
  }

  // HUD 入口提示：动态插入，避免改动静态页面结构；仅多入口地图显示。
  buildPortalHint() {
    if (this.el.portalHint) return;
    const anchor = this.el.waveState || this.el.nextWave;
    const parent = anchor?.parentElement;
    if (!parent) return;
    const hint = document.createElement('div');
    hint.id = 'portal-hint';
    hint.className = 'portal-hint';
    hint.hidden = true;
    hint.setAttribute('aria-live', 'polite');
    parent.insertBefore(hint, anchor);
    this.el.portalHint = hint;
  }

  bindClickSound() {
    document.addEventListener('click', (event) => {
      if (event.target.closest('button')) audio.play('click');
    });
  }

  bindTooltips() {
    document.addEventListener('mouseover', (event) => {
      const target = event.target.closest('[data-tip]');
      if (!target) return;
      this.el.tooltip.innerHTML = target.dataset.tip;
      this.el.tooltip.hidden = false;
      this.moveTooltip(event);
    });
    document.addEventListener('mousemove', (event) => {
      if (!this.el.tooltip.hidden) this.moveTooltip(event);
    });
    document.addEventListener('mouseout', (event) => {
      if (event.target.closest('[data-tip]')) this.el.tooltip.hidden = true;
    });
  }

  moveTooltip(event) {
    const tip = this.el.tooltip;
    const pad = 16;
    let x = event.clientX + pad;
    let y = event.clientY + pad;
    const rect = tip.getBoundingClientRect();
    if (x + rect.width > window.innerWidth - 8) x = event.clientX - rect.width - pad;
    if (y + rect.height > window.innerHeight - 8) y = event.clientY - rect.height - pad;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }

  updateSoundIcon() {
    if (!this.el?.sound) return;
    this.el.sound.innerHTML = iconSvg(audio.enabled ? 'sound' : 'muted');
    this.el.sound.title = t(audio.enabled ? 'hud.soundOn' : 'hud.soundOff');
  }

  setResumeAvailable(available) {
    if (this.el.resume) this.el.resume.hidden = !available;
  }

  showTitle(profile, extras = {}) {
    this.profile = profile;
    this._titleExtras = extras;
    this.game = null;
    audio.startMusic('menu');
    this.el.title.hidden = false;
    this.el.game.hidden = true;
    this.closeModal();
    this.hideTowerPanel();
    this.renderTitle();
  }

  renderTitle() {
    const profile = this.profile;
    const extras = this._titleExtras || {};
    const stats = profile?.stats || {};
    this.el.playerName.textContent = profile?.name || t('title.offline');
    this.el.cores.textContent = fmt(profile?.cores || 0);
    this.el.titleStats.innerHTML = `
      <div class="stat-cell"><span>${t('title.stat.bestWave')}</span><b>${fmt(stats.bestWave)}</b></div>
      <div class="stat-cell"><span>${t('title.stat.bestScore')}</span><b>${fmt(stats.bestScore)}</b></div>
      <div class="stat-cell"><span>${t('title.stat.kills')}</span><b>${fmt(stats.kills)}</b></div>
      <div class="stat-cell"><span>${t('title.stat.runs')}</span><b>${fmt(stats.runs)}</b></div>
    `;

    const left = extras.dailyLeft;
    const date = new Date();
    const label = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const streak = extras.daily?.streak || 0;
    const parts = [label];
    if (left != null) parts.push(t('title.daily.left', { n: left }));
    if (streak > 0) parts.push(t('title.daily.streak', { n: streak }));
    this.el.dailyLabel.textContent = parts.join(' · ');
    if (this.el.weeklyTitle) this.el.weeklyTitle.textContent = t('title.weekly');
    if (this.el.weeklyLabel) this.el.weeklyLabel.textContent = weekKey();
    this.setResumeAvailable(!!extras.hasSnapshot);
    this.renderTitleSkills(profile, extras);
  }

  // 语言切换后重渲染当前界面的动态文案；静态文案由 i18n 层统一处理。
  refreshLocale() {
    if (!this.el) return;
    this.updateSoundIcon();
    if (this.game) {
      this.updateHud(this.game.getHud());
      this.renderShop();
      this.renderRelics();
      if (this._panelTower) this.showTowerPanel(this._panelTower);
    } else if (this.profile) {
      this.renderTitle();
    }
  }


  // ---------- 技能（标题页 / 难度弹窗） ----------

  // 服务端快照优先；接口不可用时用共享数据 + 资料推导，保证标题页始终有内容。
  skillEntries(profile = this.profile, state = this._skillState) {
    if (state?.skills?.length) {
      return state.skills.map((entry) => ({ ...SKILLS[entry.id], ...entry }));
    }
    return SKILL_ORDER.map((id) => {
      const def = SKILLS[id];
      const level = 1;
      return {
        ...def,
        unlocked: isSkillUnlocked(id, profile),
        level,
        nextCost: skillUpgradeCost(level),
        canUpgrade: false,
        unlockHint: skillUnlockText(id),
        stats: skillStats(id, level),
      };
    });
  }

  resolveSelectedSkill(entries, preferred = this.selectedSkill) {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    if (preferred && byId.get(preferred)?.unlocked) return preferred;
    return entries.find((entry) => entry.unlocked)?.id || null;
  }

  renderTitleSkills(profile, extras = {}) {
    const host = this.el?.titleSkills;
    if (!host) return;
    if (extras.skillState) this._skillState = extras.skillState;
    const state = this._skillState;
    const entries = this.skillEntries(profile, state);
    const selected = this.resolveSelectedSkill(
      entries,
      extras.selectedSkill || state?.selected || this.selectedSkill
    );
    this.selectedSkill = selected;
    const cores = state?.wallet?.cores ?? profile?.cores ?? 0;

    host.innerHTML = `
      <div class="skill-cards-head">
        <span class="eyebrow">ACTIVE SKILL</span>
        <span class="muted">${t('skill.ui.carry')}</span>
      </div>
      <div class="skill-cards-grid">
        ${entries
          .map((entry) => {
            const level = Math.max(1, Math.min(ROMAN.length, Number(entry.level) || 1));
            const isSelected = selected === entry.id;
            const locked = !entry.unlocked;
            const full = entry.nextCost == null;
            const affordable = entry.nextCost != null && cores >= entry.nextCost;
            const hint = locked ? skillUnlock(entry) : null;
            const action = locked
              ? `<span class="skill-lock">${iconSvg('lock', 'icon-inline')}${escapeHtml(hint || t('skill.ui.locked'))}</span>`
              : full
                ? `<span class="skill-max">${t('skill.ui.maxed')}</span>`
                : `<button class="btn small skill-upgrade ${affordable ? 'primary' : ''}" data-upgrade="${entry.id}"
                     ${affordable && entry.canUpgrade !== false ? '' : 'disabled'}>${t('skill.ui.upgrade', { cost: entry.nextCost })}</button>`;
            return `
              <div class="skill-card ${locked ? 'locked' : ''} ${isSelected ? 'selected' : ''}"
                data-skill="${entry.id}" role="button" tabindex="${locked ? '-1' : '0'}"
                aria-pressed="${isSelected}" style="--skill:${entry.color}">
                <div class="skill-glyph" aria-hidden="true">${locked ? iconSvg('lock') : iconSvg('skill')}</div>
                <div class="skill-body">
                  <div class="skill-head">
                    <b class="skill-name">${escapeHtml(skillName(entry))}</b>
                    <span class="skill-role">${skillRole(entry)}</span>
                    <span class="skill-level">${ROMAN[level - 1]}</span>
                  </div>
                  <div class="skill-pips" aria-hidden="true">${Array.from({ length: 10 }, (_, i) =>
                    `<i class="${i < level ? 'on' : ''}"></i>`).join('')}</div>
                  <p class="skill-desc">${locked ? escapeHtml(hint || '') : escapeHtml(skillDesc(entry) || '')}</p>
                  ${locked ? '' : `<span class="skill-summary">${escapeHtml(skillSummary(entry.id, level))}</span>`}
                </div>
                <div class="skill-actions">${action}</div>
              </div>`;
          })
          .join('')}
      </div>
    `;

    host.querySelectorAll('.skill-card').forEach((card) => {
      const id = card.dataset.skill;
      const activate = () => {
        if (card.classList.contains('locked')) {
          const entry = entries.find((item) => item.id === id);
          this.toast(t('skill.ui.unlockCondition', { text: skillUnlock(entry || { id }) }), 2400);
          return;
        }
        this.handlers.onSelectSkill?.(id);
        if (!this.hasModal()) {
          this.selectedSkill = id;
          host.querySelectorAll('.skill-card').forEach((el) => {
            const on = el.dataset.skill === id;
            el.classList.toggle('selected', on);
            el.setAttribute('aria-pressed', String(on));
          });
        }
      };
      card.onclick = (event) => {
        if (event.target.closest('[data-upgrade]')) return;
        activate();
      };
      card.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          activate();
        }
      };
      const upgrade = card.querySelector('[data-upgrade]');
      if (upgrade) {
        upgrade.onclick = (event) => {
          event.stopPropagation();
          this.handlers.onSkillUpgrade?.(upgrade.dataset.upgrade);
        };
      }
    });
  }

  // 弹窗打开时选择技能：只更新选中样式，不关闭弹窗。
  updateSkillSelection(skillId) {
    this.selectedSkill = skillId;
    document.querySelectorAll('.skill-chip').forEach((chip) => {
      const on = chip.dataset.skill === skillId;
      chip.classList.toggle('selected', on);
      chip.setAttribute('aria-pressed', String(on));
    });
  }

  skillBarHtml(state, selected) {
    this._skillState = state || this._skillState;
    let entries = this.skillEntries(this.profile, this._skillState);
    // 每日/本周挑战使用固定规则集：全技能可选、固定 Ⅴ 级。
    if (this._fixedMode) {
      entries = entries.map((entry) => ({ ...entry, unlocked: true, level: 5 }));
    }
    const current = this.resolveSelectedSkill(entries, selected);
    this.selectedSkill = current;
    return `
      <div class="diff-skill-bar">
        <span class="diff-skill-label">${t(this._fixedMode ? 'skill.ui.carryDaily' : 'skill.ui.carryLabel')}</span>
        <div class="skill-chips">
          ${entries
            .map((entry) => {
              const level = Math.max(1, Math.min(ROMAN.length, Number(entry.level) || 1));
              const locked = !entry.unlocked;
              const on = current === entry.id;
              return `<button class="skill-chip ${on ? 'selected' : ''} ${locked ? 'locked' : ''}"
                data-skill="${entry.id}" aria-pressed="${on}" ${locked ? 'disabled' : ''}
                title="${escapeHtml(locked ? skillUnlock(entry) : `${skillName(entry)} ${ROMAN[level - 1]}`)}"
                style="--skill:${entry.color}">
                <span class="chip-glyph">${locked ? iconSvg('lock') : iconSvg('skill')}</span>
                <span class="chip-name">${escapeHtml(skillName(entry))}</span>
                <span class="chip-level">${locked ? t('skill.ui.locked') : ROMAN[level - 1]}</span>
              </button>`;
            })
            .join('')}
        </div>
      </div>`;
  }

  bindSkillChips(modal) {
    modal.querySelectorAll('.skill-chip').forEach((chip) => {
      chip.onclick = () => {
        if (chip.classList.contains('locked')) return;
        this.selectedSkill = chip.dataset.skill;
        this.handlers.onSelectSkill?.(chip.dataset.skill);
        this.updateSkillSelection(chip.dataset.skill);
      };
    });
  }

  showDifficultySelect(
    mode = 'normal',
    { dailyLeft = null, daily = null, weekly = null, skillState = null, selectedSkill = null } = {}
  ) {
    this._fixedMode = mode === 'daily' || mode === 'weekly';
    const stats = this.profile?.stats?.byDifficulty || {};
    const cards = DIFFICULTY_ORDER.map((id) => {
      const diff = DIFFICULTIES[id];
      const best = stats[id] || {};
      return `
        <button class="diff-card" data-id="${id}" style="--diff:${diff.color}">
          <span class="diff-name">${diffName(diff)}</span>
          <p>${diffDesc(diff)}</p>
          <div class="diff-mods">
            <span>${t('difficulty.hp', { mul: diff.hpMul.toFixed(2) })}</span>
            <span>${t('difficulty.count', { mul: diff.countMul.toFixed(2) })}</span>
            <span>${t('difficulty.score', { mul: diff.scoreMul.toFixed(2) })}</span>
          </div>
          <div class="diff-best">${t('difficulty.best', { wave: fmt(best.bestWave), score: fmt(best.bestScore) })}</div>
        </button>`;
    }).join('');

    const endless = mode === 'endless';
    const weeklyMode = mode === 'weekly';
    const title = weeklyMode
      ? t('difficulty.weeklyTitle')
      : mode === 'daily'
        ? t('difficulty.dailyTitle')
        : endless
          ? t('difficulty.endlessTitle')
          : t('difficulty.startTitle');
    const affixes = ((weeklyMode ? weekly?.modifiers : daily?.modifiers) || [])
      .map((modifier) => `<span style="color:${modifier.color}">${modifier.name}</span>`)
      .join(' · ');
    const streakNote = daily?.streak > 0 ? t('difficulty.streak', { n: daily.streak }) : '';
    const note = weeklyMode
      ? `<p class="muted">${t('difficulty.weeklyNote', { week: weekly?.week || weekKey() })}</p>
         ${affixes ? `<p class="muted">${t('difficulty.weeklyAffixes', { affixes })}</p>` : ''}`
      : mode === 'daily'
        ? `<p class="muted">${t('difficulty.dailyNote', { n: dailyLeft ?? 0 })}</p>
           ${affixes ? `<p class="muted">${t('difficulty.dailyAffixes', { affixes })}${streakNote}</p>` : ''}`
        : endless
          ? `<p class="muted">${t('difficulty.endlessNote')}</p>`
          : `<p class="muted">${t('difficulty.note')}</p>`;
    const eyebrow = weeklyMode
      ? t('difficulty.eyebrowWeekly')
      : mode === 'daily'
        ? t('difficulty.eyebrowDaily')
        : endless
          ? t('difficulty.eyebrowEndless')
          : t('difficulty.eyebrowNormal');

    const modal = this.openModal(
      `<div class="difficulty">
        <p class="eyebrow">${eyebrow}</p>
        <h2>${title} · ${t('difficulty.title')}</h2>
        ${note}
        ${this.skillBarHtml(skillState, selectedSkill)}
        <div class="diff-cards">${cards}</div>
        <div class="modal-actions">
          <button class="btn ghost" id="btn-cancel-diff">${t('difficulty.cancel')}</button>
        </div>
      </div>`,
      { className: 'difficulty-modal', closable: true }
    );

    modal.querySelectorAll('.diff-card').forEach((card) => {
      card.onclick = () => this.handlers.onChooseDifficulty?.(mode, card.dataset.id);
    });
    this.bindSkillChips(modal);
    modal.querySelector('#btn-cancel-diff').onclick = () => this.closeModal();
  }

  showMapSelect({ candidates, onChoose, onCancel }) {
    const cards = candidates
      .map((candidate, index) => {
        const modifier = candidate.modifier;
        const color = modifier?.color || '#9fb0c3';
        const preview = mapPreviewSvg(candidate);
        const portalCount = candidate.spawns?.length || 1;
        // 单入口地图即使 meta.merge 指向基地，也不应展示“汇流”文案。
        const desc =
          portalCount <= 1
            ? t('mapSelect.single')
            : candidate.archetype === 'cross'
              ? t('mapSelect.cross')
              : t('mapSelect.merge');
        return `
          <button class="map-card" data-index="${index}" style="--lane:${color}">
            <div class="map-preview">${preview}</div>
            <div class="map-card-head">
              <b>${candidate.archetypeName}</b>
              <span class="map-portals">${t('mapSelect.portals', { n: portalCount })}</span>
            </div>
            <p class="map-desc">${desc}</p>
            <div class="map-mod" style="color:${color}">
              <b>${modifier?.name || t('mapSelect.noModifier')}</b>
              <span>${modifier?.desc || t('mapSelect.standard')}</span>
            </div>
            <div class="map-foot">
              <span>${t('mapSelect.score', { mul: candidate.meta?.scoreMul?.toFixed(2) || '1.00' })}</span>
              <span class="pick">${t('mapSelect.pick')}</span>
            </div>
          </button>`;
      })
      .join('');

    const modal = this.openModal(
      `
        <div class="map-select">
          <p class="eyebrow">${t('mapSelect.eyebrow')}</p>
          <h2>${t('mapSelect.title')}</h2>
          <p class="muted">${t('mapSelect.note')}</p>
          <div class="map-cards">${cards}</div>
          <div class="modal-actions">
            <button class="btn ghost" id="btn-cancel-map">${t('mapSelect.abandon')}</button>
          </div>
        </div>
      `,
      { className: 'map-modal', closable: false }
    );

    modal.querySelectorAll('.map-card').forEach((card) => {
      card.onclick = () => onChoose?.(Number(card.dataset.index));
    });
    modal.querySelector('#btn-cancel-map').onclick = () => onCancel?.();
  }

  showGame({ game, profile }) {
    this.game = game;
    if (profile) this.profile = profile;
    audio.startMusic('battle');
    this.el.title.hidden = true;
    this.el.game.hidden = false;
    this.closeModal();
    this.hideTowerPanel();
    this.renderShop();
    this.renderRelics();
    this.updateHud(game.getHud());
    this.updateSkillButton(game.getHud());
  }

  // ---------- HUD ----------

  updateHud(hud) {
    if (!hud || !this.el) return;
    this.el.hudWave.textContent = hud.wave;
    this.el.hudGold.textContent = fmt(hud.gold);
    this.el.hudHp.textContent = hud.baseHp;
    this.el.hudHpMax.textContent = `/${hud.maxBaseHp}`;
    this.el.hudKills.textContent = fmt(hud.kills);
    if (this.el.hudRelics) this.el.hudRelics.textContent = hud.relicCount ?? 0;

    this.el.hudHp.classList.toggle('low', hud.baseHp / hud.maxBaseHp <= 0.35);

    if (hud.difficulty && this.el.hudDifficulty) {
      const diff = DIFFICULTIES[hud.difficulty] || DIFFICULTIES.standard;
      this.el.hudDifficulty.textContent = diffName(diff);
      this.el.hudDifficulty.style.setProperty('--diff', diff.color);
    }

    this.updatePortalHint(hud);
    this.updateNextWave(hud);

    if (hud.phase === 'wave') {
      audio.startMusic(hud.waveDef?.boss || hud.waveDef?.finalBoss ? 'boss' : 'battle');
      const bossKey = hud.waveDef?.finalBoss
        ? 'hud.state.finalBoss'
        : hud.waveDef?.boss
          ? 'hud.state.boss'
          : null;
      if (bossKey) {
        this.el.waveState.innerHTML = `${iconSvg('warning', 'icon-inline')}${escapeHtml(
          t(bossKey).replace(/^[^\p{L}\p{N}]+/u, '')
        )}`;
      } else {
        this.el.waveState.textContent = t('hud.state.fighting');
      }
      this.el.waveState.classList.add('live');
      this.el.nextWave.disabled = true;
      this.el.nextWave.textContent = t('hud.fightingEnemies', { count: hud.enemies });
    } else if (hud.phase === 'over') {
      this.el.waveState.textContent = t('hud.state.over');
      this.el.waveState.classList.remove('live');
      this.el.nextWave.disabled = true;
    } else {
      audio.startMusic('battle');
      const next = hud.nextWave;
      if (next) {
        const label = t('hud.state.incoming', {
          phase: t(hud.wave === 0 ? 'hud.phase.prepare' : 'hud.phase.rally'),
          count: next.totalCount,
          boss: '',
        });
        this.el.waveState.innerHTML = `${escapeHtml(label)}${
          next.boss ? ` ${iconSvg('warning')}` : ''
        }`;
      } else {
        this.el.waveState.textContent = t(hud.wave === 0 ? 'hud.phase.ready' : 'hud.phase.rallyStage');
      }
      this.el.waveState.classList.remove('live');
      // 无尽模式没有“最终波次”：第 30 波后仍可继续放行。
      const atFinalWave = hud.mode !== 'endless' && hud.wave >= MAX_WAVE;
      this.el.nextWave.disabled = atFinalWave;
      this.el.nextWave.textContent =
        hud.wave === 0
          ? t('hud.startWave1')
          : atFinalWave
            ? t('hud.finalWave')
            : t('hud.startWave', { wave: hud.wave + 1 });
    }

    document.querySelectorAll('.speed-btn').forEach((button) => {
      const value = Number(button.dataset.speed);
      const active = value === 0 ? hud.paused : !hud.paused && value === hud.speed;
      button.classList.toggle('active', active);
    });

    this.updateShopState();
    this.updateTowerPanelState(hud.gold);
    this.updateSkillButton(hud);
  }

  // 局内技能按钮：圆形、径向冷却、可用呼吸光、Q 提示；整备阶段置灰。
  updateSkillButton(hud = {}) {
    const btn = this.el?.btnSkill;
    const sim = this.game;
    if (!btn) return;
    const skill = sim?.skill;
    if (!skill || !skill.id) {
      btn.hidden = true;
      btn.dataset.state = 'none';
      return;
    }
    const def = SKILLS[skill.id] || { id: skill.id, color: '#7cd4f5' };
    const name = tOr(`skill.${skill.id}.name`, def.name || t('skill.ui.fallback'));
    const stats = skill.stats || skillStats(skill.id, skill.level || 1);
    const maxCd = Math.max(1, Number(stats?.cd) || 1);
    const cooldown = Math.max(0, Number(skill.cooldown ?? skill.cd ?? 0));
    const ratio = Math.min(1, cooldown / maxCd);
    const phase = sim.phase;
    const paused = !!hud.paused;
    const ready = phase === 'wave' && cooldown <= 0 && !paused;

    btn.hidden = false;
    btn.style.setProperty('--skill', def.color);
    btn.style.setProperty('--cd', `${(ratio * 360).toFixed(1)}deg`);
    btn.classList.toggle('ready', ready);
    btn.classList.toggle('cooling', cooldown > 0);
    btn.classList.toggle('idle', phase !== 'wave');
    btn.dataset.skill = skill.id;
    btn.dataset.state = ready
      ? 'ready'
      : phase !== 'wave'
        ? 'prep'
        : cooldown > 0
          ? 'cooling'
          : 'paused';
    const status =
      phase !== 'wave'
        ? t('skill.ui.status.prep')
        : cooldown > 0
          ? t('skill.ui.status.cooling', { s: Math.ceil(cooldown) })
          : t('skill.ui.status.ready');
    btn.title = t('skill.ui.buttonTitle', { name, status });
    btn.setAttribute('aria-label', t('skill.ui.buttonAria', { name, status }));
    if (this.el.skillCount) {
      this.el.skillCount.textContent = cooldown > 0 && phase === 'wave' ? String(Math.ceil(cooldown)) : '';
    }
  }

  // 本波入口：波中高亮激活入口，其余变暗；整备阶段全部保持常态。
  updatePortalHint(hud) {
    const hint = this.el?.portalHint;
    if (!hint) return;
    const count = Math.max(1, Math.min(3, Math.floor(hud.portalCount || 1)));
    if (count < 2) {
      hint.hidden = true;
      hint.innerHTML = '';
      return;
    }
    const inWave = hud.phase === 'wave';
    const active = new Set(
      inWave
        ? hud.activePortals?.length
          ? hud.activePortals
          : [0]
        : Array.from({ length: count }, (_, i) => i)
    );
    const spawns = this.game?.map?.spawns || [];
    const chips = Array.from({ length: count }, (_, index) => {
      const color = spawns[index]?.color || '#9fb0c3';
      const isActive = active.has(index);
      const idle = inWave && !isActive;
      return `<span class="portal-chip${isActive ? ' active' : ''}${idle ? ' idle' : ''}"
        style="--portal:${color}" title="${t('hud.portal.title', { n: index + 1 })}${idle ? `（${t('hud.portal.idle')}）` : ''}">
        <i aria-hidden="true"></i>${index + 1}
      </span>`;
    }).join('');
    hint.hidden = false;
    hint.innerHTML = `<span class="portal-label">${t(inWave ? 'hud.portal.active' : 'hud.portal.label')}</span>${chips}`;
  }

  // 下一波情报：整备阶段挂在遗物面板底部；波中隐藏，避免干扰战斗。
  updateNextWave(hud) {
    const panel = this.el?.nextWavePanel;
    if (!panel) return;
    const preview = hud.phase === 'prep' ? hud.nextWave : null;
    if (!preview) {
      panel.hidden = true;
      this._nextWaveSig = '';
      return;
    }
    panel.hidden = false;
    const signature = `${preview.index}|${preview.totalCount}|${preview.boss}|${preview.enemies
      .map((item) => `${item.type}:${item.count}`)
      .join(',')}`;
    if (signature === this._nextWaveSig) return;
    this._nextWaveSig = signature;
    this.el.nextWaveMeta.textContent = preview.boss
      ? t('hud.nextWave.bossMeta', { wave: preview.index })
      : t('hud.nextWave.meta', { wave: preview.index });
    this.el.nextWaveMeta.classList.toggle('boss', !!preview.boss);
    this.el.nextWaveList.innerHTML = [...preview.enemies]
      .sort((a, b) => b.count - a.count)
      .map(({ type, count }) => {
        const def = ENEMIES[type] || { id: type, name: type, color: '#9fb0c3' };
        return `<div class="next-wave-row"><i style="--c:${def.color}"></i>${enemyName(def)}<b>×${count}</b></div>`;
      })
      .join('');
  }

  // ---------- 商店 ----------

  renderShop() {
    if (!this.el?.shopList) return;
    this.el.shopList.innerHTML = '';
    TOWER_ORDER.forEach((id, index) => {
      const def = TOWERS[id];
      const locked = !this.game.unlockedTowers.includes(id);
      const button = document.createElement('button');
      button.className = `tower-card${locked ? ' locked' : ''}`;
      button.dataset.type = id;
      button.disabled = locked;
      const level0 = def.levels[0];
      const statsText = def.support
        ? t('shop.auraStats', {
            dmg: Math.round(level0.buffDmg * 100),
            rate: Math.round(level0.buffRate * 100),
            range: level0.range,
          })
        : t('shop.baseStats', { dmg: level0.dmg, range: level0.range });
      button.dataset.tip = `<b style="color:${def.color}">${towerName(def)}</b><p>${def.desc}</p>
        <p class="tip-stats">${t('shop.cost')} ${this.game.towerCost(id)} · ${statsText}</p>`;
      button.innerHTML = `
        <span class="key">${index + 1}</span>
        <span class="glyph" style="color:${def.color}">${iconSvg('tower')}</span>
        <span class="name">${towerName(def)}</span>
        <span class="cost">${iconSvg('gold', 'icon-inline')}${this.game.towerCost(id)}</span>
        ${locked ? `<span class="lock">${t('shop.locked')}</span>` : ''}
      `;
      button.onclick = () => this.handlers.onSelectShop?.(id);
      this.el.shopList.appendChild(button);
    });
    this.updateShopState();
  }

  updateShopState() {
    if (!this.game) return;
    document.querySelectorAll('.tower-card').forEach((card) => {
      const type = card.dataset.type;
      card.classList.toggle('selected', this.game.placementType === type);
      const cost = this.game.towerCost(type);
      card.classList.toggle('poor', this.game.gold < cost);
    });
  }

  // ---------- 遗物 ----------

  renderRelics() {
    if (!this.el?.relicList || !this.game) return;
    this.el.relicList.innerHTML = '';
    this.el.relicCount.textContent = this.game.relics.length;
    if (!this.game.relics.length) {
      const empty = document.createElement('div');
      empty.className = 'relic-empty';
      empty.textContent = t('relic.empty');
      this.el.relicList.appendChild(empty);
      return;
    }
    for (const state of this.game.relics) {
      const relic = RELIC_BY_ID[state.id];
      if (!relic) continue;
      const level = Math.min(3, Math.max(1, state.level || 1));
      const rarity = RARITY[relic.rarity];
      const chip = document.createElement('div');
      chip.className = 'relic-chip';
      chip.dataset.tip = `<b style="color:${rarity.color}">${relic.name} ${RELIC_LEVEL_LABELS[level - 1]}</b><span class="rarity-tag" style="color:${rarity.color}">${rarity.name}</span><p>${relicEffectText(state.id, level)}</p>`;
      chip.innerHTML = `<i style="background:${rarity.color}"></i><span>${relic.name} <em class="relic-level">${RELIC_LEVEL_LABELS[level - 1]}</em></span>`;
      this.el.relicList.appendChild(chip);
    }
  }

  // ---------- 选中塔面板 ----------

  showTowerPanel(tower) {
    if (!this.game || !this.el?.towerPanel) return;
    this._panelTower = tower;
    const def = TOWERS[tower.type];
    const stats = this.game.statsFor(tower);
    const cost = this.game.upgradeCost(tower);
    const sell = this.game.sellValue(tower);
    const evolution = this.game.towerEvolution?.(tower) || null;
    const evolutions = this.game.evolutionOptions?.(tower) || [];
    const title = evolution ? `${towerName(def)} · ${evolution.name}` : towerName(def);
    this.el.towerPanel.hidden = false;
    this.el.towerPanel.innerHTML = `
      <div class="tp-head">
        <span class="tp-name" style="color:${evolution?.color || def.color}">${title} <em>Lv.${tower.level + 1}</em></span>
        <button class="tp-close" title="${t('towerPanel.close')}">${iconSvg('close')}</button>
      </div>
      <div class="tp-stats">
        ${def.support
          ? `<span>${t('towerPanel.auraDmg')} <b>+${Math.round(stats.buffDmg * 100)}%</b></span>
        <span>${t('towerPanel.auraRate')} <b>+${Math.round(stats.buffRate * 100)}%</b></span>
        <span>${t('towerPanel.range')} <b>${stats.range.toFixed(1)}</b></span>`
          : `<span>${t('towerPanel.damage')} <b>${stats.dmg.toFixed(1)}</b></span>
        <span>${t('towerPanel.attackSpeed')} <b>${stats.rate.toFixed(2)}/s</b></span>
        <span>${t('towerPanel.rangeShort')} <b>${stats.range.toFixed(1)}</b></span>`}
      </div>
      <div class="tp-actions">
        <button class="btn small upgrade" ${cost == null ? 'disabled' : ''}>
          ${cost == null ? t('towerPanel.maxed') : t('towerPanel.upgrade', { cost })}
        </button>
        <button class="btn small danger sell">${t('towerPanel.sell', { value: sell })}</button>
      </div>
      ${evolution
        ? `<div class="tp-evolution" style="display:flex;gap:8px;align-items:baseline;margin-top:8px">
             <span class="muted">进化</span>
             <b style="color:${evolution.color || def.color}">${evolution.name}</b>
             <em class="muted" style="font-size:11px">${evolutionEffectText(evolution)}</em>
           </div>`
        : ''}
      ${evolutions.length
        ? `<div class="tp-evolutions" style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
             <span class="muted">满级进化 · 二选一</span>
             <div class="tp-evolution-actions" style="display:flex;gap:6px;flex-wrap:wrap">
               ${evolutions
                 .map(
                   (entry, index) =>
                     `<button class="btn small evolve" data-evolve="${entry.id}" title="${escapeHtml(entry.desc)}"
                        style="border-color:${entry.color || def.color}"><em>${index + 1}</em> ${escapeHtml(entry.name)}</button>`
                 )
                 .join('')}
             </div>
           </div>`
        : ''}
    `;
    this.el.towerPanel.querySelector('.tp-close').onclick = () => this.handlers.onDeselect?.();
    const upgradeBtn = this.el.towerPanel.querySelector('.upgrade');
    if (cost != null) upgradeBtn.onclick = () => this.handlers.onUpgrade?.(tower);
    this.el.towerPanel.querySelectorAll('[data-evolve]').forEach((button) => {
      button.onclick = () => this.handlers.onEvolve?.(tower, button.dataset.evolve);
    });
    this.el.towerPanel.querySelector('.sell').onclick = () => this.handlers.onSell?.(tower);
    this.updateTowerPanelState(this.game.gold);
  }

  updateTowerPanelState(gold) {
    if (!this._panelTower || !this.el?.towerPanel || this.el.towerPanel.hidden) return;
    const cost = this.game.upgradeCost(this._panelTower);
    const button = this.el.towerPanel.querySelector('.upgrade');
    if (!button || cost == null) return;
    button.classList.toggle('poor', gold < cost);
  }

  hideTowerPanel() {
    this._panelTower = null;
    if (this.el?.towerPanel) {
      this.el.towerPanel.hidden = true;
      this.el.towerPanel.innerHTML = '';
    }
  }

  // 满级二选一：与遗物三选一区分开，键盘 1 / 2 直接选择。
  showEvolutionModal(tower) {
    if (!this.game || !tower) return;
    const def = TOWERS[tower.type];
    const options = this.game.evolutionOptions?.(tower) || [];
    if (!options.length) return;
    const cards = options
      .map(
        (evolution, index) => `
          <button class="relic-card evolution-card" data-evolve="${evolution.id}"
            style="--rarity:${evolution.color || def.color}">
            <span class="rarity">进化 · ${index + 1}</span>
            <h3>${escapeHtml(evolution.name)}</h3>
            <div class="relic-effect"><span>属性</span>${evolutionEffectText(evolution)}</div>
            <p class="relic-flavor">${escapeHtml(evolution.desc)}</p>
            <span class="pick">选择</span>
          </button>`
      )
      .join('');
    const modal = this.openModal(
      `
        <div class="draft evolution">
          <p class="eyebrow">${escapeHtml(towerName(def))} · Lv.${tower.level + 1}</p>
          <h2>选择最终形态</h2>
          <div class="draft-cards">${cards}</div>
          <div class="draft-actions">
            <span class="muted">键盘 1 / 2 选择 · Esc 稍后再选</span>
          </div>
        </div>
      `,
      { className: 'evolution-modal' }
    );

    const pick = (evolutionId) => {
      this.closeModal();
      this.handlers.onEvolve?.(tower, evolutionId);
    };
    modal.querySelectorAll('[data-evolve]').forEach((card) => {
      card.onclick = () => pick(card.dataset.evolve);
    });

    const onKey = (event) => {
      if (event.key !== '1' && event.key !== '2') return;
      const evolution = options[Number(event.key) - 1];
      if (!evolution) return;
      event.preventDefault();
      pick(evolution.id);
    };
    window.addEventListener('keydown', onKey);
    this._modalCleanup = () => window.removeEventListener('keydown', onKey);
  }

  // 局内事件节点：祭坛/商队/赌局三选一，与遗物三选一用不同标题与卡片样式区分。
  showEventModal({ wave, event, gold, baseHp, maxHp, onChoose }) {
    if (!event) return;
    const options = event.options || [];
    const cards = options
      .map((option, index) => {
        const affordable = canAffordEventOption(option, { gold, baseHp, maxHp });
        return `
          <button class="relic-card event-card ${affordable ? '' : 'locked'}" data-index="${index}"
            ${affordable ? '' : 'disabled'} style="--rarity:#c9a227">
            <span class="rarity">事件 · ${index + 1}</span>
            <h3>${escapeHtml(option.name)}</h3>
            <p class="relic-flavor">${escapeHtml(option.desc)}</p>
            <span class="pick">${affordable ? '选择' : '资源不足'}</span>
          </button>
        `;
      })
      .join('');

    const modal = this.openModal(
      `
        <div class="event-node">
          <p class="eyebrow">第 ${wave} 波 · 事件节点</p>
          <h2>${escapeHtml(event.name)}</h2>
          <p class="muted">${escapeHtml(event.desc)}</p>
          <div class="draft-cards">${cards}</div>
          <div class="draft-actions">
            <span class="muted">键盘 1–${options.length} 选择</span>
          </div>
        </div>
      `,
      { className: 'event-modal', closable: false }
    );

    modal.querySelectorAll('.event-card').forEach((card) => {
      if (card.disabled) return;
      card.onclick = () => onChoose?.(Number(card.dataset.index));
    });

    const onKey = (event) => {
      const index = Number(event.key);
      if (!Number.isInteger(index) || index < 1 || index > options.length) return;
      if (!canAffordEventOption(options[index - 1], { gold, baseHp, maxHp })) return;
      event.preventDefault();
      onChoose?.(index - 1);
    };
    window.addEventListener('keydown', onKey);
    this._modalCleanup = () => window.removeEventListener('keydown', onKey);
    audio.play('draft');
  }

  // ---------- 弹窗 ----------

  openModal(html, { className = '', closable = true, onClose = null } = {}) {
    this.modalClosable = closable;
    this._modalOnClose = onClose;
    this.el.modalRoot.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal ${className}">${html}</div>
      </div>
    `;
    const backdrop = this.el.modalRoot.querySelector('.modal-backdrop');
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop && this.modalClosable) this.closeModal();
    });
    return this.el.modalRoot.querySelector('.modal');
  }

  closeModal() {
    const onClose = this._modalOnClose;
    const cleanup = this._modalCleanup;
    this._modalOnClose = null;
    this._modalCleanup = null;
    if (this.el?.modalRoot) this.el.modalRoot.innerHTML = '';
    this.modalClosable = false;
    if (cleanup) cleanup();
    if (onClose) onClose();
  }

  closeModalIfClosable() {
    if (this.modalClosable) this.closeModal();
  }

  hasModal() {
    return !!this.el?.modalRoot?.querySelector('.modal');
  }

  showDraft({ wave, offers, rerolls, gold, cost = 25 }) {
    const used = rerolls?.used || 0;
    const max = rerolls?.max || 0;
    const cards = offers
      .map((offer, index) => {
        if (offer.kind === 'relic') {
          const relic = RELIC_BY_ID[offer.id];
          if (!relic) return '';
          const rarity = RARITY[relic.rarity];
          const fromLevel = Math.max(0, Math.min(3, offer.fromLevel || 0));
          const toLevel = Math.min(3, offer.toLevel || fromLevel + 1);
          const isUpgrade = fromLevel > 0;
          const levelLabel = isUpgrade
            ? `${RELIC_LEVEL_LABELS[fromLevel - 1]} → ${RELIC_LEVEL_LABELS[toLevel - 1]}`
            : t('draft.new');
          const effect = isUpgrade
            ? `<div class="relic-effect"><span>${t('draft.current')}</span>${relicEffectText(offer.id, fromLevel)}</div>
               <div class="relic-effect upgrade"><span>${t('draft.upgrade')}</span>${relicEffectText(offer.id, toLevel)}</div>`
            : `<div class="relic-effect"><span>${t('draft.effect')}</span>${relicEffectText(offer.id, toLevel)}</div>`;
          return `
            <button class="relic-card ${isUpgrade ? 'upgrade' : ''}" data-index="${index}" style="--rarity:${rarity.color}">
              <span class="rarity">${rarity.name} ${iconSvg(relicIconName(relic.rarity), 'icon-inline')}· ${levelLabel}</span>
              <h3>${relic.name}</h3>
              ${effect}
              <p class="relic-flavor">${relic.desc}</p>
              <span class="pick">${t('draft.pick')}</span>
            </button>
          `;
        }

        const isGold = offer.kind === 'gold';
        const amount = Math.max(0, Math.floor(offer.amount || 0));
        return `
          <button class="relic-card fallback" data-index="${index}" style="--rarity:#8fa3b2">
            <span class="rarity">${t('draft.supply')}</span>
            <h3>${isGold ? t('draft.goldSupply') : t('draft.repair')}</h3>
            <div class="relic-effect"><span>${t('draft.effect')}</span>${
              isGold ? t('draft.goldEffect', { n: amount }) : t('draft.repairEffect', { n: amount })
            }</div>
            <p class="relic-flavor">${t('draft.fallbackFlavor')}</p>
            <span class="pick">${t('draft.pick')}</span>
          </button>
        `;
      })
      .join('');

    const modal = this.openModal(
      `
        <div class="draft">
          <p class="eyebrow">${t('draft.eyebrow', { wave })}</p>
          <h2>${t('draft.title')}</h2>
          <div class="draft-cards">${cards}</div>
          <div class="draft-actions">
            <span class="muted">${t('draft.gold', { gold: fmt(gold) })}</span>
            <button class="btn ghost" id="btn-reroll" ${used >= max || gold < cost ? 'disabled' : ''}>
              ${t('draft.reroll', { cost })} <span class="muted">(${used}/${max})</span>
            </button>
          </div>
        </div>
      `,
      { className: 'draft-modal', closable: false }
    );

    modal.querySelectorAll('.relic-card').forEach((card) => {
      card.onclick = () => this.handlers.onPickOffer?.(Number(card.dataset.index));
    });
    const reroll = modal.querySelector('#btn-reroll');
    if (reroll) reroll.onclick = () => this.handlers.onReroll?.();
    audio.play('draft');
  }

  showSettings({ settings, inGame = false, onApply, onCancel }) {
    const current = normalizeSettings(settings);
    const option = (value, label, selected) =>
      `<option value="${value}" ${String(selected) === String(value) ? 'selected' : ''}>${label}</option>`;
    const presetLabel = (name) =>
      name === 'custom'
        ? t('settings.presetCustom')
        : name === 'low'
          ? t('settings.presetLowName')
          : t('settings.presetHighName');
    const toOption = (value, label, selected) =>
      `<option value="${value}" ${String(selected) === String(value) ? 'selected' : ''}>${label}</option>`;
    const currentLocale = getLocale();

    const modal = this.openModal(
      `
        <div class="settings">
          <p class="eyebrow">${t('settings.eyebrow')}</p>
          <h2>${t('settings.title')}</h2>
          <p class="muted">${t(inGame ? 'settings.noteInGame' : 'settings.note')}</p>
          <div class="settings-grid">
            <label class="setting-field"><span>${t('settings.targetFps')}</span>
              <select id="set-fps">${option(30, '30 FPS', current.fps)}${option(60, '60 FPS', current.fps)}</select>
            </label>
            <label class="setting-field"><span>${t('settings.resolution')}</span>
              <select id="set-dpr">${option(1, t('settings.dprStandard'), current.dpr)}${option(2, t('settings.dprHigh'), current.dpr)}</select>
            </label>
            <label class="setting-field"><span>${t('settings.decorations')}</span>
              <select id="set-decorations">${['off', 'light', 'full']
                .map((value) => option(value, t(`settings.decor.${value}`), current.decorations))
                .join('')}</select>
            </label>
            <label class="setting-field"><span>${t('settings.floaters')}</span>
              <select id="set-floaters">${['off', 'key', 'all']
                .map((value) => option(value, t(`settings.floater.${value}`), current.floaters))
                .join('')}</select>
            </label>
            <label class="setting-check"><input type="checkbox" id="set-glow" ${current.glow ? 'checked' : ''} /> ${t('settings.glow')}</label>
            <label class="setting-check"><input type="checkbox" id="set-shake" ${current.shake ? 'checked' : ''} /> ${t('settings.shake')}</label>
            <label class="setting-check"><input type="checkbox" id="set-showfps" ${current.showFps ? 'checked' : ''} /> ${t('settings.showFps')}</label>
            <label class="setting-check"><input type="checkbox" id="set-music" ${current.music ? 'checked' : ''} /> ${t('settings.music')}</label>
            <label class="setting-check"><input type="checkbox" id="set-sound" ${audio.enabled ? 'checked' : ''} /> ${t('settings.sound')}</label>
            <label class="setting-field"><span>${t('settings.language')}</span>
              <select id="set-locale">${LOCALES.map((locale) =>
                toOption(locale, t(locale === 'zh-CN' ? 'settings.languageZh' : 'settings.languageEn'), currentLocale)
              ).join('')}</select>
            </label>
          </div>
          <div class="settings-presets">
            <button class="btn small" id="preset-low">${t('settings.presetLow')}</button>
            <button class="btn small" id="preset-high">${t('settings.presetHigh')}</button>
            <span class="muted" id="preset-label">${t('settings.currentPreset', { preset: presetLabel(detectPreset(current)) })}</span>
          </div>
          <div class="modal-actions">
            <button class="btn primary" id="settings-apply">${t('common.apply')}</button>
            <button class="btn ghost" id="settings-cancel">${t('common.cancel')}</button>
          </div>
        </div>
      `,
      {
        className: 'settings-modal',
        closable: true,
        onClose: () => onCancel?.(),
      }
    );

    const read = () => ({
      fps: Number(modal.querySelector('#set-fps').value),
      dpr: Number(modal.querySelector('#set-dpr').value),
      decorations: modal.querySelector('#set-decorations').value,
      floaters: modal.querySelector('#set-floaters').value,
      glow: modal.querySelector('#set-glow').checked,
      shake: modal.querySelector('#set-shake').checked,
      showFps: modal.querySelector('#set-showfps').checked,
      music: modal.querySelector('#set-music').checked,
    });

    const fill = (values) => {
      const next = normalizeSettings(values);
      modal.querySelector('#set-fps').value = String(next.fps);
      modal.querySelector('#set-dpr').value = String(next.dpr);
      modal.querySelector('#set-decorations').value = next.decorations;
      modal.querySelector('#set-floaters').value = next.floaters;
      modal.querySelector('#set-glow').checked = next.glow;
      modal.querySelector('#set-shake').checked = next.shake;
      modal.querySelector('#set-showfps').checked = next.showFps;
      modal.querySelector('#set-music').checked = next.music;
      modal.querySelector('#set-sound').checked = audio.enabled;
      updateLabel();
    };

    const updateLabel = () => {
      const detected = detectPreset(read());
      modal.querySelector('#preset-label').textContent =
        t('settings.currentPreset', { preset: presetLabel(detected) });
    };

    modal.querySelectorAll('select, input').forEach((input) => {
      input.addEventListener('change', updateLabel);
    });
    // 语言即时生效：保留未提交的画质改动并重建面板，让面板自身也切换文案。
    modal.querySelector('#set-locale').addEventListener('change', (event) => {
      const next = read();
      setLocale(event.target.value);
      this.showSettings({ settings: next, inGame, onApply, onCancel });
    });
    // 画质预设不覆盖用户单独选择的音乐开关。
    const applyPreset = (name) => {
      fill({ ...presetSettings(name), music: modal.querySelector('#set-music').checked });
    };
    modal.querySelector('#preset-low').onclick = () => applyPreset('low');
    modal.querySelector('#preset-high').onclick = () => applyPreset('high');
    modal.querySelector('#settings-apply').onclick = () => {
      const next = read();
      audio.setEnabled(modal.querySelector('#set-sound').checked);
      audio.setMusicEnabled(next.music);
      this.updateSoundIcon();
      this._modalOnClose = null;
      this.closeModal();
      onApply?.(next);
    };
    modal.querySelector('#settings-cancel').onclick = () => this.closeModal();
  }

  showResult({ stats, res, mode, dailyLeft }) {
    audio.stopMusic();
    const victory = res?.victory ?? stats.victory ?? false;
    const difficulty = res?.difficulty || stats.difficulty || 'standard';
    const diff = DIFFICULTIES[difficulty] || DIFFICULTIES.standard;
    const score = res?.score ?? stats.score;
    const cores = res ? res.coresEarned : 0;
    const rank = res?.rank;
    const personalBest = res?.personalBest;
    const extra =
      mode === 'daily' && dailyLeft != null
        ? `<p class="muted">${t('result.dailyLeft', { n: dailyLeft })}</p>`
        : mode === 'endless'
          ? `<p class="muted">${t('result.endlessNote')}</p>`
          : '';

    const diffTag = victory
      ? t('result.clearedTag', { name: diffName(diff) })
      : t('result.difficultyTag', { name: diffName(diff) });

    const modal = this.openModal(
      `
        <div class="result ${victory ? 'victory' : ''}">
          <p class="eyebrow">${t(victory ? 'result.victoryTag' : 'result.overTag')}</p>
          <h2>${victory ? t('result.victoryTitle') : t('result.reached', { wave: stats.wave })}</h2>
          <p class="diff-tag" style="color:${diff.color}">${diffTag}</p>
          <div class="score-big">${fmt(score)}</div>
          <p class="muted">${t('result.finalScore')}</p>
          <div class="result-grid">
            <div><span>${t('result.clearedWaves')}</span><b>${stats.clearedWave ?? stats.wave}</b></div>
            <div><span>${t('result.kills')}</span><b>${fmt(stats.kills)}</b></div>
            <div><span>${t('result.goldLeft')}</span><b>${iconSvg('gold', 'icon-inline')}${fmt(Math.floor(stats.gold))}</b></div>
            <div><span>${t('result.baseHp')}</span><b>${Math.max(0, Math.ceil(stats.baseHp))}</b></div>
            <div><span>${t('result.cores')}</span><b>${iconSvg('cores', 'icon-inline')}${fmt(cores)}</b></div>
            ${rank ? `<div><span>${t('result.leaderboard')}</span><b>#${rank}</b></div>` : ''}
            <div><span>${t('result.personalBest')}</span><b>${personalBest ? t('result.newRecord') : t('result.none')}</b></div>
          </div>
          ${extra}
          ${res ? '' : `<p class="muted warn">${t('result.uploadFailed')}</p>`}
          <div class="modal-actions">
            <button class="btn primary" id="btn-again">${t('result.again')}</button>
            <button class="btn ghost" id="btn-home">${t('result.home')}</button>
          </div>
        </div>
      `,
      { className: 'result-modal', closable: false }
    );

    modal.querySelector('#btn-again').onclick = () => this.handlers.onRestart?.(mode, difficulty);
    modal.querySelector('#btn-home').onclick = () => this.handlers.onHome?.();
  }

  showLeaderboard({ mode = 'normal', entries = [], day = '' }) {
    const rows = entries.length
      ? entries
          .map((entry, index) => {
            const diff = DIFFICULTIES[entry.difficulty] || DIFFICULTIES.standard;
            return `
              <div class="board-row">
                <span class="rank ${index < 3 ? 'top' : ''}">${index + 1}</span>
                <span class="board-name">
                  ${escapeHtml(entry.name)}
                  ${entry.victory ? `<em class="win-mark" title="${t('board.cleared')}">${iconSvg('victory')}</em>` : ''}
                  <span class="board-diff" style="color:${diff.color}">${diffName(diff)}</span>
                </span>
                <span class="board-wave">${t('board.wave', { n: entry.wave })}</span>
                <span class="board-score">${fmt(entry.score)}</span>
              </div>`;
          })
          .join('')
      : `<p class="empty">${t('board.empty')}</p>`;

    const modal = this.openModal(
      `
        <div class="board">
          <p class="eyebrow">${t('board.eyebrow')}</p>
          <h2>${t('board.title')}</h2>
          <div class="tabs">
            <button class="tab ${mode === 'normal' ? 'active' : ''}" data-mode="normal">${t('board.normal')}</button>
            <button class="tab ${mode === 'daily' ? 'active' : ''}" data-mode="daily">${t('board.daily')}${day ? ` · ${day.slice(5)}` : ''}</button>
            <button class="tab ${mode === 'endless' ? 'active' : ''}" data-mode="endless">${t('board.endless')}</button>
          </div>
          <div class="board-list">${rows}</div>
          <div class="modal-actions">
            <button class="btn ghost" id="btn-close-board">${t('common.close')}</button>
          </div>
        </div>
      `,
      { className: 'board-modal', closable: true }
    );

    modal.querySelectorAll('.tab').forEach((tab) => {
      tab.onclick = () => this.handlers.onBoard?.(tab.dataset.mode);
    });
    modal.querySelector('#btn-close-board').onclick = () => this.closeModal();
  }

  showUnlocks(profile) {
    this.profile = profile;
    const cores = profile?.cores || 0;
    const owned = profile?.unlocks || [];
    const rows = UNLOCKS.map((unlock) => {
      const isOwned = owned.includes(unlock.id);
      const affordable = cores >= unlock.cost;
      return `
        <div class="unlock-row ${isOwned ? 'owned' : ''}">
          <div class="unlock-info">
            <b>${unlock.name}</b>
            <p>${unlock.desc}</p>
          </div>
          <button class="btn small ${isOwned ? 'ghost' : 'primary'}" data-id="${unlock.id}"
            ${isOwned || !affordable ? 'disabled' : ''}>
            ${isOwned ? t('unlocks.owned') : `${iconSvg('cores', 'icon-inline')}${unlock.cost}`}
          </button>
        </div>`;
    }).join('');

    const modal = this.openModal(
      `
        <div class="unlocks">
          <p class="eyebrow">${t('unlocks.eyebrow')}</p>
          <h2>${t('unlocks.title')} <span class="cores-inline">${iconSvg('cores', 'icon-inline')}${fmt(cores)}</span></h2>
          <p class="muted">${t('unlocks.note')}</p>
          <div class="unlock-list">${rows}</div>
          <div class="modal-actions">
            <button class="btn ghost" id="btn-close-unlocks">${t('common.close')}</button>
          </div>
        </div>
      `,
      { className: 'unlock-modal', closable: true }
    );

    modal.querySelectorAll('.unlock-row button[data-id]').forEach((button) => {
      button.onclick = () => this.handlers.onBuyUnlock?.(button.dataset.id);
    });
    modal.querySelector('#btn-close-unlocks').onclick = () => this.closeModal();
  }

  showRelicsModal() {
    const relics = this.game?.relics || [];
    const hud = this.game?.getHud?.() || {};
    const preview = hud.phase === 'prep' ? hud.nextWave : null;
    const rows = relics.length
      ? relics
          .map((state) => {
            const relic = RELIC_BY_ID[state.id];
            if (!relic) return '';
            const level = Math.min(3, Math.max(1, state.level || 1));
            const rarity = RARITY[relic.rarity];
            return `
              <div class="relic-modal-row">
                <b style="color:${rarity.color}">${relic.name} ${RELIC_LEVEL_LABELS[level - 1]}</b>
                <span>${relicEffectText(state.id, level)}</span>
              </div>`;
          })
          .join('')
      : `<p class="empty">${t('relicsModal.none')}</p>`;

    const waveBlock = preview
      ? `
          <p class="eyebrow">${t('relicsModal.nextWave')}</p>
          <h2>${t('hud.nextWave')} <span class="cores-inline">${t('relicsModal.enemies', { n: preview.totalCount })}</span></h2>
          <div class="relic-modal-list">
            ${[...preview.enemies]
              .sort((a, b) => b.count - a.count)
              .map(({ type, count }) => {
                const def = ENEMIES[type] || { id: type, name: type, color: '#9fb0c3' };
                return `<div class="next-wave-row"><i style="--c:${def.color}"></i>${enemyName(def)}<b>×${count}</b></div>`;
              })
              .join('')}
          </div>`
      : '';

    const modal = this.openModal(
      `
        <div class="relics-modal">
          ${waveBlock}
          <p class="eyebrow">RELICS</p>
          <h2>${t('relicsModal.title')} <span class="cores-inline">${relics.length}</span></h2>
          <div class="relic-modal-list">${rows}</div>
          <div class="modal-actions">
            <button class="btn ghost" id="btn-close-relics">${t('common.close')}</button>
          </div>
        </div>
      `,
      { className: 'relics-modal', closable: true }
    );
    modal.querySelector('#btn-close-relics').onclick = () => this.closeModal();
  }

  showHelp() {
    this.openModal(
      `
        <div class="help">
          <p class="eyebrow">${t('help.eyebrow')}</p>
          <h2>${t('help.title')}</h2>
          <div class="help-section">
            <h3>${t('help.coreTitle')}</h3>
            <p>${t('help.coreBody')}</p>
          </div>
          <div class="help-section">
            <h3>${t('help.resourceTitle')}</h3>
            <p>${t('help.resourceBody')}</p>
          </div>
          <div class="help-section">
            <h3>${t('help.tacticTitle')}</h3>
            <p>${t('help.tacticBody')}</p>
          </div>
          <div class="help-section">
            <h3>${t('help.keysTitle')}</h3>
            <p>${t('help.keysBody')}</p>
          </div>
          <div class="help-section">
            <h3>${t('help.dailyTitle')}</h3>
            <p>${t('help.dailyBody')}</p>
          </div>
          <div class="modal-actions">
            <button class="btn ghost" id="btn-close-help">${t('help.close')}</button>
          </div>
        </div>
      `,
      { className: 'help-modal', closable: true }
    );
    this.el.modalRoot.querySelector('#btn-close-help').onclick = () => this.closeModal();
  }

  showConfirm({ title, text, confirmText = null, danger = false, onConfirm }) {
    const modal = this.openModal(
      `
        <div class="confirm">
          <h2>${title}</h2>
          <p>${text}</p>
          <div class="modal-actions">
            <button class="btn ${danger ? 'danger' : 'primary'}" id="btn-confirm-yes">${confirmText ?? t('common.confirm')}</button>
            <button class="btn ghost" id="btn-confirm-no">${t('common.cancel')}</button>
          </div>
        </div>
      `,
      { className: 'confirm-modal', closable: true }
    );
    modal.querySelector('#btn-confirm-yes').onclick = () => {
      this.closeModal();
      onConfirm?.();
    };
    modal.querySelector('#btn-confirm-no').onclick = () => this.closeModal();
  }

  promptName(current, onSave) {
    const modal = this.openModal(
      `
        <div class="confirm">
          <h2>${t('prompt.title')}</h2>
          <p class="muted">${t('prompt.note')}</p>
          <input id="name-input" class="text-input" maxlength="16" value="${escapeHtml(current || '')}" />
          <div class="modal-actions">
            <button class="btn primary" id="btn-name-save">${t('common.save')}</button>
            <button class="btn ghost" id="btn-name-cancel">${t('common.cancel')}</button>
          </div>
        </div>
      `,
      { className: 'confirm-modal', closable: true }
    );
    const input = modal.querySelector('#name-input');
    input.focus();
    input.select();
    const save = () => {
      const value = input.value.trim();
      if (!value) return;
      this.closeModal();
      onSave?.(value);
    };
    modal.querySelector('#btn-name-save').onclick = save;
    modal.querySelector('#btn-name-cancel').onclick = () => this.closeModal();
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') save();
    });
  }

  toast(message, duration = 1900) {
    if (!this.el?.toast) return;
    clearTimeout(this._toastTimer);
    this.el.toast.textContent = message;
    this.el.toast.hidden = false;
    requestAnimationFrame(() => this.el.toast.classList.add('show'));
    this._toastTimer = setTimeout(() => {
      this.el.toast.classList.remove('show');
      setTimeout(() => {
        this.el.toast.hidden = true;
      }, 260);
    }, duration);
  }
}

function mapPreviewSvg(map) {
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

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export const ui = new UI();
