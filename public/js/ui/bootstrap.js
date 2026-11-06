// UI 面板统一入口：ui.js 只动态装载这一份清单，index.html 不再逐个挂载面板 script。
// 每个面板模块在自身作用域 registerPanel；这里按固定顺序并行 import、再统一挂载。
// 动态 import 的完成顺序不确定，所以挂载顺序用清单里的 id 显式给出。
import { mountPanels } from './registry.js';

const PANEL_MODULES = [
  { id: 'notifications', load: () => import('./notifications.js') },
  { id: 'season-pass', load: () => import('./season-pass.js') },
  { id: 'meta-tree', load: () => import('./meta-tree.js') },
  { id: 'achievements', load: () => import('../achievements-ui.js') },
  { id: 'bounties', load: () => import('../bounties-ui.js') },
  { id: 'cosmetics', load: () => import('../cosmetics-ui.js') },
  { id: 'stats', load: () => import('../stats-ui.js') },
  { id: 'leaderboard', load: () => import('../leaderboard-ui.js') },
  { id: 'season', load: () => import('../season-ui.js') },
  { id: 'relic-codex', load: () => import('../relic-codex-ui.js') },
  { id: 'daily-history', load: () => import('../daily-history-ui.js') },
  { id: 'share', load: () => import('../share-ui.js') },
  { id: 'replay', load: () => import('../replay-ui.js') },
];

let started = false;

// ui.js 在单例创建后调用一次；重复调用无副作用（面板注册表自身也只挂载一次）。
export function bootstrapPanels(context = {}) {
  if (started) return;
  started = true;
  const loads = PANEL_MODULES.map(({ id, load }) =>
    load().catch((error) => console.error('[ui] panel load failed', id, error))
  );
  Promise.all(loads).then(() => mountPanels(context, PANEL_MODULES.map(({ id }) => id)));
}
