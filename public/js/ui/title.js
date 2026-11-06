// 标题页：技能卡、技能条与标题场景。开局配置页见 ./run-config.js。
import {
  SKILLS,
  SKILL_ORDER,
  skillStats,
  skillUpgradeCost,
  skillUnlockText,
  isSkillUnlocked,
} from '../shared/data.js';
import { SCENE_SPRITE_PLACEMENT, applySceneSpritesTo, sceneSpriteIds } from '../shared/scene-sprites.js';
import { t } from '../i18n.js';
import { iconSvg } from '../render/canvas-shapes.js';
import { SpritePipeline } from '../render/sprite-pipeline.js';
import {
  ROMAN,
  skillName,
  skillDesc,
  skillRole,
  skillUnlock,
  skillSummary,
  escapeHtml,
} from './shared.js';

export const titleMethods = {
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
  },

  resolveSelectedSkill(entries, preferred = this.selectedSkill) {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    if (preferred && byId.get(preferred)?.unlocked) return preferred;
    return entries.find((entry) => entry.unlocked)?.id || null;
  },

  // 场景精灵：标题 / 选图 / 结算共用一条只读管线（对局前没有 Renderer）。
  sceneSprites() {
    if (!this._menuSprites) {
      this._menuSprites = new SpritePipeline({ dpr: 1 });
      // 预载永不 reject：首帧早于加载完成，有结论后重涂标题（失败也会标回退）。
      this._menuSprites.preload().then(() => {
        if (this.el?.title && !this.el.title.hidden) this.renderTitle();
      });
    }
    return this._menuSprites;
  },
  // 标题场景：背景 + logo；缺资源只加回退标记，不改既有样式。
  applyTitleSceneSprites() {
    if (typeof document === 'undefined' || !this.el?.title) return;
    let layer = this.el.title.querySelector('[data-scene-layer="title"]');
    if (!layer) {
      const style = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0;';
      this.el.title.insertAdjacentHTML('afterbegin', `<div data-scene-layer="title" aria-hidden="true" style="${style}"></div>`);
      layer = this.el.title.firstElementChild;
    }
    layer.innerHTML = (sceneSpriteIds('title') || [])
      .map((id) => `<div class="scene-sprite" data-sprite-id="${id}" style="${SCENE_SPRITE_PLACEMENT[id] || ''}"></div>`)
      .join('');
    applySceneSpritesTo(layer, this.sceneSprites(), 'title');
  },

  renderTitleSkills(profile, extras = {}) {
    this.applyTitleSceneSprites();
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
  },

  // 弹窗打开时选择技能：只更新选中样式，不关闭弹窗。
  updateSkillSelection(skillId) {
    this.selectedSkill = skillId;
    document.querySelectorAll('.skill-chip').forEach((chip) => {
      const on = chip.dataset.skill === skillId;
      chip.classList.toggle('selected', on);
      chip.setAttribute('aria-pressed', String(on));
    });
  },

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
  },

  bindSkillChips(modal) {
    modal.querySelectorAll('.skill-chip').forEach((chip) => {
      chip.onclick = () => {
        if (chip.classList.contains('locked')) return;
        this.selectedSkill = chip.dataset.skill;
        this.handlers.onSelectSkill?.(chip.dataset.skill);
        this.updateSkillSelection(chip.dataset.skill);
      };
    });
  },

};
