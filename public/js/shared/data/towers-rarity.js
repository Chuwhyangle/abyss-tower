// 塔稀有度分级：只负责展示/边框/图鉴分层与抽卡池资格，不参与战斗数值。
// 稀有度与档位由 docs/PHASE_抽卡.md §1 冻结；战斗数值仍由 towers.js 单一职责维护。
// 免费基础塔（arrow/cannon/frost，1★）开局拥有、不进抽卡池。

export const TOWER_RARITY = {
  sniper: { rarity: 'legendary', star: 6, color: '#ffd24a', poolable: true },
  arc:    { rarity: 'epic',      star: 5, color: '#c78bff', poolable: true },
  banner: { rarity: 'rare',      star: 4, color: '#6fb3ff', poolable: true },
  poison: { rarity: 'common',    star: 3, color: '#a9c6a0', poolable: true },
  shock:  { rarity: 'common',    star: 3, color: '#a9c6a0', poolable: true },
  arrow:  { rarity: 'basic',     star: 1, color: '#c9ccd1', poolable: false },
  cannon: { rarity: 'basic',     star: 1, color: '#c9ccd1', poolable: false },
  frost:  { rarity: 'basic',     star: 1, color: '#c9ccd1', poolable: false },
};

// 档位（星数）→ 稀有度 key；2★ 为预留档位。
export const RARITY_BY_STAR = {
  6: 'legendary',
  5: 'epic',
  4: 'rare',
  3: 'common',
  2: 'uncommon',
  1: 'basic',
};

export const RARITY_LABELS = {
  legendary: '传说',
  epic: '史诗',
  rare: '稀有',
  uncommon: '精良',
  common: '普通',
  basic: '基础',
};
