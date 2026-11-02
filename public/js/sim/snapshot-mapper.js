// 存档与 HUD：快照、整备期落盘、下一波情报与 HUD 视图。
import { MAX_WAVE } from '../shared/data.js';
import { toSnapshot } from '../shared/snapshot.js';
import { generateWave } from '../shared/waves.js';

export class SnapshotMapper {
  constructor(sim) {
    this.sim = sim;
  }

  toSnapshot() {
    return toSnapshot(this.sim);
  }

  save() {
    if (this.sim.phase !== 'prep' || this.sim.clearPending) return;
    this.sim.opts.onSave?.(this.sim.toSnapshot());
  }

  savePreWave() {
    if (this.sim.clearPending) return;
    const snapshot = this.sim.toSnapshot();
    snapshot.preWave = true;
    this.sim.opts.onSave?.(snapshot);
  }

  // 下一波情报：整备阶段展示。波次由种子确定性生成，客户端只做预测展示，
  // 真正放行仍由服务端 /wave 决定，不改变波次流程。
  nextWavePreview() {
    if (this.sim.phase !== 'prep') return null;
    const next = this.sim.clearedWave + 1;
    const endless = this.sim.mode === 'endless';
    if (!endless && next > MAX_WAVE) return null;
    const meta = this.sim.map?.meta || {};
    const key = `${next}|${this.sim.difficulty}|${meta.modifier?.id || ''}|${meta.portalCount || 1}|${meta.hpMul || 1}|${this.sim.mode}`;
    if (this.sim._previewCache?.key === key) return this.sim._previewCache.value;
    const def = generateWave(
      this.sim.seed,
      next,
      this.sim.difficulty,
      {
        portalCount: meta.portalCount || 1,
        modifier: meta.modifier || null,
        hpMul: meta.hpMul || 1,
      },
      { endless }
    );
    const totals = new Map();
    for (const group of def.groups) {
      totals.set(group.type, (totals.get(group.type) || 0) + group.count);
    }
    const value = {
      index: def.index,
      boss: !!def.boss,
      finalBoss: !!def.finalBoss,
      totalCount: def.totalCount,
      portals: def.portals?.length || 1,
      enemies: [...totals.entries()].map(([type, count]) => ({ type, count })),
    };
    this.sim._previewCache = { key, value };
    return value;
  }

  getHud() {
    return {
      gold: Math.floor(this.sim.gold),
      baseHp: Math.max(0, Math.ceil(this.sim.baseHp)),
      maxBaseHp: this.sim.maxBaseHp,
      wave: this.sim.wave,
      clearedWave: this.sim.clearedWave,
      kills: this.sim.kills,
      phase: this.sim.phase,
      paused: this.sim.paused,
      enemies: this.sim.enemies.length,
      relicCount: this.sim.relics.length,
      skill: this.sim.skill
        ? { id: this.sim.skill.id, level: this.sim.skill.level, cooldown: this.sim.skill.cooldown }
        : null,
      difficulty: this.sim.difficulty,
      mode: this.sim.mode,
      portalCount: this.sim.map.spawns?.length || 1,
      activePortals: this.sim.activePortals.slice(),
      nextWave: this.sim.nextWavePreview(),
      waveDef: this.sim.waveDef
        ? {
            index: this.sim.waveDef.index,
            totalCount: this.sim.waveDef.totalCount,
            boss: this.sim.waveDef.boss,
            finalBoss: !!this.sim.waveDef.finalBoss,
          }
        : null,
    };
  }
}
