// 开局配置页：把「模式 / 携带技能 / 变异 / 难度」合并成单页，替代原来的难度弹窗 + 变异弹窗。
// 页面只负责渲染与本地选择状态；建局仍走既有 handlers（onChooseDifficulty / onChooseMutation），
// 模式页签复用各模式的入口回调，避免在这里复制一份开局参数。
import {
  DIFFICULTIES,
  DIFFICULTY_ORDER,
} from '../shared/data.js';
import { MUTATIONS, MUTATION_MAX, MUTATION_ORDER, mutationScoreMul } from '../shared/mutations.js';
import { weekKey, weeklyChallenge } from '../shared/scoring.js';
import { t, tData } from '../i18n.js';
import { fmt, diffName, diffDesc, modifierName, escapeHtml } from './shared.js';

export const runConfigMethods = {
  // 周规则来自共享派生函数：同一周键与服务端派生同一套种子和词缀。
  showWeeklySelect() {
    this.showDifficultySelect('weekly', {
      weekly: weeklyChallenge(),
      skillState: this._titleExtras?.skillState,
      selectedSkill: this.selectedSkill,
    });
  },

  // ---------- 开局配置页：模式 / 技能 / 变异 / 难度 合并为单页 ----------
  // 六个模式共用同一张配置页：点页签原地切换模式，变异不再是独立弹窗。
  runConfigModes() {
    const dailyLeft = this._titleExtras?.dailyLeft;
    return [
      { id: 'normal', label: () => t('title.play'), hint: null },
      {
        id: 'daily',
        label: () => t('title.daily'),
        hint: dailyLeft == null ? null : t('title.daily.left', { n: dailyLeft }),
        disabled: dailyLeft === 0,
      },
      { id: 'weekly', label: () => t('title.weekly'), hint: weekKey() },
      { id: 'mutated', label: () => t('hudUi.mutationChallenge'), hint: t('title.config.mutatedHint') },
      { id: 'endless', label: () => t('title.endless'), hint: t('title.endless.tag') },
      { id: 'tower', label: () => t('title.tower'), hint: t('title.tower.tag') },
    ];
  },

  // 页签切换复用既有入口回调：每日次数用尽时由 onDaily 统一 toast，不在这里重复判定。
  enterRunConfigMode(mode) {
    const handlers = this.handlers || {};
    const enter = {
      normal: () => handlers.onPlay?.(),
      daily: () => handlers.onDaily?.(),
      weekly: () => (handlers.onWeekly ? handlers.onWeekly() : this.showWeeklySelect()),
      mutated: () => (handlers.onMutation ? handlers.onMutation() : this.showMutationSelect()),
      endless: () => handlers.onEndless?.(),
      tower: () => handlers.onTower?.(),
    }[mode];
    enter?.();
  },

  modeTabsHtml(mode) {
    return `
      <div class="run-config-tabs" role="tablist" aria-label="${escapeHtml(t('title.config.mode'))}">
        ${this.runConfigModes()
          .map((item) => `
            <button class="run-config-tab ${item.id === mode ? 'active' : ''}" type="button"
              role="tab" aria-selected="${item.id === mode}" data-mode="${item.id}"
              ${item.disabled ? 'disabled' : ''}>
              <b>${escapeHtml(item.label())}</b>
              ${item.hint ? `<span>${escapeHtml(item.hint)}</span>` : ''}
            </button>`)
          .join('')}
      </div>`;
  },

  mutationSectionHtml(chosen) {
    const cards = MUTATION_ORDER.map((id) => {
      const def = MUTATIONS[id];
      const on = chosen.has(id);
      const name = tData('mutation', id, 'name', def.name);
      const desc = tData('mutation', id, 'desc', def.desc);
      return `
        <button class="diff-card" type="button" data-mutation="${id}" aria-pressed="${on}"
          style="--diff:#c58cff${on ? ';border-color:#c58cff' : ''}">
          <span class="diff-name">${escapeHtml(name)}</span>
          <p>${escapeHtml(desc)}</p>
          <div class="diff-mods"><span>${t('title.scoreMul', { mul: def.scoreMul.toFixed(2) })}</span></div>
        </button>`;
    }).join('');
    return `
      <section class="config-section" data-mutation-section>
        <h3 class="config-section-title">${escapeHtml(t('title.config.mutations'))}</h3>
        <p class="muted" id="mutation-summary"></p>
        <div class="diff-cards" data-mutation-cards>${cards}</div>
      </section>`;
  },

  showDifficultySelect(
    mode = 'normal',
    { dailyLeft = null, daily = null, weekly = null, skillState = null, selectedSkill = null } = {}
  ) {
    this._fixedMode = mode === 'daily' || mode === 'weekly';
    const mutated = mode === 'mutated';
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
    const towerMode = mode === 'tower';
    const title = towerMode ? t('difficulty.towerTitle')
      : weeklyMode ? t('difficulty.weeklyTitle')
        : mode === 'daily' ? t('difficulty.dailyTitle')
          : endless ? t('difficulty.endlessTitle')
            : mutated ? t('title.mutationTitle', { max: MUTATION_MAX }) : t('difficulty.startTitle');
    const affixes = ((weeklyMode ? weekly?.modifiers : daily?.modifiers) || [])
      .map((modifier) => `<span style="color:${modifier.color}">${modifierName(modifier)}</span>`)
      .join(' · ');
    const streakNote = daily?.streak > 0 ? t('difficulty.streak', { n: daily.streak }) : '';
    const note = towerMode
      ? `<p class="muted">${t('difficulty.towerNote')}</p>`
      : weeklyMode
        ? `<p class="muted">${t('difficulty.weeklyNote', { week: weekly?.week || weekKey() })}</p>
           ${affixes ? `<p class="muted">${t('difficulty.weeklyAffixes', { affixes })}</p>` : ''}`
        : mode === 'daily'
          ? `<p class="muted">${t('difficulty.dailyNote', { n: dailyLeft ?? 0 })}</p>
             ${affixes ? `<p class="muted">${t('difficulty.dailyAffixes', { affixes })}${streakNote}</p>` : ''}`
          : endless
            ? `<p class="muted">${t('difficulty.endlessNote')}</p>`
            : mutated
              ? `<p class="muted">${t('title.mutationNote')}</p>`
              : `<p class="muted">${t('difficulty.note')}</p>`;
    const eyebrow = towerMode ? t('difficulty.eyebrowTower')
      : weeklyMode ? t('difficulty.eyebrowWeekly')
        : mode === 'daily' ? t('difficulty.eyebrowDaily')
          : endless ? t('difficulty.eyebrowEndless')
            : mutated ? t('difficulty.eyebrowMutation') : t('difficulty.eyebrowNormal');

    const chosen = new Set(this._mutationSelection || []);

    const modal = this.openModal(
      `<div class="difficulty run-config">
        <p class="eyebrow">${eyebrow}</p>
        <div class="run-config-head">
          <h2>${escapeHtml(t('title.config.title'))}</h2>
          <span class="run-config-mode">${escapeHtml(title)}</span>
        </div>
        ${this.modeTabsHtml(mode)}
        ${note}
        ${mutated ? this.mutationSectionHtml(chosen) : ''}
        <section class="config-section">
          <h3 class="config-section-title">${escapeHtml(t('title.config.skill'))}</h3>
          ${this.skillBarHtml(skillState, selectedSkill)}
        </section>
        <section class="config-section">
          <h3 class="config-section-title">${escapeHtml(t('title.config.difficulty'))}</h3>
          <div class="diff-cards">${cards}</div>
        </section>
        <div class="modal-actions">
          <button class="btn ghost" id="btn-cancel-diff">${t('difficulty.cancel')}</button>
        </div>
      </div>`,
      { className: 'difficulty-modal', closable: true }
    );

    modal.querySelectorAll('.run-config-tab').forEach((tab) => {
      tab.onclick = () => this.enterRunConfigMode(tab.dataset.mode);
    });

    if (mutated) {
      this.bindMutationSection(modal, chosen);
    }

    // 难度卡是「出发」：普通/每日/本周/无尽/爬塔直接建局；变异模式要求先选至少一个变异。
    modal.querySelectorAll('.diff-card[data-id]').forEach((card) => {
      card.onclick = () => {
        if (mutated) {
          if (chosen.size < 1) {
            this.toast(t('title.mutationRequired'), 2200);
            return;
          }
          this._mutationSelection = [...chosen].sort();
          this.handlers.onChooseMutation?.(card.dataset.id, this._mutationSelection);
          return;
        }
        this.handlers.onChooseDifficulty?.(mode, card.dataset.id);
      };
    });
    this.bindSkillChips(modal);
    modal.querySelector('#btn-cancel-diff').onclick = () => this.closeModal();
  },

  // 变异多选：与难度卡同一张配置页，选中状态只改本页，不重开弹窗。
  bindMutationSection(modal, chosen) {
    const summary = modal.querySelector('#mutation-summary');
    const refresh = () => {
      const ids = [...chosen].sort();
      const mul = mutationScoreMul(ids);
      summary.textContent = ids.length
        ? t('title.mutationSelected', { count: ids.length, max: MUTATION_MAX, mul: mul.toFixed(2) })
        : t('title.mutationLimit', { max: MUTATION_MAX });
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
          this.toast(t('title.mutationLimit', { max: MUTATION_MAX }), 2200);
          return;
        } else {
          chosen.add(id);
        }
        refresh();
      };
    });
  },

  // 变异挑战：与难度/技能共用同一张开局配置页（title.config），不再单独开弹窗。
  showMutationSelect({ skillState = null, selectedSkill = null } = {}) {
    this.showDifficultySelect('mutated', { skillState, selectedSkill });
  },
};
