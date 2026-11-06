// 简体中文（ui 域）聚合器。feature 片段见同目录 zh-CN.ui.<feature>.js；
// 键集合必须与 en-US.js 完全一致，tests/i18n-coverage.test.mjs 会检查。
import common from './zh-CN.ui.common.js';
import data from './zh-CN.ui.data.js';
import title from './zh-CN.ui.title.js';
import hud from './zh-CN.ui.hud.js';
import shop from './zh-CN.ui.shop.js';
import tower from './zh-CN.ui.tower.js';
import draft from './zh-CN.ui.draft.js';
import hex from './zh-CN.ui.hex.js';
import skill from './zh-CN.ui.skill.js';
import achievements from './zh-CN.ui.achievements.js';
import settings from './zh-CN.ui.settings.js';
import result from './zh-CN.ui.result.js';
import share from './zh-CN.ui.share.js';
import meta from './zh-CN.ui.meta.js';
import gacha from './zh-CN.ui.gacha.js';

export default {
  ...common,
  ...data,
  ...title,
  ...hud,
  ...shop,
  ...tower,
  ...draft,
  ...hex,
  ...skill,
  ...achievements,
  ...settings,
  ...result,
  ...share,
  ...meta,
  ...gacha,
};
