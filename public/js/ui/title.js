// 标题页与开局选择：技能卡、技能条、难度 / 变异弹窗。
import {
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  SKILLS,
  SKILL_ORDER,
  skillStats,
  skillUpgradeCost,
  skillUnlockText,
  isSkillUnlocked,
} from '../shared/data.js';
import { MUTATIONS, MUTATION_MAX, MUTATION_ORDER, mutationScoreMul } from '../shared/mutations.js';
import { weekKey } from '../shared/scoring.js';
import { t } from '../i18n.js';
import { iconSvg } from '../render/canvas-shapes.js';
import {
  fmt,
  ROMAN,
  diffName,
  diffDesc,
  modifierName,
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
      .map((modifier) => `<span style="color:${modifier.color}">${modifierName(modifier)}</span>`)
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
  },

  // 变异挑战面板：复用难度弹窗结构，变异多选 + 难度单选。
  showMutationSelect({ skillState = null, selectedSkill = null } = {}) {
    this._fixedMode = false;
    const chosen = new Set(this._mutationSelection || []);
    const mutationCards = MUTATION_ORDER.map((id) => {
      const def = MUTATIONS[id];
      const on = chosen.has(id);
      return `
        <button class="diff-card" type="button" data-mutation="${id}" aria-pressed="${on}"
          style="--diff:#c58cff${on ? ';border-color:#c58cff' : ''}">
          <span class="diff-name">${escapeHtml(def.name)}</span>
          <p>${escapeHtml(def.desc)}</p>
          <div class="diff-mods"><span>分数 ×${def.scoreMul.toFixed(2)}</span></div>
        </button>`;
    }).join('');
    const diffCards = DIFFICULTY_ORDER.map((id) => {
      const diff = DIFFICULTIES[id];
      return `
        <button class="diff-card" type="button" data-diff="${id}" style="--diff:${diff.color}">
          <span class="diff-name">${diffName(diff)}</span>
          <p>${diffDesc(diff)}</p>
          <div class="diff-mods">
            <span>${t('difficulty.hp', { mul: diff.hpMul.toFixed(2) })}</span>
            <span>${t('difficulty.count', { mul: diff.countMul.toFixed(2) })}</span>
            <span>${t('difficulty.score', { mul: diff.scoreMul.toFixed(2) })}</span>
          </div>
        </button>`;
    }).join('');

    const modal = this.openModal(
      `<div class="difficulty">
        <p class="eyebrow">SELF TRANSCENDENCE</p>
        <h2>变异挑战 · 选择变异（1–${MUTATION_MAX}）</h2>
        <p class="muted">变异会同时提高最终分数倍率；同一组变异拥有独立榜单。</p>
        ${this.skillBarHtml(skillState, selectedSkill)}
        <div class="diff-cards" data-mutation-cards>${mutationCards}</div>
        <p class="muted" id="mutation-summary"></p>
        <h2>${t('difficulty.title')}</h2>
        <div class="diff-cards">${diffCards}</div>
        <div class="modal-actions">
          <button class="btn ghost" id="btn-cancel-mutation">${t('difficulty.cancel')}</button>
        </div>
      </div>`,
      { className: 'difficulty-modal', closable: true }
    );

    const summary = modal.querySelector('#mutation-summary');
    const refresh = () => {
      const ids = [...chosen].sort();
      const mul = mutationScoreMul(ids);
      summary.textContent = ids.length
        ? `已选 ${ids.length}/${MUTATION_MAX} · 分数 ×${mul.toFixed(2)}`
        : `最多选择 ${MUTATION_MAX} 个变异`;
      modal.querySelectorAll('[data-mutation]').forEach((card) => {
        const on = chosen.has(card.dataset.mutation);
        card.setAttribute('aria-pressed', String(on));
        card.style.borderColor = on ? '#c58cff' : '';
      });
    };
    refresh();

    modal.querySelectorAll('[data-mutation]').forEach((card) => {
      card.onclick = () => {
        const id = card.dataset.mutation;
        if (chosen.has(id)) {
          chosen.delete(id);
        } else if (chosen.size >= MUTATION_MAX) {
          this.toast(`最多选择 ${MUTATION_MAX} 个变异`, 2200);
          return;
        } else {
          chosen.add(id);
        }
        refresh();
      };
    });

    modal.querySelectorAll('[data-diff]').forEach((card) => {
      card.onclick = () => {
        if (chosen.size < 1) {
          this.toast('请先选择至少一个变异', 2200);
          return;
        }
        this._mutationSelection = [...chosen].sort();
        this.handlers.onChooseMutation?.(card.dataset.diff, this._mutationSelection);
      };
    });
    this.bindSkillChips(modal);
    modal.querySelector('#btn-cancel-mutation').onclick = () => this.closeModal();
  },
};
