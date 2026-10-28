// contact sheet：把采集帧拼成一张 PNG 审阅图，并生成同目录的 HTML 索引页。
// 纯图像/字符串变换，不依赖浏览器；调用方（tests/visual-scenes.mjs）只负责传条目与元信息。
import { RgbaImage, blit, fillRect } from '../../../scripts/lib/png.mjs';

export const CONTACT_CELL_WIDTH = 520;
export const CONTACT_CELL_HEIGHT = 400;
const CONTACT_GUTTER = 14;
const CONTACT_COLUMNS = 3;
const CONTACT_BG = [12, 18, 22, 255];

// ── contact sheet ────────────────────────────────────────────────────────────
// 每格固定 520×400 的容器，图片等比缩放后居中；竖屏手机图因此不会被拉成巨幅。
function fitWithin(image, maxWidth, maxHeight) {
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  return { width, height };
}

export function buildContactSheet(entries) {
  const cells = entries.map((entry) => ({ ...entry, ...fitWithin(entry.image, CONTACT_CELL_WIDTH, CONTACT_CELL_HEIGHT) }));
  const columns = Math.min(CONTACT_COLUMNS, Math.max(1, cells.length));
  const rows = Math.ceil(cells.length / columns);
  const width = columns * CONTACT_CELL_WIDTH + (columns + 1) * CONTACT_GUTTER;
  const height = rows * CONTACT_CELL_HEIGHT + (rows + 1) * CONTACT_GUTTER;
  const sheet = new RgbaImage(width, height);
  fillRect(sheet, 0, 0, width, height, CONTACT_BG);
  cells.forEach((cell, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const originX = CONTACT_GUTTER + col * (CONTACT_CELL_WIDTH + CONTACT_GUTTER);
    const originY = CONTACT_GUTTER + row * (CONTACT_CELL_HEIGHT + CONTACT_GUTTER);
    const x = originX + Math.floor((CONTACT_CELL_WIDTH - cell.width) / 2);
    const y = originY + Math.floor((CONTACT_CELL_HEIGHT - cell.height) / 2);
    blit(sheet, cell.image, x, y, cell.width, cell.height);
  });
  return sheet;
}

export function buildContactHtml(entries, meta) {
  const items = entries
    .map(
      (entry) => `      <figure>
        <img src="${entry.file}" alt="${entry.scene} ${entry.viewport}" />
        <figcaption><b>${entry.scene}</b> · ${entry.viewport} · ${entry.quality}</figcaption>
      </figure>`
    )
    .join('\n');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>视觉基线 contact sheet</title>
<style>
  body { background: #0b1013; color: #cfe3ea; font: 14px/1.5 system-ui, sans-serif; margin: 24px; }
  h1 { font-size: 18px; font-weight: 600; }
  .meta { color: #7d95a1; margin-bottom: 18px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
  figure { margin: 0; background: #121a20; border: 1px solid #22303a; border-radius: 8px; overflow: hidden; }
  img { display: block; width: 100%; height: auto; }
  figcaption { padding: 8px 10px; font-size: 13px; color: #9fb6c2; }
</style>
</head>
<body>
  <h1>视觉基线 · contact sheet</h1>
  <p class="meta">commit ${meta.commit} · seed ${meta.seed} · quality ${meta.quality} · ${meta.generatedAt}</p>
  <div class="grid">
${items}
  </div>
</body>
</html>
`;
}
