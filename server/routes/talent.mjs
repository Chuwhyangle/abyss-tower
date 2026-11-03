// 天赋树接口：读取账号天赋与传承材料，花传承之核投入节点；数值/记账全走共享 meta.js 与仓储层。
// 薄路由（unlock.mjs / skills.mjs 模式）：不内联 SQL、不直接操作 db，复用
// readTalent/writeTalent/spendLegacyInTx，材料口径与 run-settlement 结算共用 legacy.mjs。
import { transaction } from '../db.mjs';
import { readTalent, writeTalent } from '../db/accounts.mjs';
import { readLegacy, spendLegacyInTx } from '../db/legacy.mjs';
import { recordPlayerEvent } from '../db/events.mjs';
import {
  TALENT_BY_ID,
  TALENT_NODES,
  investTalent,
  talentMods,
} from '../../public/js/shared/data/meta.js';

const FAILURE = {
  INVALID_NODE: [400, '未知天赋节点'],
  MAXED: [409, '天赋节点已满级'],
  INSUFFICIENT_LEGACY: [400, '传承之核不足'],
};

export class TalentRoutes {
  register(router) {
    router.add('GET', '/api/talent', (ctx) => this.list(ctx));
    router.add('POST', '/api/talent/invest', (ctx) => this.invest(ctx));
  }

  // 统一视图：天赋状态 + 传承材料余额 + 每个节点的等级/满级/可投入，供 meta 树一次性渲染。
  snapshot(accountId) {
    const talent = readTalent(accountId);
    const legacy = readLegacy(accountId);
    const cores = legacy.materials.legacy_core || 0;
    const nodes = TALENT_NODES.map((node) => {
      const rank = talent.nodes[node.id] || 0;
      return {
        id: node.id,
        rank,
        maxed: rank >= node.maxRank,
        cost: node.cost,
        canInvest: rank < node.maxRank && cores >= node.cost,
      };
    });
    return {
      talent,
      legacy,
      wallet: { legacyCores: cores },
      nodes,
      // 已生效的被动（只含 EFFECT_REGISTRY 声明键），供面板展示「当前加成」。
      mods: talentMods(talent),
    };
  }

  failCode(ctx, code) {
    const [status, message] = FAILURE[code] || [400, '请求无效'];
    return ctx.fail(status, message, code);
  }

  list(ctx) {
    return ctx.json(200, this.snapshot(ctx.token));
  }

  async invest(ctx) {
    const token = ctx.token;
    const body = await ctx.readJson();
    const nodeId = String(body.nodeId || '');
    const node = TALENT_BY_ID[nodeId];
    if (!node) return this.failCode(ctx, 'INVALID_NODE');

    const talent = readTalent(token);
    const current = talent.nodes[nodeId] || 0;
    if (current >= node.maxRank) return this.failCode(ctx, 'MAXED');

    const result = transaction(() => {
      // 先扣传承之核：余额不足返回 false 且一行不改，整段回滚，绝不白扣材料。
      if (!spendLegacyInTx(token, node.cost)) return { ok: false };
      // 投入 1 级等价消耗 node.cost 颗传承之核，折算进 points 保持 points >= spent 恒成立。
      const invested = investTalent({ ...talent, points: talent.points + node.cost }, nodeId);
      // 前置校验（非满级 + cost >= 1）已保证这里不可能失败；万一失败抛出回滚，不白扣材料。
      if (!invested.ok) throw new Error(`talent invest failed: ${invested.reason}`);
      return { ok: true, state: writeTalent(token, invested.state) };
    });

    if (!result.ok) return this.failCode(ctx, 'INSUFFICIENT_LEGACY');

    recordPlayerEvent(token, 'talent_invested', {
      nodeId,
      from: current,
      to: current + 1,
      cost: node.cost,
    });

    return ctx.json(200, {
      ...this.snapshot(token),
      invested: { nodeId, from: current, to: current + 1, cost: node.cost },
    });
  }
}
