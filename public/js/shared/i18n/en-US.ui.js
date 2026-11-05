// English（ui 域）聚合器。feature 片段见同目录 en-US.ui.<feature>.js；
// 键集合必须与 zh-CN.js 完全一致，tests/i18n-coverage.test.mjs 会检查。
import common from './en-US.ui.common.js';
import data from './en-US.ui.data.js';
import title from './en-US.ui.title.js';
import hud from './en-US.ui.hud.js';
import shop from './en-US.ui.shop.js';
import tower from './en-US.ui.tower.js';
import draft from './en-US.ui.draft.js';
import hex from './en-US.ui.hex.js';
import skill from './en-US.ui.skill.js';
import achievements from './en-US.ui.achievements.js';
import settings from './en-US.ui.settings.js';
import result from './en-US.ui.result.js';
import share from './en-US.ui.share.js';
import meta from './en-US.ui.meta.js';

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
};
