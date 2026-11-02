// English文案表（聚合入口）。per-domain 词典见同目录 en-US.<domain>.js；
// 键集合必须与 zh-CN.js 完全一致，tests/i18n-coverage.test.mjs 会检查。
import enemies from './en-US.enemies.js';
import relics from './en-US.relics.js';
import meta from './en-US.meta.js';
import ui from './en-US.ui.js';

export default {
  ...enemies,
  ...relics,
  ...meta,
  ...ui,
};
