// 结算战绩分享卡片：离屏 Canvas 生成 PNG。
// 本模块只接收调用方整理好的结算数据（分数/波次/难度/遗物/分享码），
// 不读取模拟器内部状态，也不依赖页面 DOM 结构；绘制与下载失败只返回状态。
import {
  DIFFICULTIES,
  RELIC_BY_ID,
  RELIC_MAX_LEVEL,
  RARITY,
  normalizeRelicStates,
} from './shared/data.js';

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;
export const CARD_PADDING = 72;
export const CARD_MAX_RELICS = 5;
export const CARD_MAX_CODE_LINES = 3;

// 胜负用蓝/橙区分并保留文字标签，避免只靠颜色传达结果（色盲友好）。
export const CARD_COLORS = {
  background: '#0b1419',
  panel: '#121f27',
  border: '#22333f',
  text: '#e6eef2',
  muted: '#9fb0c3',
  victory: '#56b4e9',
  defeat: '#e69f00',
  gold: '#ffd36b',
  code: '#6bd6ff',
};

// 卡片固定中英双语标签，不随界面语言切换。
export const CARD_LABELS = {
  brand: '渊塔守卫 · ABYSS TOWER',
  victory: '胜利 / VICTORY',
  defeat: '失败 / DEFEAT',
  score: '最终得分 / FINAL SCORE',
  wave: '波次 / WAVE',
  difficulty: '难度 / DIFFICULTY',
  mode: '模式 / MODE',
  relics: '关键遗物 / KEY RELICS',
  shareCode: '分享码 / SHARE CODE',
  noRelics: '无遗物 / NO RELICS',
  noCode: '未生成分享码 / NO SHARE CODE',
  footer: '渊塔守卫 · 战绩分享卡 / RUN CARD',
};

const MODE_LABELS = {
  normal: '标准 / Standard',
  daily: '每日 / Daily',
  endless: '无尽 / Endless',
  mutated: '变异 / Mutated',
  weekly: '周赛 / Weekly',
};

const DIFFICULTY_EN = { roam: 'Roam', standard: 'Expedition', abyss: 'Abyss' };

const RARITY_RANK = { epic: 0, rare: 1, common: 2 };

const toNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

// 千分位格式化，保持与服务端/结算页一致的展示。
export function formatCardNumber(value) {
  return String(Math.round(toNumber(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// 超出宽度的文本截断为前缀 + 省略号；measure 由调用方提供（Canvas 或测试桩）。
export function truncateText(text, maxWidth, measure) {
  const value = String(text ?? '');
  if (!value) return '';
  if (measure(value) <= maxWidth) return value;
  if (measure('…') > maxWidth) return '';
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measure(value.slice(0, mid) + '…') <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return low > 0 ? `${value.slice(0, low)}…` : '…';
}

// 按宽度贪心换行；超过 maxLines 时在末行截断并加省略号，保证不溢出卡片。
export function wrapText(text, maxWidth, measure, maxLines = CARD_MAX_CODE_LINES) {
  const value = String(text ?? '');
  if (!value || maxLines <= 0) return [];
  const lines = [];
  let index = 0;
  while (index < value.length && lines.length < maxLines) {
    let take = 0;
    while (index + take < value.length && measure(value.slice(index, index + take + 1)) <= maxWidth) {
      take += 1;
    }
    if (take === 0) {
      if (lines.length === 0) return [truncateText(value, maxWidth, measure) || '…'];
      break;
    }
    const lastLine = lines.length === maxLines - 1;
    if (index + take >= value.length) {
      lines.push(value.slice(index));
      index = value.length;
      break;
    }
    if (lastLine) {
      lines.push(truncateText(value.slice(index), maxWidth, measure) || '…');
      index = value.length;
      break;
    }
    lines.push(value.slice(index, index + take));
    index += take;
  }
  return lines;
}

// 关键遗物：按稀有度、等级排序后取前 N 个；未知 id 直接忽略。
export function normalizeShareCardRelics(relics, limit = CARD_MAX_RELICS) {
  const states = normalizeRelicStates(relics);
  return states
    .map((state) => {
      const def = RELIC_BY_ID[state.id];
      return {
        id: state.id,
        name: def.name,
        level: state.level,
        color: RARITY[def.rarity]?.color || CARD_COLORS.muted,
        rank: RARITY_RANK[def.rarity] ?? 3,
      };
    })
    .sort((left, right) => left.rank - right.rank || right.level - left.level)
    .slice(0, Math.max(0, toNumber(limit, CARD_MAX_RELICS)))
    .map(({ id, name, level, color }) => ({ id, name, level: Math.min(level, RELIC_MAX_LEVEL), color }));
}

// 结算数据 → 卡片数据：缺失字段回退占位值，调用方只需给出已有信息。
export function buildShareCardData({ stats = {}, res = null, mode = 'normal', relics = [], shareCode = '' } = {}) {
  const victory = Boolean(res?.victory ?? stats?.victory ?? false);
  const difficultyId = res?.difficulty || stats?.difficulty || 'standard';
  const difficulty = DIFFICULTIES[difficultyId] || DIFFICULTIES.standard;
  const score = toNumber(res?.score ?? stats?.score);
  const wave = toNumber(stats?.clearedWave ?? stats?.wave);
  const cardRelics = normalizeShareCardRelics(relics);
  const code = String(shareCode ?? '').trim();
  return {
    victory,
    outcomeText: victory ? CARD_LABELS.victory : CARD_LABELS.defeat,
    accent: victory ? CARD_COLORS.victory : CARD_COLORS.defeat,
    score,
    scoreText: formatCardNumber(score),
    wave,
    waveText: String(wave),
    difficultyId: difficulty.id,
    difficultyText: `${difficulty.name} / ${DIFFICULTY_EN[difficultyId] || difficulty.id}`,
    mode,
    modeText: MODE_LABELS[mode] || String(mode || '—'),
    relics: cardRelics,
    relicLines: cardRelics.length
      ? cardRelics.map((relic) => `· ${relic.name}  Lv.${relic.level}`)
      : [CARD_LABELS.noRelics],
    shareCode: code,
    codeText: code || CARD_LABELS.noCode,
    hasShareCode: code.length > 0,
  };
}

// 统一绘制入口：先按最大宽度截断，再交给 Canvas 排版。
function drawText(ctx, text, x, y, { font, color, maxWidth, align = 'left' } = {}) {
  const measure = (value) => ctx.measureText(value).width;
  const fitted = Number.isFinite(maxWidth) ? truncateText(text, maxWidth, measure) : String(text ?? '');
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(fitted, x, y);
  return fitted;
}

function drawPanel(ctx, x, y, width, height, fill, stroke) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, width, height);
  if (!stroke) return;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, width, height);
}

// 卡片排版：固定尺寸 + 固定留白，任何动态文本都经过 drawText 截断。
export function drawShareCard(ctx, input) {
  const card = input?.outcomeText ? input : buildShareCardData(input);
  const width = CARD_WIDTH;
  const height = CARD_HEIGHT;
  const pad = CARD_PADDING;
  const inner = width - pad * 2;
  const sans = (size, weight = 400) => `${weight} ${size}px "Noto Sans SC", system-ui, sans-serif`;
  const mono = (size) => `600 ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;

  ctx.fillStyle = CARD_COLORS.background;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = card.accent;
  ctx.fillRect(0, 0, width, 14);

  drawText(ctx, CARD_LABELS.brand, pad, 112, {
    font: sans(30, 600),
    color: CARD_COLORS.muted,
    maxWidth: inner,
  });

  drawText(ctx, card.outcomeText, pad, 216, {
    font: sans(76, 700),
    color: card.accent,
    maxWidth: inner,
  });

  drawPanel(ctx, pad, 268, inner, 254, CARD_COLORS.panel, CARD_COLORS.border);
  drawText(ctx, CARD_LABELS.score, pad + 36, 336, {
    font: sans(30),
    color: CARD_COLORS.muted,
    maxWidth: inner - 72,
  });
  drawText(ctx, card.scoreText, pad + 36, 466, {
    font: sans(112, 700),
    color: CARD_COLORS.gold,
    maxWidth: inner - 72,
  });

  const gap = 24;
  const column = Math.floor((inner - gap * 2) / 3);
  const stats = [
    [CARD_LABELS.wave, card.waveText],
    [CARD_LABELS.difficulty, card.difficultyText],
    [CARD_LABELS.mode, card.modeText],
  ];
  stats.forEach(([label, value], index) => {
    const x = pad + index * (column + gap);
    drawPanel(ctx, x, 554, column, 152, CARD_COLORS.panel, CARD_COLORS.border);
    drawText(ctx, label, x + 24, 602, {
      font: sans(24),
      color: CARD_COLORS.muted,
      maxWidth: column - 48,
    });
    drawText(ctx, value, x + 24, 664, {
      font: sans(36, 600),
      color: CARD_COLORS.text,
      maxWidth: column - 48,
    });
  });

  drawPanel(ctx, pad, 746, inner, 246, CARD_COLORS.panel, CARD_COLORS.border);
  drawText(ctx, CARD_LABELS.relics, pad + 36, 810, {
    font: sans(28, 600),
    color: CARD_COLORS.muted,
    maxWidth: inner - 72,
  });
  card.relicLines.forEach((line, index) => {
    drawText(ctx, line, pad + 36, 866 + index * 32, {
      font: sans(28),
      color: card.relics.length ? card.relics[index]?.color || CARD_COLORS.text : CARD_COLORS.muted,
      maxWidth: inner - 72,
    });
  });

  drawPanel(ctx, pad, 1024, inner, 222, CARD_COLORS.panel, CARD_COLORS.border);
  drawText(ctx, CARD_LABELS.shareCode, pad + 36, 1080, {
    font: sans(28, 600),
    color: CARD_COLORS.muted,
    maxWidth: inner - 72,
  });
  const measure = (value) => ctx.measureText(value).width;
  // 分享码用等宽字体按行宽折行，最多三行，超出部分截断。
  ctx.font = mono(24);
  const codeLines = wrapText(card.codeText, inner - 72, measure, CARD_MAX_CODE_LINES);
  ctx.font = mono(24);
  codeLines.forEach((line, index) => {
    drawText(ctx, line, pad + 36, 1130 + index * 38, {
      font: mono(24),
      color: card.hasShareCode ? CARD_COLORS.code : CARD_COLORS.muted,
      maxWidth: inner - 72,
    });
  });

  ctx.font = sans(22);
  const footer = truncateText(CARD_LABELS.footer, inner, measure);
  const footerWidth = measure(footer);
  drawText(ctx, footer, Math.max(pad, (width - footerWidth) / 2), height - 44, {
    font: sans(22),
    color: CARD_COLORS.muted,
    maxWidth: inner,
  });

  return card;
}

// 离屏 Canvas：尺寸固定，创建失败（无 DOM / 无 2D 上下文）返回 null。
export function createShareCardCanvas(data, doc = globalThis.document) {
  if (!doc || typeof doc.createElement !== 'function') return null;
  const canvas = doc.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (!ctx) return null;
  drawShareCard(ctx, data);
  return canvas;
}

export function canvasToBlob(canvas) {
  return new Promise((resolve) => {
    if (!canvas || typeof canvas.toBlob !== 'function') {
      resolve(null);
      return;
    }
    canvas.toBlob((blob) => resolve(blob || null), 'image/png');
  });
}

export function shareCardFilename(data = {}) {
  const wave = Math.max(0, Math.round(toNumber(data?.wave)));
  const score = Math.max(0, Math.round(toNumber(data?.score)));
  const code = String(data?.shareCode || '')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 8);
  return `abyss-tower-${wave}w-${score}${code ? `-${code}` : ''}.png`;
}

// 一键下载：生成 Blob → 触发 <a download> → 释放 object URL。
export async function downloadShareCard(data, { doc = globalThis.document, filename } = {}) {
  const canvas = createShareCardCanvas(data, doc);
  if (!canvas) return { ok: false, reason: 'canvas' };
  const blob = await canvasToBlob(canvas);
  if (!blob || typeof URL?.createObjectURL !== 'function') return { ok: false, reason: 'blob' };
  const url = URL.createObjectURL(blob);
  const link = doc.createElement('a');
  link.href = url;
  link.download = filename || shareCardFilename(data);
  link.rel = 'noopener';
  if (doc.body?.appendChild) doc.body.appendChild(link);
  link.click();
  link.remove?.();
  globalThis.setTimeout?.(() => URL.revokeObjectURL(url), 0);
  return { ok: true, filename: link.download };
}
