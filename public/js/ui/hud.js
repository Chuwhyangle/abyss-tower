// HUD 与战场外壳：状态栏、技能按钮、入口提示、首领横幅、音效与转场。
import { DIFFICULTIES, ENEMIES, MAX_WAVE, SKILLS, skillStats } from '../shared/data.js';
import { t, tOr } from '../i18n.js';
import { audio } from '../audio.js';
import { iconSvg } from '../render/canvas-shapes.js';
import { fmt, diffName, enemyName, escapeHtml } from './shared.js';

export const hudMethods = {
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
  },

  bindClickSound() {
    document.addEventListener('click', (event) => {
      if (event.target.closest('button')) audio.play('click');
    });
  },

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
  },

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
  },

  updateSoundIcon() {
    if (!this.el?.sound) return;
    this.el.sound.innerHTML = iconSvg(audio.enabled ? 'sound' : 'muted');
    this.el.sound.title = t(audio.enabled ? 'hud.soundOn' : 'hud.soundOff');
  },

  setResumeAvailable(available) {
    if (this.el.resume) this.el.resume.hidden = !available;
  },

  // 轻量转场：先移除再强制回流，保证同一视图连续进入时也能重播。
  playViewEnter(target) {
    if (!target?.classList) return;
    target.classList.remove('view-enter');
    void target.offsetWidth;
    target.classList.add('view-enter');
  },

  // 首领预警横幅：每波只播一次，1.5s 后自动收起；pointer-events 交给 CSS 关闭。
  showBossBanner(wave, waveDef) {
    if (!this.el?.game || this._bossBannerWave === wave) return;
    this._bossBannerWave = wave;
    const label = waveDef?.finalBoss ? t('hud.state.finalBoss') : t('hud.state.boss');
    const text = label.replace(/^[^\p{L}\p{N}]+/u, '');
    let banner = this.el.bossBanner;
    if (!banner) {
      banner = document.createElement('div');
      banner.setAttribute('role', 'status');
      banner.setAttribute('aria-live', 'polite');
      this.el.game.appendChild(banner);
      this.el.bossBanner = banner;
    }
    banner.textContent = text;
    banner.classList.remove('boss-banner');
    void banner.offsetWidth;
    banner.classList.add('boss-banner');
    clearTimeout(this._bossBannerTimer);
    this._bossBannerTimer = setTimeout(() => {
      banner.classList.remove('boss-banner');
      this._bossBannerTimer = null;
    }, 1500);
  },

  hideBossBanner() {
    clearTimeout(this._bossBannerTimer);
    this._bossBannerTimer = null;
    if (this.el?.bossBanner) this.el.bossBanner.classList.remove('boss-banner');
  },

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
      if (hud.waveDef?.boss || hud.waveDef?.finalBoss) {
        this.showBossBanner(hud.wave, hud.waveDef);
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
  },

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
  },

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
  },

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
  },
};
