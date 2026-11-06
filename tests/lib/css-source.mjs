// 分区 CSS 源码读取：public/styles.css 已按级联顺序拆为 public/css/*（见 index.html 的 <link>）。
// 源码级约束测试（选择器/令牌/动效预算/无障碍）按整体读取，与拆分前内容一致。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// 顺序 = 级联顺序（tokens 最先；a11y 的 reduced-motion 块必须保持最后）。
export const CSS_PARTS = [
  'public/css/tokens.css',
  'public/css/title.css',
  'public/css/base.css',
  'public/css/hud.css',
  'public/css/shop.css',
  'public/css/modals.css',
  'public/css/nodes.css',
  'public/css/mobile.css',
  'public/css/skills.css',
  'public/css/achievements.css',
  'public/css/meta.css',
  'public/css/transitions.css',
  'public/css/hex.css',
  'public/css/gacha.css',
  'public/css/a11y.css',
];

export function readCss() {
  return CSS_PARTS.map((relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')).join('\n');
}
