// 技能养成接口：解锁/等级/选择/升级费用；数值全部走共享 data.js，服务端不复制。
import { actionRateLimited, hashIp, recordRateLimitFailure } from '../auth/rate-limit.mjs';
import { getCores } from '../db.mjs';
import { unlockAchievements } from '../db/achievements.mjs';
import { recordPlayerEvent } from '../db/events.mjs';
import {
  MAX_SKILL_LEVEL,
  readSelectedSkill,
  readSkillLevels,
  setSelectedSkill,
  skillUnlocked,
  upgradeSkillLevel,
} from '../db/skills.mjs';
import {
  SKILLS,
  SKILL_ORDER,
  skillStats,
  skillUnlockText,
  skillUpgradeCost,
} from '../../public/js/shared/data.js';

const FAILURE = {
  INVALID_SKILL: [400, '未知技能'],
  SKILL_LOCKED: [403, '技能尚未解锁'],
  INSUFFICIENT_CORES: [400, '星核不足'],
  MAX_LEVEL: [409, '技能已满级'],
  LEVEL_CONFLICT: [409, '技能等级已变化，请刷新后重试'],
};

export class SkillRoutes {
  register(router) {
    router.add('GET', '/api/skills', (ctx) => this.list(ctx));
    router.add('POST', '/api/skills/upgrade', (ctx) => this.upgrade(ctx));
    router.add('POST', '/api/skills/select', (ctx) => this.select(ctx));
  }

  // 统一视图：钱包 + 每个技能的解锁/等级/下一级费用/服务端计算后的数值。
  snapshot(accountId) {
    const cores = getCores(accountId);
    const levels = readSkillLevels(accountId);
    const skills = SKILL_ORDER.map((id) => {
      const def = SKILLS[id];
      const unlocked = skillUnlocked(accountId, id);
      const level = levels[id];
      const nextCost = skillUpgradeCost(level);
      return {
        id,
        name: def.name,
        role: def.role,
        color: def.color,
        unlocked,
        level,
        nextCost,
        canUpgrade: unlocked && nextCost != null && level < MAX_SKILL_LEVEL && cores >= nextCost,
        unlockHint: skillUnlockText(id),
        stats: skillStats(id, level),
      };
    });
    return { wallet: { cores }, selected: readSelectedSkill(accountId), skills };
  }

  // 成就判定是附加反馈：失败只吞掉，绝不影响技能接口本身。
  unlockSkillAchievements(accountId) {
    try {
      return unlockAchievements(accountId);
    } catch {
      return [];
    }
  }

  failCode(ctx, code) {
    const [status, message] = FAILURE[code] || [400, '请求无效'];
    return ctx.fail(status, message, code);
  }

  // 升级失败按账号/IP 计入独立分桶；成功与读取不受影响。
  upgradeFailure(ctx, code) {
    recordRateLimitFailure('skill-upgrade', {
      accountId: ctx.token,
      ipHash: hashIp(ctx.req),
      userAgent: ctx.req.headers['user-agent'] || null,
    });
    return this.failCode(ctx, code);
  }

  rateLimited(ctx, limit) {
    ctx.res.setHeader('Retry-After', String(limit.retryAfterSeconds));
    return ctx.fail(429, '操作过于频繁，请稍后再试', 'RATE_LIMITED');
  }

  list(ctx) {
    return ctx.json(200, this.snapshot(ctx.token));
  }

  async upgrade(ctx) {
    const token = ctx.token;
    const limit = actionRateLimited('skill-upgrade', {
      accountId: token,
      ipHash: hashIp(ctx.req),
    });
    if (limit.limited) return this.rateLimited(ctx, limit);

    const body = await ctx.readJson();
    const skillId = String(body.skillId || '');
    if (!SKILLS[skillId]) return this.upgradeFailure(ctx, 'INVALID_SKILL');
    if (!skillUnlocked(token, skillId)) return this.upgradeFailure(ctx, 'SKILL_LOCKED');

    let expectedLevel = null;
    if (body.expectedLevel != null && body.expectedLevel !== '') {
      expectedLevel = Math.floor(Number(body.expectedLevel));
      if (!Number.isFinite(expectedLevel)) return this.upgradeFailure(ctx, 'LEVEL_CONFLICT');
    }

    const result = upgradeSkillLevel(token, skillId, expectedLevel);
    if (!result.ok) return this.upgradeFailure(ctx, result.status);

    recordPlayerEvent(token, 'skill_upgraded', {
      skillId,
      from: result.from,
      to: result.to,
      cost: result.cost,
    });

    const unlockedAchievements = this.unlockSkillAchievements(token);

    return ctx.json(200, {
      ...this.snapshot(token),
      upgraded: { skillId, from: result.from, to: result.to, cost: result.cost },
      unlockedAchievements,
    });
  }

  async select(ctx) {
    const token = ctx.token;
    const body = await ctx.readJson();
    const skillId = String(body.skillId || '');
    if (!SKILLS[skillId]) return this.failCode(ctx, 'INVALID_SKILL');
    if (!skillUnlocked(token, skillId)) return this.failCode(ctx, 'SKILL_LOCKED');
    setSelectedSkill(token, skillId);
    recordPlayerEvent(token, 'skill_selected', { skillId });
    this.unlockSkillAchievements(token);
    return ctx.json(200, { selected: skillId });
  }
}
