// 简体中文文案表（聚合入口）。per-domain 词典见同目录 zh-CN.<domain>.js；
// 键集合必须与 en-US.js 完全一致，tests/i18n-coverage.test.mjs 会检查。
import enemies from './zh-CN.enemies.js';
import relics from './zh-CN.relics.js';
import meta from './zh-CN.meta.js';
import ui from './zh-CN.ui.js';

export default {
  ...enemies,
  ...relics,
  ...meta,
  ...ui,
};
