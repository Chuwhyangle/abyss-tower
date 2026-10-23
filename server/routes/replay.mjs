// 分享码接口：生成与校验对局回放码；只做内存校验，不持久化对局。
import {
  ReplayError,
  decodeRun,
  encodeRun,
  validateRun,
} from '../../public/js/shared/replay.js';

// 解码/校验错误码 → 玩家文案；错误码本身原样返回给客户端做分支。
const MESSAGES = {
  REPLAY_INVALID_REQUEST: '请提供 code 或 run 之一',
  REPLAY_EMPTY: '分享码为空',
  REPLAY_TOO_LONG: '分享码过长',
  REPLAY_BAD_FORMAT: '分享码格式不正确',
  REPLAY_BAD_CHECKSUM: '分享码校验失败，可能已损坏',
  REPLAY_BAD_PAYLOAD: '分享码内容损坏',
  REPLAY_UNSUPPORTED_VERSION: '分享码版本不受支持',
  REPLAY_UNKNOWN_FIELD: '分享码包含未知字段',
  REPLAY_MALFORMED: '分享码损坏',
  REPLAY_INVALID_RUN: '对局数据无效',
  REPLAY_INVALID_SEED: '对局种子无效',
  REPLAY_INVALID_MAP: '地图选择无效',
  REPLAY_INVALID_DIFFICULTY: '难度无效',
  REPLAY_INVALID_MODE: '模式无效',
  REPLAY_INVALID_RELICS: '遗物数据无效',
  REPLAY_INVALID_EVENTS: '事件数据无效',
};

export class ReplayRoutes {
  register(router) {
    router.add('POST', '/api/replay', (ctx) => this.handle(ctx));
  }

  reject(ctx, code) {
    return ctx.fail(400, MESSAGES[code] || '分享码无效', code);
  }

  async handle(ctx) {
    const body = await ctx.readJson();
    const hasCode = body.code !== undefined && body.code !== null;
    const hasRun = body.run !== undefined && body.run !== null;
    if (hasCode === hasRun) return this.reject(ctx, 'REPLAY_INVALID_REQUEST');

    if (hasCode) {
      const result = decodeRun(body.code);
      if (!result.ok) return this.reject(ctx, result.code);
      return ctx.json(200, { ok: true, run: result.run });
    }

    const validated = validateRun(body.run);
    if (!validated.ok) return this.reject(ctx, validated.code);
    try {
      const code = encodeRun(validated.run);
      return ctx.json(200, { ok: true, code, length: code.length, run: validated.run });
    } catch (error) {
      if (error instanceof ReplayError) return this.reject(ctx, error.code);
      throw error;
    }
  }
}
