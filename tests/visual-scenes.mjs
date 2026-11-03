#!/usr/bin/env node
// 确定性视觉场景采集：固定种子、固定模拟步长、固定视口，产出 PNG + contact sheet + manifest。
// 场景：title / lobby / map / combat / result；战斗场景由脚本化建塔与固定波次制造稳定混战。
// 用法：node tests/visual-scenes.mjs --scene combat --quality high --out /tmp/visual-smoke
//
// 本文件只做编排（场景推进、落盘、CLI）：采集会话与视口在 tests/lib/visual/session.mjs，
// contact sheet 在 tests/lib/visual/contact-sheet.mjs，场景计划在 tests/lib/visual/plan.mjs。
// 对外导出保持不变（含下方 re-export），调用方与既有脚本无需改动。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { encodePng } from '../scripts/lib/png.mjs';
import { lumaSignature, pixelHash } from '../scripts/lib/visual-metrics.mjs';
import { registerAndLogin, startTestServer } from './harness.mjs';
import { buildContactHtml, buildContactSheet } from './lib/visual/contact-sheet.mjs';
import {
  GAME_SEED,
  SCENE_VIEWPORTS,
  TEST_SEED,
  VIEWPORTS,
  VisualSceneSession,
  resolveQuality,
} from './lib/visual/session.mjs';
import {
  FRAME_TIME_TOLERANCE,
  SCENARIOS,
  TimeDriftError,
  buildScenarioManifestEntry,
  captureScenario,
  checkFrameTimes,
  frameKey,
  validateScenarioPlans,
} from './visual-scenarios.mjs';

// 对外导出保持不变：入口只做编排，具体能力由 harness 模块提供。
export {
  GAME_SEED,
  QUALITY_CHOICES,
  SCENE_VIEWPORTS,
  TEST_SEED,
  VIEWPORTS,
  VisualSceneSession,
  buildInitScript,
  resolveQuality,
} from './lib/visual/session.mjs';
export {
  CONTACT_CELL_HEIGHT,
  CONTACT_CELL_WIDTH,
  buildContactHtml,
  buildContactSheet,
} from './lib/visual/contact-sheet.mjs';
export {
  EVENT_SCENARIOS,
  FLOATER_SCENARIOS,
  QUALITY_SCENARIOS,
  REDUCED_MOTION_SCENARIOS,
  SCENARIOS,
  TimeDriftError,
  buildScenarioManifestEntry,
  buildScenarioRuntimeSource,
  captureScenario,
  checkFrameTimes,
  frameKey,
  validateScenarioPlans,
} from './visual-scenarios.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SCENES = Object.freeze(['title', 'lobby', 'map', 'combat', 'result']);
// combat 三帧的固定时刻（秒）：接触战 2s → 混战 4.5s → 密集命中 8s。
// 之前按「等到条件满足」取帧，实际时间会漂到 6/8/12s，前后采集对不上同 t 对照。
// 这里改成按步数精确推进，每帧记录 requestedTime，漂移即失败（FEEL-001 的 E.0 缺陷）。
export const COMBAT_TIMELINE = Object.freeze([
  Object.freeze({ id: 'combat-contact', requestedTime: 2, role: 'before', manifestOrder: 2 }),
  Object.freeze({ id: 'combat-mixed', requestedTime: 4.5, role: 'during', manifestOrder: 1 }),
  Object.freeze({ id: 'combat-impact', requestedTime: 8, role: 'after', manifestOrder: 0 }),
]);

// manifest 按「对照顺序」列出三帧：impact(8s) → mixed(4.5s) → contact(2s)，
// 与请求的 t=8/4.5/2 一一对应；contact sheet 仍按时间顺序排，方便人看。
export function orderCombatFrames(frames) {
  const order = new Map(COMBAT_TIMELINE.map((item) => [item.id, item.manifestOrder]));
  return [...frames].sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
}
// ── 单场景采集 ───────────────────────────────────────────────────────────────
async function captureScene(session, scene, options = {}) {
  const started = Date.now();
  if (scene === 'title') {
    const image = await session.gotoTitle();
    return { frames: [{ id: 'title', image }], dom: await session.domMetrics(), notes: '', elapsedMs: Date.now() - started };
  }
  if (scene === 'lobby') {
    const image = await session.gotoLobby();
    return { frames: [{ id: 'lobby', image }], dom: await session.domMetrics(), notes: '', elapsedMs: Date.now() - started };
  }
  if (scene === 'map') {
    const image = await session.gotoMap();
    return { frames: [{ id: 'map', image }], dom: await session.domMetrics(), notes: '', elapsedMs: Date.now() - started };
  }
  if (scene === 'result') {
    if (session.stage !== 'combat') await session.beginCombat();
    await session.renderFrame(0);
    await session.showResult();
    const image = await session.screenshot();
    return { frames: [{ id: 'result', image }], dom: await session.domMetrics(), notes: '', elapsedMs: Date.now() - started };
  }
  if (scene !== 'combat') throw new Error(`未知场景：${scene}`);

  await session.beginCombat({ injection: options.injection });
  // 装饰档位在重建背景之前生效（默认 full：产品高配画面）。
  await session.setDecorations(options.decorations || 'full');
  const frames = [];

  // 三帧按固定时刻精确推进：t=2 / 4.5 / 8s。每帧记录 requestedTime，
  // 实际时间对不上由 checkFrameTimes 判红（不再产出「等条件凑出来」的漂移帧）。
  // driftTicks 只给验收用：故意多走几步模拟真实漂移，验证断言确实会失败。
  for (const [index, entry] of COMBAT_TIMELINE.entries()) {
    const drift = index === 0 ? options.driftTicks || 0 : 0;
    const step = await session.stepToTime(entry.requestedTime, { extraTicks: drift });
    await session.renderFrame(1 / 60);
    frames.push({
      id: entry.id,
      role: entry.role,
      requestedTime: entry.requestedTime,
      image: await session.screenshot(),
      snapshot: step.snapshot,
    });
  }

  const impactFrame = frames.find((frame) => frame.id === 'combat-impact');
  const payload = await session.combatPayload();
  // 战斗窗口峰值口径：命中特效是短命爆发（spark 0.15s / ring 0.2s），t=8s 单瞬时可能恰撞空窗；
  // 用窗口内可见特效的峰值替代瞬时计数，并把指标帧/参照帧改在峰值瞬时采集。
  const trace = await session.combatTrace();
  const peakEffects = trace.maxEffects || 0;
  const peakTick = Number.isFinite(trace.peakTick) ? trace.peakTick : 0;

  // 隐藏表现层的 4 张参照帧：all / effects / floaters / flash（与当前帧做像素差）。
  const captureReferences = async () => {
    const references = {};
    for (const [key, options] of Object.entries({
      all: { effects: true, floaters: true, flash: true },
      effects: { effects: true, floaters: false, flash: false },
      floaters: { effects: false, floaters: true, flash: false },
      flash: { effects: false, floaters: false, flash: true },
    })) {
      await session.hideFeedback(options);
      await session.renderFrame(0);
      references[key] = await session.screenshot();
      await session.restoreFeedback();
    }
    return references;
  };
  const references = await captureReferences();
  await session.renderFrame(0);
  const dom = await session.domMetrics();

  // 峰值瞬时二次采集：复位到同一确定性起点，推进到峰值 tick，采集可见帧 + 参照帧 + payload。
  // feel 用这组峰值证据；dom / references / payload（t=8s 基线）保持不动，art 套件不受影响。
  await session.resetCombat({ injection: options.injection });
  await session.setDecorations(options.decorations || 'full');
  const peakStep = await session.stepToTime(peakTick / 60);
  await session.renderFrame(1 / 60);
  const feelFrame = { id: 'feel-peak', image: await session.screenshot(), snapshot: peakStep.snapshot };
  const feelReferences = await captureReferences();
  await session.renderFrame(0);
  const feelPayload = await session.combatPayload();
  feelPayload.effects = peakEffects;

  return {
    frames,
    metricsFrame: 'combat-impact',
    references,
    payload,
    feelFrame,
    feelReferences,
    feelPayload,
    dom,
    notes: `phase=${impactFrame?.snapshot?.phase} t=${impactFrame?.snapshot?.time}s enemies=${impactFrame?.snapshot?.enemies} peakEffects=${peakEffects}@tick${peakTick}`,
    elapsedMs: Date.now() - started,
  };
}
// ── 采集编排 ─────────────────────────────────────────────────────────────────
export function gitCommit() {
  try {
    return execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export async function capture({
  scenes = SCENES,
  scenarios = [],
  viewports = null,
  quality = 'high',
  outDir,
  seed = GAME_SEED,
  injection = null,
  decorations = 'full',
  driftTicks = 0,
  log = () => {},
} = {}) {
  const started = Date.now();
  // 场景计划先自检：计划本身不成立时不该启动浏览器，更不该产出帧。
  if (scenarios.length) {
    const plan = validateScenarioPlans();
    if (!plan.ok) throw new Error(`场景计划自检失败：\n  - ${plan.errors.join('\n  - ')}`);
  }
  const server = await startTestServer({ seedHeader: true });
  // 固定账号：标题页会显示指挥官昵称，随机账号名会让截图每次不同。
  const session0 = await registerAndLogin(server.base, {
    username: 'visualbot',
    password: 'rtd-visual-password',
  });
  const results = [];
  const scenarioResults = [];
  const timings = {};
  try {
    for (const scene of scenes) {
      const allowed = SCENE_VIEWPORTS[scene] || ['desktop'];
      const targets = viewports ? allowed.filter((id) => viewports.includes(id)) : allowed;
      if (!targets.length) {
        throw new Error(`场景 ${scene} 不支持指定视口：${viewports?.join(',')}`);
      }
      for (const viewportId of targets) {
        const viewport = VIEWPORTS[viewportId];
        if (!viewport) throw new Error(`未知视口：${viewportId}`);
        log(`[visual] ${scene} @ ${viewportId} (${viewport.width}×${viewport.height})`);
        const session = new VisualSceneSession({
          base: server.base,
          viewport,
          quality,
          seed,
          prefix: `rtd-visual-${scene}`,
        });
        try {
          await session.open({ cookie: session0.rawCookie });
          const captured = await captureScene(session, scene, { quality, injection, decorations, driftTicks });
          const entry = { scene, viewport: viewportId, quality, ...captured };
          results.push(entry);
          timings[`${scene}@${viewportId}`] = captured.elapsedMs;
          log(`[visual] ${scene} @ ${viewportId} 完成 ${captured.elapsedMs}ms（${captured.frames.length} 帧）`);
        } finally {
          await session.close();
        }
      }
    }
    // 场景：同一视口复用一个会话（每个场景开始时都会重置战场与随机序列）。
    for (const viewportId of scenarios.length ? viewports || ['desktop'] : []) {
      const viewport = VIEWPORTS[viewportId];
      if (!viewport) throw new Error(`未知视口：${viewportId}`);
      const session = new VisualSceneSession({
        base: server.base,
        viewport,
        quality,
        seed,
        prefix: 'rtd-visual-scenario',
      });
      try {
        await session.open({ cookie: session0.rawCookie });
        await session.beginCombat();
        for (const scenario of scenarios) {
          log(`[visual] 场景 ${scenario} @ ${viewportId} (${viewport.width}×${viewport.height})`);
          const captured = await captureScenario(session, scenario, { seed, quality, log });
          scenarioResults.push({ ...captured, viewport: viewportId });
          timings[`${scenario}@${viewportId}`] = captured.elapsedMs;
          log(`[visual] 场景 ${scenario} @ ${viewportId} 完成 ${captured.elapsedMs}ms（${captured.frames.length} 帧）`);
        }
      } finally {
        await session.close();
      }
    }
  } finally {
    await server.stop();
  }

  const commit = gitCommit();
  // 时间断言：所有带 requestedTime 的帧（combat 三帧 + 全部场景帧）都要对得上。
  const timedFrames = [
    ...results.flatMap((result) => result.frames.map((frame) => ({
      key: frameKey(result, frame),
      requestedTime: frame.requestedTime,
      snapshot: frame.snapshot,
    }))),
    ...scenarioResults.flatMap((result) => result.frames.map((frame) => ({
      key: frameKey(result, frame),
      requestedTime: frame.requestedTime,
      snapshot: frame.snapshot,
    }))),
  ];
  const timing = checkFrameTimes(timedFrames, { tolerance: FRAME_TIME_TOLERANCE });
  if (!timing.ok) {
    // 漂移时只写一份失败记录：不写任何 PNG / contact sheet，避免被当成同 t 对照。
    if (outDir) {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(
        path.join(outDir, 'manifest.json'),
        `${JSON.stringify({ ok: false, error: 'time-drift', commit, seed, generatedAt: new Date().toISOString(), drifts: timing.drifts }, null, 2)}\n`
      );
    }
    throw new TimeDriftError(timing.drifts);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    commit,
    seed,
    gameSeed: seed,
    testSeed: TEST_SEED,
    quality,
    injection: injection || null,
    decorations,
    scenes: [],
    scenarios: [],
    timings,
    totalMs: Date.now() - started,
  };

  const entries = [];
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    for (const result of results) {
      for (const frame of result.frames) {
        const file = `${result.scene}-${result.viewport}-${frame.id}-${result.quality}.png`;
        fs.writeFileSync(path.join(outDir, file), encodePng(frame.image));
        entries.push({
          scene: result.scene,
          viewport: result.viewport,
          frame: frame.id,
          file,
          image: frame.image,
          quality: result.quality,
        });
      }
      manifest.scenes.push({
        scene: result.scene,
        viewport: result.viewport,
        quality: result.quality,
        notes: result.notes || '',
        elapsedMs: result.elapsedMs,
        // combat 三帧按对照顺序（impact→mixed→contact）列出，snapshot.time 因此是 8 / 4.5 / 2。
        frames: orderCombatFrames(result.frames).map((frame) => ({
          id: frame.id,
          requestedTime: Number.isFinite(frame.requestedTime) ? frame.requestedTime : null,
          width: frame.image.width,
          height: frame.image.height,
          pixelHash: pixelHash(frame.image),
          lumaSignature: lumaSignature(frame.image),
          snapshot: frame.snapshot || null,
        })),
        dom: result.dom || null,
      });
    }
    for (const result of scenarioResults) {
      result.files = [];
      for (const frame of result.frames) {
        const scope = frame.towerType ? `${frame.towerType}-` : '';
        const file = `${result.scenario}-${result.viewport}-${scope}${frame.id}-${result.quality}.png`;
        fs.writeFileSync(path.join(outDir, file), encodePng(frame.image));
        result.files.push(file);
        entries.push({
          scene: result.scenario,
          viewport: result.viewport,
          frame: `${scope}${frame.id}`,
          file,
          image: frame.image,
          quality: result.quality,
          group: frame.group,
        });
      }
      manifest.scenarios.push(
        buildScenarioManifestEntry(result, {
          commit,
          seed,
          fingerprints: () => ({ pixelHash, lumaSignature }),
        })
      );
    }
    if (entries.length) {
      const sheet = buildContactSheet(entries);
      fs.writeFileSync(path.join(outDir, 'contact-sheet.png'), encodePng(sheet));
      fs.writeFileSync(
        path.join(outDir, 'contact-sheet.html'),
        buildContactHtml(entries, {
          commit: manifest.commit.slice(0, 12),
          seed,
          quality,
          generatedAt: manifest.generatedAt,
        })
      );
    }
    manifest.ok = true;
    manifest.artifacts = {
      dir: outDir,
      contactSheet: entries.length ? 'contact-sheet.png' : null,
      contactSheetHtml: entries.length ? 'contact-sheet.html' : null,
    };
    fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  }

  return { manifest, results, scenarioResults, entries };
}
// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const options = {
    scenes: [...SCENES],
    scenarios: [],
    viewports: null,
    quality: 'high',
    outDir: '/tmp/rtd-visual',
    seed: GAME_SEED,
    repeat: 1,
    driftTicks: 0,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--scene') {
      const value = next();
      options.scenes = value === 'all' ? [...SCENES] : String(value).split(',').map((item) => item.trim()).filter(Boolean);
      options.scenesExplicit = true;
    } else if (arg === '--scenario') {
      const value = next();
      options.scenarios = value === 'all' ? [...SCENARIOS] : String(value).split(',').map((item) => item.trim()).filter(Boolean);
    } else if (arg === '--drift-test') {
      // 仅验收用：让 combat 首帧多走 30 步（0.5s），验证时间断言会非零退出。
      options.driftTicks = 30;
    } else if (arg === '--viewport') {
      const value = next();
      options.viewports = value === 'all' ? null : String(value).split(',').map((item) => item.trim()).filter(Boolean);
    } else if (arg === '--quality') {
      options.quality = next();
    } else if (arg === '--out') {
      options.outDir = next();
    } else if (arg === '--seed') {
      options.seed = next();
    } else if (arg === '--repeat') {
      options.repeat = Math.max(1, Number(next()) || 1);
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  for (const scene of options.scenes) {
    if (!SCENES.includes(scene)) throw new Error(`未知场景：${scene}（可选 ${SCENES.join(' / ')} / all）`);
  }
  for (const scenario of options.scenarios) {
    if (!SCENARIOS.includes(scenario)) {
      throw new Error(`未知采集场景：${scenario}（可选 ${SCENARIOS.join(' / ')} / all）`);
    }
  }
  // 只点名了 --scenario 时不再顺带跑五个基础场景；同时点名则两者都采。
  if (options.scenarios.length && !options.scenesExplicit) options.scenes = [];
  return options;
}
// 两次采集的指纹对比：图片逐帧比较 32×32 亮度签名，容差内视为一致。
// 键与采集来源一致：场景/scenario + 视口 +（武器组）towerType + 帧 id。
function comparisonKey(result, frame) {
  const scope = result.scenario || result.scene;
  const group = result.towerType || frame.towerType ? `:${result.towerType || frame.towerType}` : '';
  return `${scope}@${result.viewport}${group}#${frame.id}`;
}

export function compareRuns(first, second) {
  const index = new Map();
  const collect = (runs) => runs.flatMap((result) => [
    ...(result.frames || []).map((frame) => ({ result, frame })),
  ]);
  for (const { result, frame } of collect(first)) {
    index.set(comparisonKey(result, frame), frame.image);
  }
  const comparisons = [];
  const seen = new Set();
  for (const { result, frame } of collect(second)) {
    const key = comparisonKey(result, frame);
    seen.add(key);
    const other = index.get(key);
    if (!other) {
      comparisons.push({ key, ok: false, reason: 'missing-first-run' });
      continue;
    }
    const a = lumaSignature(other);
    const b = lumaSignature(frame.image);
    const exact = pixelHash(other) === pixelHash(frame.image);
    let sum = 0;
    let changed = 0;
    for (let i = 0; i < a.length; i++) {
      const d = Math.abs(a[i] - b[i]);
      sum += d;
      if (d > 6) changed++;
    }
    const meanAbs = sum / a.length;
    const diffRatio = changed / a.length;
    comparisons.push({
      key,
      ok: meanAbs <= 2.5 && diffRatio <= 0.08,
      exact,
      meanAbs: Number(meanAbs.toFixed(3)),
      diffRatio: Number(diffRatio.toFixed(4)),
    });
  }
  for (const key of index.keys()) {
    if (!seen.has(key)) comparisons.push({ key, ok: false, reason: 'missing-second-run' });
  }
  return { ok: comparisons.every((item) => item.ok), comparisons };
}
async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log([
      '用法：node tests/visual-scenes.mjs [--scene combat|all] [--scenario weapons|crit|… |all] [--quality high|low|auto]',
      '                              [--out /tmp/visual-smoke] [--viewport desktop] [--repeat 2] [--drift-test]',
      `采集场景：${SCENARIOS.join(' / ')}`,
    ].join('\n'));
    return 0;
  }
  resolveQuality(options.quality);
  const runs = [];
  for (let round = 0; round < options.repeat; round++) {
    const outDir = options.repeat > 1
      ? path.join(options.outDir, `run-${round + 1}`)
      : options.outDir;
    runs.push(
      await capture({
        scenes: options.scenes,
        scenarios: options.scenarios,
        viewports: options.viewports,
        quality: options.quality,
        outDir,
        seed: options.seed,
        driftTicks: options.driftTicks,
        log: (line) => console.log(line),
      })
    );
  }

  let determinism = null;
  if (runs.length > 1) {
    determinism = compareRuns(
      [...runs[0].results, ...runs[0].scenarioResults],
      [...runs[1].results, ...runs[1].scenarioResults]
    );
    fs.writeFileSync(
      path.join(options.outDir, 'determinism.json'),
      `${JSON.stringify(determinism, null, 2)}\n`
    );
    console.log(`[visual] 确定性：${determinism.ok ? 'PASS' : 'FAIL'}（${determinism.comparisons.length} 帧）`);
  }

  const manifest = runs[0].manifest;
  const manifestPath = options.repeat > 1
    ? path.join(options.outDir, 'run-1', 'manifest.json')
    : path.join(options.outDir, 'manifest.json');
  const summary = {
    out: options.outDir,
    scenes: options.scenes,
    scenarios: options.scenarios,
    viewports: options.viewports,
    quality: options.quality,
    frames: runs[0].entries.length,
    totalMs: manifest.totalMs,
    determinism,
    manifest: manifestPath,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (determinism && !determinism.ok) return 1;
  return 0;
}

const isDirectEntry =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectEntry) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      // 时间漂移是「采集结论」而不是程序崩溃：只打印请求 vs 实际，退出码 3。
      if (error instanceof TimeDriftError) {
        console.error(`[visual-scenes] ${error.message}`);
        process.exit(3);
      }
      console.error(`[visual-scenes] ${error.stack || error.message}`);
      process.exit(2);
    });
}
