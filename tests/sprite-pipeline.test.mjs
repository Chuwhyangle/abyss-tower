// 精灵管线单元测试：清单归一化、DPR 变体、图集切帧、加载状态机、预算与失效竞态。
// 全程注入假加载器（不碰网络/浏览器），断言的是 Plan 1–2 的每条契约。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  atlasFrame,
  normalizeManifest,
  resolveDprVariant,
  srcFromPath,
} from '../public/js/render/sprite-manifest.js';
import { SpritePipeline } from '../public/js/render/sprite-pipeline.js';
import {
  ATLAS_JSON_PATH,
  buildArtifacts,
  buildAtlasJson,
  buildManifest,
} from '../scripts/build-sprite-atlas.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

function wait(ms = 5) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 合法条目基线；每个用例只覆盖需要变化的字段。
function entry(overrides = {}) {
  return {
    id: 'fx/one',
    src: '/assets/sprites/fx/one.png',
    size: { w: 32, h: 16 },
    anchor: 'center',
    pivot: { x: 0.5, y: 0.5 },
    frames: 1,
    states: ['idle'],
    status: 'ready',
    dpr: [1, 2],
    ...overrides,
  };
}

function manifestOf(entries, atlases = {}) {
  return { version: 1, generatedBy: 'tests', atlases, entries };
}

function makeJsonLoader(map) {
  return async (url) => {
    if (!Object.prototype.hasOwnProperty.call(map, url)) throw new Error(`未声明的 JSON：${url}`);
    return JSON.parse(JSON.stringify(map[url]));
  };
}

// 假加载器：按 URL 决定成功 / 失败 / 永不返回，并统计同时在途峰值。
function makeLoader({ fail = [], hang = [], size = () => ({ width: 32, height: 16 }), bytes = null } = {}) {
  const calls = [];
  let active = 0;
  let peak = 0;
  const loader = (url) => {
    calls.push(url);
    if (hang.includes(url)) return new Promise(() => {});
    active += 1;
    peak = Math.max(peak, active);
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        active -= 1;
        if (fail.includes(url)) {
          reject(new Error(`加载失败：${url}`));
          return;
        }
        const dims = size(url);
        const count = typeof bytes === 'function' ? bytes(url, dims) : dims.width * dims.height * 4;
        resolve({ image: { src: url }, width: dims.width, height: dims.height, bytes: count });
      }, 1);
    });
  };
  return { loader, calls, peak: () => peak };
}

function makeCtx() {
  const ctx = {
    draws: [],
    ops: [],
    saved: 0,
    restored: 0,
    globalAlpha: 1,
    drawImage(...args) {
      this.draws.push(args);
    },
    save() {
      this.saved += 1;
    },
    restore() {
      this.restored += 1;
      this.globalAlpha = 1;
    },
    translate(...args) {
      this.ops.push(['translate', ...args]);
    },
    rotate(...args) {
      this.ops.push(['rotate', ...args]);
    },
  };
  return ctx;
}

function makeWarnings() {
  const messages = [];
  return { warn: (message) => messages.push(message), messages };
}

// ── 清单 ────────────────────────────────────────────────────────────────────

test('清单校验：非法条目进 errors 且不抛错', () => {
  const raw = manifestOf([
    entry({ id: 'fx/ok' }),
    entry({ id: '' }), // 缺 id
    { ...entry({ id: 'fx/no-src' }), src: undefined, path: undefined }, // 缺 src
    entry({ id: 'fx/zero', size: { w: 0, h: 16 } }),
    entry({ id: 'fx/negative', size: { w: 16, h: -8 } }),
    entry({ id: 'fx/fractional', size: { w: 12.5, h: 16 } }),
    entry({ id: 'fx/pivot', pivot: { x: 1.5, y: 0.5 } }), // 锚点越界
    entry({ id: 'fx/anchor', anchor: 'middle' }),
    entry({ id: 'fx/dpr', dpr: 2 }),
  ]);

  let result = null;
  assert.doesNotThrow(() => {
    result = normalizeManifest(raw);
  });
  assert.deepEqual(result.entries.map((item) => item.id), ['fx/ok']);
  const codes = result.errors.map((error) => error.code);
  for (const code of ['missing-id', 'missing-src', 'pivot-range', 'anchor-invalid', 'invalid-dpr']) {
    assert.ok(codes.includes(code), `缺少错误码 ${code}（实际：${codes.join(',')}）`);
  }
  assert.equal(codes.filter((code) => code === 'invalid-size').length, 3, '尺寸 0/负数/非整数各一例');
});

test('清单校验：重复 id 只保留最后一条', () => {
  const { entries, errors } = normalizeManifest(
    manifestOf([entry({ id: 'fx/dup', src: '/assets/first.png' }), entry({ id: 'fx/dup', src: '/assets/last.png' })])
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].src, '/assets/last.png');
  assert.ok(errors.some((error) => error.code === 'duplicate-id'));
});

test('清单校验：path 可推导 src，未知 shape 不抛错', () => {
  assert.equal(srcFromPath('public/assets/sprites/probe/probe.png'), '/assets/sprites/probe/probe.png');
  assert.equal(srcFromPath('docs/x.png'), null);
  const { entries } = normalizeManifest(
    manifestOf([{ id: 'fx/path', path: 'public/assets/sprites/probe/probe.png', size: { w: 8, h: 8 } }])
  );
  assert.equal(entries[0].src, '/assets/sprites/probe/probe.png');
  assert.doesNotThrow(() => normalizeManifest(null));
  assert.deepEqual(normalizeManifest(null).entries, []);
});

// ── DPR 变体 ────────────────────────────────────────────────────────────────

test('resolveDprVariant：取不超过设备 DPR 的最高档，非法设备 DPR 按 1', () => {
  const both = entry({ dpr: [1, 2] });
  assert.equal(resolveDprVariant(both, 1), 1);
  assert.equal(resolveDprVariant(both, 1.5), 1);
  assert.equal(resolveDprVariant(both, 2), 2);
  assert.equal(resolveDprVariant(both, 2.6), 2);
  assert.equal(resolveDprVariant(both, 0), 1);
  assert.equal(resolveDprVariant(both, NaN), 1);
  assert.equal(resolveDprVariant(both, undefined), 1);

  const only1x = entry({ dpr: [1] });
  assert.equal(resolveDprVariant(only1x, 3), 1, '只有 @1x 的条目在 3x 设备上仍返回 1');

  const only2x = entry({ dpr: [2] });
  assert.equal(resolveDprVariant(only2x, 1), 2, '没有更低档时回落到最低档');
});

// ── 图集 ────────────────────────────────────────────────────────────────────

test('atlasFrame：有效帧返回源矩形与锚点偏移，未知/旋转帧返回 null', () => {
  const atlas = buildAtlasJson();

  const full = atlasFrame(atlas, 'probe-idle-0');
  assert.deepEqual({ sx: full.sx, sy: full.sy, sw: full.sw, sh: full.sh }, { sx: 0, sy: 0, sw: 32, sh: 16 });
  assert.equal(full.ax, 16, 'pivot.x × sourceW');
  assert.equal(full.ay, 8, 'pivot.y × sourceH');
  assert.equal(full.trimmed, false);

  const trimmed = atlasFrame(atlas, 'probe-idle-1');
  assert.deepEqual({ sx: trimmed.sx, sy: trimmed.sy, sw: trimmed.sw, sh: trimmed.sh }, { sx: 32, sy: 0, sw: 16, sh: 12 });
  assert.equal(trimmed.ax, 16 - 8, 'pivot 已扣除裁剪位移');
  assert.equal(trimmed.ay, 8 - 2);
  assert.equal(trimmed.trimmed, true);

  assert.equal(atlasFrame(atlas, 'unknown-frame'), null);
  assert.equal(atlasFrame(atlas, null), null);
  assert.equal(atlasFrame(null, 'probe-idle-0'), null);
  const rotated = { frames: { spin: { x: 0, y: 0, w: 8, h: 8, rotated: true } } };
  assert.equal(atlasFrame(rotated, 'spin'), null, '旋转打包显式拒绝');
});

// ── 管线：成功路径与 draw 语义 ───────────────────────────────────────────────

test('管线：图集条目 draw 恰好一次 9 参 drawImage，单图条目恰好一次 4 参', async () => {
  const probeManifest = buildManifest();
  const atlasJson = buildAtlasJson();
  const { loader, calls } = makeLoader({ size: () => ({ width: 48, height: 16 }) });
  const pipeline = new SpritePipeline({
    dpr: 1,
    loader,
    loadJson: makeJsonLoader({ '/assets/sprites/manifest.json': probeManifest, '/assets/sprites/probe/probe-atlas.json': atlasJson }),
  });

  const stats = await pipeline.preload();
  assert.equal(stats.total, 1);
  assert.equal(stats.ready, 1);
  assert.equal(stats.failed, 0);
  assert.equal(calls.filter((url) => url.endsWith('probe.png')).length, 1);

  const frame = pipeline.frame('fx/probe');
  assert.deepEqual({ sx: frame.sx, sy: frame.sy, sw: frame.sw, sh: frame.sh }, { sx: 0, sy: 0, sw: 32, sh: 16 });
  assert.deepEqual({ dw: frame.dw, dh: frame.dh }, { dw: 32, dh: 16 });

  const ctx = makeCtx();
  assert.equal(pipeline.draw(ctx, 'fx/probe', 100, 50), true);
  assert.equal(ctx.draws.length, 1);
  assert.equal(ctx.draws[0].length, 9, '图集走 9 参重载');
  assert.deepEqual(ctx.draws[0].slice(1, 5), [0, 0, 32, 16]);
  assert.deepEqual(ctx.draws[0].slice(5), [100 - 16, 50 - 8, 32, 16], 'pivot 落在 (x, y)');

  assert.equal(pipeline.draw(ctx, 'fx/missing', 0, 0), false);
  assert.equal(pipeline.draw(ctx, 'fx/probe', 0, 0, { alpha: 0.5, rotation: 0.3 }), true);
  assert.equal(ctx.draws.length, 2, 'alpha/rotation 仍只调用一次 drawImage');
  assert.equal(ctx.saved, 1);
  assert.equal(ctx.restored, 1);
  assert.equal(ctx.globalAlpha, 1, 'ctx 状态不泄漏');
  assert.equal(ctx.ops.length, 2, 'rotation 走 translate + rotate');
});

test('管线：单图条目 draw 是 4 参重载，尺寸取加载结果', async () => {
  const manifest = manifestOf([
    entry({ id: 'fx/loose', src: '/assets/loose.png', srcs: { 1: '/assets/loose.png', 2: '/assets/loose@2x.png' } }),
  ]);
  const { loader } = makeLoader({ size: (url) => (url.endsWith('@2x.png') ? { width: 64, height: 32 } : { width: 32, height: 16 }) });
  const pipeline = new SpritePipeline({ dpr: 1, loader, loadJson: makeJsonLoader({ '/assets/sprites/manifest.json': manifest }) });
  await pipeline.preload();

  const frame = pipeline.frame('fx/loose');
  assert.deepEqual({ sw: frame.sw, sh: frame.sh, dw: frame.dw, dh: frame.dh }, { sw: 32, sh: 16, dw: 32, dh: 16 });

  const ctx = makeCtx();
  assert.equal(pipeline.draw(ctx, 'fx/loose', 10, 20), true);
  assert.equal(ctx.draws.length, 1);
  assert.equal(ctx.draws[0].length, 5, '单图走 4 参重载');
  assert.deepEqual(ctx.draws[0].slice(1), [10 - 16, 20 - 8, 32, 16]);
});

test('管线：configure 切换 DPR 变体，同一 URL 不重复下载', async () => {
  const manifest = manifestOf([
    entry({ id: 'fx/dpr', src: '/assets/dpr.png', srcs: { 1: '/assets/dpr.png', 2: '/assets/dpr@2x.png' } }),
  ]);
  const { loader, calls } = makeLoader({ size: (url) => (url.endsWith('@2x.png') ? { width: 64, height: 32 } : { width: 32, height: 16 }) });
  const pipeline = new SpritePipeline({ dpr: 1, loader, loadJson: makeJsonLoader({ '/assets/sprites/manifest.json': manifest }) });
  await pipeline.preload();
  assert.deepEqual([pipeline.frame('fx/dpr').dw, pipeline.frame('fx/dpr').dh], [32, 16]);

  await pipeline.configure({ dpr: 2 });
  assert.deepEqual([pipeline.frame('fx/dpr').dw, pipeline.frame('fx/dpr').dh], [64, 32], '@2x 档尺寸');

  const before = calls.length;
  await pipeline.configure({ dpr: 1 });
  assert.deepEqual([pipeline.frame('fx/dpr').dw, pipeline.frame('fx/dpr').dh], [32, 16], '回到 @1x');
  assert.equal(calls.length, before, '已缓存的 @1x 不再下载');
  assert.equal(new Set(calls).size, calls.length, '同一 URL 全程只加载一次');
});

test('管线：图集条目 configure 后 frame 尺寸随档位缩放', async () => {
  const probeManifest = buildManifest();
  const atlasJson = buildAtlasJson();
  const { loader } = makeLoader({ size: () => ({ width: 48, height: 16 }) });
  const pipeline = new SpritePipeline({
    dpr: 1,
    loader,
    loadJson: makeJsonLoader({ '/assets/sprites/manifest.json': probeManifest, '/assets/sprites/probe/probe-atlas.json': atlasJson }),
  });
  await pipeline.preload();
  assert.equal(pipeline.frame('fx/probe').dw, 32);
  await pipeline.configure({ dpr: 2 });
  const big = pipeline.frame('fx/probe');
  assert.deepEqual({ dw: big.dw, dh: big.dh, sw: big.sw, sh: big.sh }, { dw: 64, dh: 32, sw: 64, sh: 32 });
});

// ── 失败、超时与并发 ────────────────────────────────────────────────────────

test('缺资源回退：failed 条目不绘制、preload 正常 resolve、warn 只一次', async () => {
  const manifest = manifestOf([entry({ id: 'fx/broken', src: '/assets/broken.png' })]);
  const { loader } = makeLoader({ fail: ['/assets/broken.png'] });
  const warnings = makeWarnings();
  const pipeline = new SpritePipeline({
    dpr: 1,
    loader,
    warn: warnings.warn,
    loadJson: makeJsonLoader({ '/assets/sprites/manifest.json': manifest }),
  });

  const stats = await pipeline.preload();
  assert.equal(stats.failed, 1);
  assert.equal(stats.ready, 0);
  assert.equal(pipeline.frame('fx/broken'), null);

  const ctx = makeCtx();
  assert.equal(pipeline.draw(ctx, 'fx/broken', 5, 5), false);
  assert.equal(ctx.draws.length, 0, '失败条目不发起任何绘制调用');

  await pipeline.preload();
  assert.equal(warnings.messages.length, 1, '同一 id 只 warn 一次');
  assert.match(warnings.messages[0], /回退程序化绘制/);
});

test('超时与并发：永久挂起的加载按超时置 failed，在途峰值不超过并发上限', async () => {
  const hanging = manifestOf([
    entry({ id: 'fx/hang-a', src: '/assets/hang-a.png' }),
    entry({ id: 'fx/hang-b', src: '/assets/hang-b.png' }),
  ]);
  const hangLoader = makeLoader({ hang: ['/assets/hang-a.png', '/assets/hang-b.png'] });
  const hangPipeline = new SpritePipeline({
    dpr: 1,
    loader: hangLoader.loader,
    timeoutMs: 20,
    loadJson: makeJsonLoader({ '/assets/sprites/manifest.json': hanging }),
  });
  const stats = await hangPipeline.preload();
  assert.equal(stats.failed, 2);
  assert.equal(stats.pending, 0);
  assert.equal(hangPipeline.frame('fx/hang-a'), null);

  const many = manifestOf(
    Array.from({ length: 20 }, (_, index) => entry({ id: `fx/many-${index}`, src: `/assets/many-${index}.png` }))
  );
  const burst = makeLoader();
  const burstPipeline = new SpritePipeline({
    dpr: 1,
    loader: burst.loader,
    concurrency: 6,
    loadJson: makeJsonLoader({ '/assets/sprites/manifest.json': many }),
  });
  const burstStats = await burstPipeline.preload();
  assert.equal(burstStats.ready, 20);
  assert.ok(burst.peak() <= 6, `并发峰值应 ≤ 6，实际 ${burst.peak()}`);
  assert.equal(burst.calls.length, 20);
});

// ── 内存预算 ────────────────────────────────────────────────────────────────

test('内存预算：先丢 @2x，仍超出再标 skipped，bytes 不超预算且无 pending', async () => {
  const manifest = manifestOf(
    Array.from({ length: 4 }, (_, index) =>
      entry({ id: `fx/budget-${index}`, src: `/assets/budget-${index}.png`, srcs: { 1: `/assets/budget-${index}.png`, 2: `/assets/budget-${index}@2x.png` } })
    )
  );
  const { loader } = makeLoader({ size: (url) => (url.endsWith('@2x.png') ? { width: 64, height: 64 } : { width: 32, height: 32 }) });

  const generous = new SpritePipeline({
    dpr: 2,
    loader,
    maxBytes: 40000,
    loadJson: makeJsonLoader({ '/assets/sprites/manifest.json': manifest }),
  });
  const generousStats = await generous.preload();
  assert.equal(generousStats.ready, 4, '丢 @2x 后仍全部可用');
  assert.equal(generousStats.skipped, 0);
  assert.equal(generousStats.bytes, 4 * 32 * 32 * 4);
  assert.ok(generousStats.bytes <= 40000);
  assert.equal(generous.frame('fx/budget-0').dw, 32, '降到 @1x 变体');

  const tight = new SpritePipeline({
    dpr: 2,
    loader,
    maxBytes: 8000,
    loadJson: makeJsonLoader({ '/assets/sprites/manifest.json': manifest }),
  });
  const tightStats = await tight.preload();
  assert.ok(tightStats.bytes <= 8000, `bytes 应 ≤ 8000，实际 ${tightStats.bytes}`);
  assert.ok(tightStats.skipped >= 1);
  assert.equal(tightStats.pending, 0, '没有条目死等 pending');
  assert.equal(tightStats.ready + tightStats.skipped + tightStats.failed, 4);
});

// ── 缓存失效竞态 ────────────────────────────────────────────────────────────

test('失效竞态：失效前发出的结果不得把条目变回 ready', async () => {
  const manifest = manifestOf([entry({ id: 'fx/race', src: '/assets/race.png' })]);
  let release = null;
  let call = 0;
  const loader = (url) => {
    call += 1;
    if (call === 1) {
      return new Promise((resolve) => {
        release = () => resolve({ image: { src: url }, width: 32, height: 16 });
      });
    }
    return Promise.resolve({ image: { src: url }, width: 32, height: 16 });
  };

  const pipeline = new SpritePipeline({
    dpr: 1,
    loader,
    loadJson: makeJsonLoader({ '/assets/sprites/manifest.json': manifest }),
  });

  const first = pipeline.preload();
  while (call === 0) await wait(1);
  assert.equal(pipeline.invalidate('fx/race'), true);
  assert.equal(pipeline.frame('fx/race'), null, '失效后立即不可用');

  release();
  await first;
  assert.equal(pipeline.frame('fx/race'), null, '旧结果被丢弃');
  assert.equal(pipeline.stats().ready, 0);
  assert.equal(pipeline.stats().pending, 1);

  await pipeline.preload();
  assert.ok(pipeline.frame('fx/race'), '重新 preload 后才 ready');
  assert.equal(pipeline.stats().ready, 1);
  assert.equal(call, 2);
});

// ── 释放与其他 ──────────────────────────────────────────────────────────────

test('dispose 后 frame 为 null、draw 一律 false', async () => {
  const manifest = manifestOf([entry({ id: 'fx/gone', src: '/assets/gone.png' })]);
  const { loader } = makeLoader();
  const pipeline = new SpritePipeline({ dpr: 1, loader, loadJson: makeJsonLoader({ '/assets/sprites/manifest.json': manifest }) });
  await pipeline.preload();
  assert.ok(pipeline.frame('fx/gone'));

  pipeline.dispose();
  assert.equal(pipeline.frame('fx/gone'), null);
  const ctx = makeCtx();
  assert.equal(pipeline.draw(ctx, 'fx/gone', 0, 0), false);
  assert.equal(ctx.draws.length, 0);
  assert.equal(pipeline.stats().total, 0);
});

test('stats 字段完整', async () => {
  const manifest = manifestOf([entry({ id: 'fx/stat', src: '/assets/stat.png' })]);
  const { loader } = makeLoader();
  const pipeline = new SpritePipeline({ dpr: 1, loader, loadJson: makeJsonLoader({ '/assets/sprites/manifest.json': manifest }) });
  const stats = await pipeline.preload();
  assert.deepEqual(Object.keys(stats).sort(), ['bytes', 'failed', 'inFlight', 'pending', 'ready', 'skipped', 'total']);
  assert.equal(stats.inFlight, 0);
});

// ── 源码与产物约束 ──────────────────────────────────────────────────────────

test('源码断言：管线不依赖模拟层/随机数，实体渲染器仍不加载图片', () => {
  const pipelineSrc = read('public/js/render/sprite-pipeline.js');
  const manifestSrc = read('public/js/render/sprite-manifest.js');
  for (const source of [pipelineSrc, manifestSrc]) {
    assert.doesNotMatch(source, /from ['"][^'"]*\/?sim(?:\.js|\/)/, '不得 import 模拟层');
    assert.doesNotMatch(source, /shared\/rng/, '不得 import 随机数层');
    assert.doesNotMatch(source, /Math\.random/, '不得使用 Math.random');
  }
  for (const file of ['public/js/render/enemy-renderer.js', 'public/js/render/tower-renderer.js']) {
    assert.doesNotMatch(read(file), /\bnew Image\b/, `${file} 仍不得加载外部图片`);
  }
});

test('资源可追溯：生成器可重复，磁盘产物与生成器一致', () => {
  const first = buildArtifacts();
  const second = buildArtifacts();
  assert.equal(first.length, second.length);
  first.forEach((item, index) => {
    assert.equal(item.path, second[index].path);
    assert.ok(item.data.equals(second[index].data), `${item.path} 两次生成不一致`);
    const onDisk = fs.readFileSync(path.join(ROOT, item.path));
    assert.ok(onDisk.equals(item.data), `${item.path} 与生成器不一致（跑 node scripts/build-sprite-atlas.mjs）`);
  });

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/assets/sprites/manifest.json'), 'utf8'));
  for (const item of manifest.entries) {
    assert.ok(item.provenance && item.provenance.author && item.provenance.license, `${item.id} 缺 provenance`);
    assert.equal(item.provenance.license, item.license);
    assert.ok(item.provenance.retrievedAt);
  }
  assert.ok(fs.existsSync(path.join(ROOT, ATLAS_JSON_PATH)));
});
