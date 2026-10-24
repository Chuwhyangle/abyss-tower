// 结算页：胜败结局、分数滚动、星核与解锁展示。
import { DIFFICULTIES, SKILLS } from '../shared/data.js';
import { ACHIEVEMENT_BY_ID, ACHIEVEMENT_RARITIES } from '../shared/achievements.js';
import { MUTATIONS } from '../shared/mutations.js';
import { t } from '../i18n.js';
import { audio } from '../audio.js';
import { iconSvg } from '../render/canvas-shapes.js';
import { buildShareCardData, downloadShareCard } from '../share-card.js';
import { fmt, diffName, skillName, escapeHtml } from './shared.js';

// 结算分数滚动时长；与结算入场动效一起保持在 600ms 以内。
const RESULT_SCORE_DURATION = 600;

// 结算分数格式化：非法或缺失分数按 0 展示，静态展示与滚动动画共用（纯函数）。
export function formatResultScore(value) {
  return fmt(Number(value) || 0);
}

// 最佳波次：取历史最佳与本局波次的较大值，非法值按 0 处理（纯函数）。
export function resultBestWave(profileBest, stats) {
  return Math.max(Number(profileBest) || 0, Number(stats?.clearedWave ?? stats?.wave) || 0);
}

// 结算音效走 sfx 总线，静音由音频层统一判断；音频异常时只跳过声音，不阻塞结算展示。
function playResultSound(victory) {
  try {
    audio.play(victory ? 'resultVictory' : 'resultDefeat');
  } catch {
    /* 音效失败不影响结算 */
  }
}

export const resultMethods = {
  showResult({ stats, res, mode, dailyLeft }) {
    audio.stopMusic();
    this.hideBossBanner();
    const victory = res?.victory ?? stats.victory ?? false;
    const difficulty = res?.difficulty || stats.difficulty || 'standard';
    const diff = DIFFICULTIES[difficulty] || DIFFICULTIES.standard;
    const score = res?.score ?? stats.score;
    const cores = res ? res.coresEarned : 0;
    const rank = res?.rank;
    const personalBest = res?.personalBest;
    const mutationNames = (res?.mutations?.ids || [])
      .map((id) => MUTATIONS[id]?.name || id)
      .join(' · ');
    const extra =
      mode === 'daily' && dailyLeft != null
        ? `<p class="muted">${t('result.dailyLeft', { n: dailyLeft })}</p>`
        : mode === 'endless'
          ? `<p class="muted">${t('result.endlessNote')}</p>`
          : mode === 'mutated'
            ? `<p class="muted">变异挑战${mutationNames ? ` · ${escapeHtml(mutationNames)}` : ''}</p>`
            : '';

    const diffTag = victory
      ? t('result.clearedTag', { name: diffName(diff) })
      : t('result.difficultyTag', { name: diffName(diff) });

    const bestWave = resultBestWave(this.profile?.stats?.byDifficulty?.[difficulty]?.bestWave, stats);

    // 结算页只展示本局真正产出的解锁；没有解锁时整块不渲染。
    const achievementUnlocks = (res?.unlockedAchievements || [])
      .map((id) => ({ id, def: ACHIEVEMENT_BY_ID[id] }))
      .filter((entry) => entry.def?.title);
    const skillUnlocks = (res?.unlockedSkills || []).map((entry) => ({
      id: entry.id,
      name: skillName(SKILLS[entry.id] || entry),
    }));
    const unlockItems = [
      ...achievementUnlocks.map(({ def }) => {
        const rarity = ACHIEVEMENT_RARITIES[def.rarity];
        return `<li class="result-unlock" style="--unlock-color:${rarity?.color || 'var(--gold)'}">
          <span class="result-unlock-kind">${t('result.achievementUnlocked')}</span>
          <b>${escapeHtml(def.title)}</b>
        </li>`;
      }),
      ...skillUnlocks.map(
        (entry) => `<li class="result-unlock" style="--unlock-color:var(--cyan)">
          <span class="result-unlock-kind">${t('result.skillUnlocked')}</span>
          <b>${escapeHtml(entry.name)}</b>
        </li>`
      ),
    ];
    const unlockBlock = unlockItems.length
      ? `<section class="result-unlocks" data-result-unlocks>
          <p class="eyebrow">${t('result.unlocks')}</p>
          <ul>${unlockItems.join('')}</ul>
        </section>`
      : '';

    const modal = this.openModal(
      `
        <div class="result ${victory ? 'victory' : 'defeat'}" data-result="${victory ? 'victory' : 'defeat'}">
          <header class="result-hero">
            <p class="eyebrow">${t(victory ? 'result.victoryTag' : 'result.overTag')}</p>
            <h2>${victory ? t('result.victoryTitle') : t('result.reached', { wave: stats.wave })}</h2>
            <p class="diff-tag" style="color:${diff.color}">${diffTag}</p>
          </header>
          <section class="result-score">
            <div class="score-big" data-score-target="${score}">${formatResultScore(score)}</div>
            <p class="muted">${t('result.finalScore')}</p>
            ${personalBest ? `<p class="result-record" data-result-record>${iconSvg('victory', 'icon-inline')}${t('result.newRecord')}</p>` : ''}
          </section>
          <section class="result-cores" data-result-cores>
            <span class="result-cores-icon">${iconSvg('cores')}</span>
            <div>
              <span>${t('result.cores')}</span>
              <b>${fmt(cores)}</b>
            </div>
          </section>
          <div class="result-grid">
            <div><span>${t('result.clearedWaves')}</span><b>${stats.clearedWave ?? stats.wave}</b></div>
            <div><span>${t('result.bestWave')}</span><b>${bestWave}</b></div>
            <div><span>${t('result.kills')}</span><b>${fmt(stats.kills)}</b></div>
            <div><span>${t('result.goldLeft')}</span><b>${iconSvg('gold', 'icon-inline')}${fmt(Math.floor(stats.gold))}</b></div>
            <div><span>${t('result.baseHp')}</span><b>${Math.max(0, Math.ceil(stats.baseHp))}</b></div>
            ${rank ? `<div><span>${t('result.leaderboard')}</span><b>#${rank}</b></div>` : ''}
            <div><span>${t('result.personalBest')}</span><b>${personalBest ? t('result.newRecord') : t('result.none')}</b></div>
          </div>
          ${unlockBlock}
          ${extra}
          ${res ? '' : `<p class="muted warn">${t('result.uploadFailed')}</p>`}
          <div class="modal-actions">
            <button class="btn primary" id="btn-again">${t('result.again')}</button>
            <button class="btn" id="btn-share-result" data-result-share>${t('result.share')}</button>
            <button class="btn" id="btn-save-card" data-result-card>保存战绩卡片</button>
            <button class="btn ghost" id="btn-home">${t('result.home')}</button>
          </div>
        </div>
      `,
      { className: 'result-modal', closable: false }
    );

    modal.classList.add('result-fade');
    playResultSound(victory);
    this._animateResultScore(modal, Number(score) || 0);

    modal.querySelector('#btn-again').onclick = () => this.handlers.onRestart?.(mode, difficulty);
    modal.querySelector('#btn-home').onclick = () => this.handlers.onHome?.();
    // 分享入口复用 share-ui 已挂载的生成按钮，不复制其请求/编码逻辑。
    modal.querySelector('[data-result-share]').onclick = () => {
      const trigger = modal.querySelector('[data-share-generate]');
      if (!trigger) {
        this.toast(t('result.shareUnavailable'), 2400);
        return;
      }
      trigger.click();
      modal.querySelector('[data-share-result]')?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    };
    // 战绩卡片使用结算数据 + 本局遗物 + 当前分享码；分享码为空时卡片仍可生成。
    modal.querySelector('[data-result-card]').onclick = () => this.saveShareCard(modal, { stats, res, mode });
  },

  async saveShareCard(modal, { stats, res, mode }) {
    const shareCode = modal.querySelector('[data-share-code]')?.textContent || '';
    const relics = (this.game?.relics || []).map((relic) => ({ id: relic.id, level: relic.level }));
    const data = buildShareCardData({ stats, res, mode, relics, shareCode });
    const result = await downloadShareCard(data);
    if (!result.ok) {
      this.toast('当前浏览器无法生成战绩卡片', 2400);
      return;
    }
    this.toast(`已保存 ${result.filename}`, 2400);
  },

  // 分数滚动：系统要求减少动效或环境不支持逐帧时直接显示终值。
  _animateResultScore(modal, target) {
    const node = modal.querySelector('[data-score-target]');
    if (!node) return;
    const reduceMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (reduceMotion || typeof requestAnimationFrame !== 'function') {
      node.textContent = fmt(target);
      return;
    }
    const duration = RESULT_SCORE_DURATION;
    const start = performance.now();
    node.textContent = formatResultScore(0);
    const step = (now) => {
      if (!node.isConnected) return;
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      node.textContent = formatResultScore(Math.round(target * eased));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  },
};
