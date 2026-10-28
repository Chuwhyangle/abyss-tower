// 成就条件求值：在定义表（achievements-data.js）之上做进度换算与整轮扫描。
// 纯函数、不读取模拟/渲染等运行时状态，服务端与测试都从这里取判定入口。
import { ACHIEVEMENTS } from './achievements-data.js';

// 返回 { current, target }；非进度型成就返回 null。current 不超过 target，便于直接画进度条。
export function achievementProgress(achievement, ctx) {
  if (!achievement || !achievement.target || typeof achievement.progress !== 'function') {
    return null;
  }
  const raw = Number(achievement.progress(ctx));
  const current = Math.max(
    0,
    Math.min(achievement.target, Math.floor(Number.isFinite(raw) ? raw : 0))
  );
  return { current, target: achievement.target };
}

// 反复扫描直到不再有新成就，保证「解锁 10 个成就」这类组合成就能在同一次结算内成立。
export function evaluateAchievements(ctx) {
  const unlocked = new Set(ctx.unlocked || []);
  const added = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const achievement of ACHIEVEMENTS) {
      if (unlocked.has(achievement.id)) continue;
      if (achievement.check({ ...ctx, unlocked })) {
        unlocked.add(achievement.id);
        added.push(achievement.id);
        changed = true;
      }
    }
  }
  return added;
}
