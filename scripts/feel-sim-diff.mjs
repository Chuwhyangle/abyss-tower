#!/usr/bin/env node
// 同 seed 模拟一致性证据：固定 seed 下无头重跑战斗场景，落盘三份证据并对两个产物目录逐项 diff。
// 只读运行：不改 public/js/**、不改战斗数值，也不改变模拟结果——接线只做旁路观测。
//
// 用法：
//   node scripts/feel-sim-diff.mjs --scene combat --seed visual-fixed-seed --out /tmp/feel-sim-diff/after
//   node scripts/feel-sim-diff.mjs --diff /tmp/feel-sim-diff/before /tmp/feel-sim-diff/after
// 选项：
//   --root <源码树>   对任意源码树（含历史 commit 的检出）跑同一场景；默认本仓库
//   --waves <n>       覆盖场景波数（测试用；默认取场景定义）
//   --max-seconds <n> 单波步进上限（秒）；超时停在确定性边界并如实记录
//
// 产物（--out 目录下三份，无时间戳，同输入逐字节可复现）：
//   events.json  结构化命中事件序列：damage / skillDamage 两个扣血汇点的入参与扣血结果
//   rng.json     全部 RNG 实例的调用序列（值级）+ 逐流摘要
//   state.json   终局状态（存档快照 + 活体状态）与哈希
//
// 事件字段只记「物理可观测」的量（时间、目标、入参、扣血前后、暴击/持续伤害/致死标记），
// 不记 weapon / source 等纯标注字段：版本间新增标注不算分叉，扣血与 RNG 变了才算。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FORMAT_VERSION = 1;
export const ARTIFACTS = Object.freeze(['events.json', 'rng.json', 'state.json']);
// 与 balance-sim / 浏览器主循环同一步长，保证与真实对局的时间轴一致。
export const STEP = 1 / 60;

// 场景定义：同 seed 同定义即同输入。塔位由地图覆盖评分确定性推导（不写死坐标），
// 因此换地图只影响可建格排序，不会让工具静默跑空。
export const SCENES = Object.freeze({
  combat: Object.freeze({
    difficulty: 'standard',
    gold: 1600,
    baseHp: 20,
    waves: 5,
    maxSeconds: 90,
    unlockedTowers: Object.freeze(['arrow', 'cannon', 'frost']),
    towerTypes: Object.freeze(['arrow', 'cannon', 'frost', 'arrow', 'cannon', 'arrow']),
    // 自带 20% 暴击的遗物：让 combatRng 真正被消耗，否则战斗随机流在本场景里是空跑，
    // 「RNG 序列一致」就只覆盖波次生成，证明力不足。
    relics: Object.freeze(['crit']),
  }),
});

export const DEFAULT_SEED = 'visual-fixed-seed';

// ---------- 规范化与哈希 ----------

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])]);
    return Object.fromEntries(entries);
  }
  return value === undefined ? null : value;
}

// 键序无关的规范化 JSON：同结构必然同字节，用作哈希输入。
export function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

export function digest(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

// ---------- 旁路接线 ----------

// RNG 调用序列：在原型上接管 _next 的赋值，包一层只读记录器。
// 返回的包装函数原样返回底层值，调用顺序与取值完全不变；所有 RNG 实例（含运行中新建的
// 波次/事件/技能随机数）都被覆盖，流名按实例创建顺序编号，因此跨版本可比。
export function instrumentRng(RNG) {
  if (Object.getOwnPropertyDescriptor(RNG.prototype, '_next')) {
    throw new Error('RNG.prototype._next 已被占用，拒绝二次接线');
  }
  const calls = [];
  let created = 0;
  Object.defineProperty(RNG.prototype, '_next', {
    configurable: true,
    get() {
      return this.__feelSimNext;
    },
    set(raw) {
      const stream = `rng#${++created}`;
      this.__feelSimNext = () => {
        const value = raw();
        calls.push({ stream, value });
        return value;
      };
    },
  });
  return {
    calls,
    restore() {
      delete RNG.prototype._next;
    },
  };
}

// 伤害汇点：damage() 覆盖塔/盟友/持续伤害，skillDamage() 是技能百分比伤害的独立汇点。
// 入队发生在调用前、回填结果发生在返回后——顺序即真实扣血顺序，击杀连锁不会把事件重排。
export const DAMAGE_PATHS = Object.freeze([
  ['damage', 'damage'],
  ['skillDamage', 'skill'],
]);

export function instrumentDamage(sim, log) {
  const restores = [];
  for (const [method, label] of DAMAGE_PATHS) {
    const original = sim[method];
    if (typeof original !== 'function') continue;
    sim[method] = function recordedDamage(enemy, amount, opts = {}) {
      const entry = {
        seq: log.length + 1,
        path: label,
        t: sim.time,
        target: { id: enemy?.id ?? null, type: enemy?.type ?? null },
        requested: Number.isFinite(amount) ? amount : null,
        crit: opts.crit === true,
        dot: opts.dot === true,
        hpBefore: Number.isFinite(enemy?.hp) ? enemy.hp : null,
        hpAfter: null,
        dealt: null,
        lethal: false,
      };
      log.push(entry);
      const result = original.call(sim, enemy, amount, opts);
      entry.hpAfter = Number.isFinite(enemy?.hp) ? enemy.hp : null;
      entry.dealt = Number.isFinite(result) ? result : null;
      entry.lethal = enemy?.dead === true;
      return result;
    };
    restores.push(() => {
      sim[method] = original;
    });
  }
  return () => {
    for (const restore of restores.reverse()) restore();
  };
}

// ---------- 场景 ----------

// 可建格按「射程内路径采样点数」降序，取样与 balance-sim 的覆盖评分同一口径。
export function coverageCells(sim, { radius = 3.1, minSamples = 3 } = {}) {
  const samples = [];
  (sim.lanes || []).forEach((lane, index) => {
    const count = Math.max(1, Math.ceil(lane.len / 0.5));
    for (let i = 0; i <= count; i++) {
      samples.push(sim.posAt(Math.min(lane.len, i * 0.5), index));
    }
  });
  const map = sim.map || {};
  const cells = [];
  for (let r = 0; r < (map.rows || 0); r++) {
    for (let c = 0; c < (map.cols || 0); c++) {
      if (!map.buildable?.[r]?.[c]) continue;
      let coverage = 0;
      for (const sample of samples) {
        const dx = sample.x - (c + 0.5);
        const dy = sample.y - (r + 0.5);
        if (dx * dx + dy * dy <= radius * radius) coverage++;
      }
      if (coverage > minSamples) cells.push({ c, r, coverage });
    }
  }
  cells.sort((a, b) => b.coverage - a.coverage || a.r - b.r || a.c - b.c);
  return cells;
}

export function placeTowers(sim, config, cells) {
  const placed = [];
  for (const type of config.towerTypes) {
    const cell = cells.find(
      (entry) => !placed.some((item) => item.c === entry.c && item.r === entry.r) && sim.canBuild(entry.c, entry.r, type)
    );
    if (!cell) continue;
    if (!sim.placeTower(type, cell.c, cell.r)) continue;
    placed.push({ type, c: cell.c, r: cell.r });
  }
  return placed;
}

export async function loadModules(root = ROOT) {
  const base = path.join(root, 'public', 'js');
  const load = (rel) => import(pathToFileURL(path.join(base, rel)).href);
  const [simModule, rngModule, mapgenModule, wavesModule] = await Promise.all([
    load('sim.js'),
    load('shared/rng.js'),
    load('shared/mapgen.js'),
    load('shared/waves.js'),
  ]);
  return {
    Simulation: simModule.Simulation,
    RNG: rngModule.RNG,
    generateMap: mapgenModule.generateMap,
    generateWave: wavesModule.generateWave,
  };
}

// 活体状态：存档快照之外，把「场上还站着谁、塔什么等级」这些当帧事实一起纳入哈希。
function liveState(sim) {
  const numbers = (value) => (Number.isFinite(value) ? value : null);
  return {
    time: numbers(sim.time),
    phase: sim.phase,
    wave: numbers(sim.wave),
    clearedWave: numbers(sim.clearedWave),
    gold: numbers(sim.gold),
    baseHp: numbers(sim.baseHp),
    maxBaseHp: numbers(sim.maxBaseHp),
    kills: numbers(sim.kills),
    towers: (sim.towers || []).map((tower) => ({
      id: numbers(tower.id),
      type: tower.type,
      c: numbers(tower.c),
      r: numbers(tower.r),
      level: numbers(tower.level),
      invested: numbers(tower.invested),
      hp: numbers(tower.hp),
      maxHp: numbers(tower.maxHp),
    })),
    enemies: (sim.enemies || []).map((enemy) => ({
      id: numbers(enemy.id),
      type: enemy.type,
      hp: numbers(enemy.hp),
      maxHp: numbers(enemy.maxHp),
      x: numbers(enemy.x),
      y: numbers(enemy.y),
      progress: numbers(enemy.progress),
      shield: numbers(enemy.shield),
    })),
    projectiles: (sim.projectiles || []).length,
  };
}

// 跑一个场景，返回三份证据对象（键为产物文件名）。
// 只读：模拟对象在同一个进程里建了又丢，public/js/** 不落任何改动。
export async function runScene({
  scene = 'combat',
  seed = DEFAULT_SEED,
  root = ROOT,
  waves = null,
  maxSeconds = null,
} = {}) {
  const config = SCENES[scene];
  if (!config) throw new Error(`未知场景：${scene}（可选 ${Object.keys(SCENES).join(' / ')}）`);
  const modules = await loadModules(root);
  const rng = instrumentRng(modules.RNG);
  const hits = [];
  let restoreDamage = () => {};
  try {
    const sim = new modules.Simulation({
      map: modules.generateMap(seed),
      seed,
      difficulty: config.difficulty,
      gold: config.gold,
      baseHp: config.baseHp,
      maxBaseHp: config.baseHp,
      towers: [],
      unlockedTowers: [...config.unlockedTowers],
      relics: config.relics.map((id) => ({ id, level: 1 })),
      // 固定启动时间：存档快照里的 startedAt 不能带上墙钟。必须是真值——
      // Simulation 用 `opts.startedAt || Date.now()` 取值，传 0 会退化成墙钟。
      startedAt: 1,
      onToast: () => {},
    });
    restoreDamage = instrumentDamage(sim, hits);
    const cells = coverageCells(sim);
    const placed = placeTowers(sim, config, cells);
    // 一座塔都没建成说明场景与地图已经对不上：这时候跑出来的「空场景」不能算证据。
    if (!placed.length) throw new Error(`场景 ${scene} 在当前地图上没有任何可建格，拒绝产出空证据`);
    const waveCount = waves ?? config.waves;
    const waveSeconds = maxSeconds ?? config.maxSeconds;
    const maxSteps = Math.ceil(waveSeconds / STEP);
    const waveRuns = [];
    for (let wave = 1; wave <= waveCount; wave++) {
      const waveDef = modules.generateWave(seed, wave, config.difficulty, sim.map.meta);
      sim.beginWave(waveDef);
      let steps = 0;
      while (sim.phase === 'wave' && steps < maxSteps) {
        sim.update(STEP);
        steps++;
      }
      waveRuns.push({
        wave,
        steps,
        timedOut: sim.phase === 'wave',
        phase: sim.phase,
        time: sim.time,
        baseHp: sim.baseHp,
        kills: sim.kills,
      });
      // prep 之外（event / over / 超时）都停在确定性边界：不再推进，如实入证。
      if (sim.phase !== 'prep') break;
    }

    const run = { waves: waveCount, step: STEP, maxSeconds: waveSeconds, placed, waveRuns };
    const snapshot = sim.toSnapshot();
    // savedAt 是唯一读墙钟的字段，必须剔除，否则每次运行都「有差异」。
    delete snapshot.savedAt;
    const live = liveState(sim);
    const summary = {
      phase: live.phase,
      time: live.time,
      wave: live.wave,
      clearedWave: live.clearedWave,
      gold: live.gold,
      baseHp: live.baseHp,
      kills: live.kills,
      towers: live.towers.length,
      enemies: live.enemies.length,
      hits: hits.length,
      rngCalls: rng.calls.length,
    };
    return {
      'events.json': {
        kind: 'feel-sim-diff/events',
        formatVersion: FORMAT_VERSION,
        scene,
        seed,
        run,
        count: hits.length,
        hash: digest(hits),
        stream: hits,
      },
      'rng.json': {
        kind: 'feel-sim-diff/rng',
        formatVersion: FORMAT_VERSION,
        scene,
        seed,
        totalCalls: rng.calls.length,
        streams: summarizeStreams(rng.calls),
        hash: digest(rng.calls.map((call) => [call.stream, call.value])),
        sequence: rng.calls,
      },
      'state.json': {
        kind: 'feel-sim-diff/state',
        formatVersion: FORMAT_VERSION,
        scene,
        seed,
        run,
        summary,
        hash: digest({ snapshot, live }),
        snapshot,
        live,
      },
    };
  } finally {
    restoreDamage();
    rng.restore();
  }
}

export function summarizeStreams(calls) {
  const order = [];
  const byStream = new Map();
  for (const call of calls) {
    if (!byStream.has(call.stream)) {
      byStream.set(call.stream, []);
      order.push(call.stream);
    }
    byStream.get(call.stream).push(call.value);
  }
  return order.map((stream) => {
    const values = byStream.get(stream);
    return {
      stream,
      calls: values.length,
      first: values[0],
      last: values[values.length - 1],
      hash: digest(values),
    };
  });
}

// ---------- 落盘与比对 ----------

export function writeArtifacts(dir, artifacts) {
  fs.mkdirSync(dir, { recursive: true });
  return ARTIFACTS.map((name) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, `${JSON.stringify(artifacts[name], null, 2)}\n`);
    return { name, file, hash: artifacts[name].hash };
  });
}

export function readArtifact(dir, name) {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) return { error: `缺少产物 ${file}` };
  try {
    return { value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (error) {
    return { error: `产物无法解析 ${file}：${error.message}` };
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// 首个差异：数组先逐项比、再比长度；对象按键名排序逐个比；标量直接比。
export function firstDifference(left, right, pathLabel = '') {
  if (Array.isArray(left) && Array.isArray(right)) {
    const size = Math.min(left.length, right.length);
    for (let i = 0; i < size; i++) {
      const diff = firstDifference(left[i], right[i], `${pathLabel}[${i}]`);
      if (diff) return diff;
    }
    if (left.length !== right.length) {
      return { path: `${pathLabel}.length`, left: left.length, right: right.length };
    }
    return null;
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      const child = pathLabel ? `${pathLabel}.${key}` : key;
      if (!(key in left) || !(key in right)) {
        return { path: child, left: left[key] ?? null, right: right[key] ?? null };
      }
      const diff = firstDifference(left[key], right[key], child);
      if (diff) return diff;
    }
    return null;
  }
  if (Object.is(left, right)) return null;
  return { path: pathLabel, left: left ?? null, right: right ?? null };
}

// 比对两个产物目录：三份产物都要在、都能解析、且逐项相同，才算一致。
export function compareDirectories(leftDir, rightDir) {
  const differences = [];
  for (const name of ARTIFACTS) {
    const left = readArtifact(leftDir, name);
    const right = readArtifact(rightDir, name);
    if (left.error || right.error) {
      differences.push({ path: name, left: left.error ? null : 'ok', right: right.error ? null : 'ok', reason: left.error || right.error });
      continue;
    }
    const diff = firstDifference(left.value, right.value, name);
    if (diff) differences.push(diff);
  }
  return { ok: differences.length === 0, differences };
}

export function formatDifference(diff) {
  if (diff.reason) return `${diff.path}: ${diff.reason}`;
  return `${diff.path}: 左 ${JSON.stringify(diff.left)} / 右 ${JSON.stringify(diff.right)}`;
}

// ---------- CLI ----------

export function parseArgs(argv = []) {
  const options = { mode: 'run', scene: 'combat', seed: DEFAULT_SEED, out: null, root: ROOT, waves: null, maxSeconds: null, diff: [], help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const raw = argv[i + 1];
      if (!raw || raw.startsWith('--')) throw new Error(`${arg} 缺少取值`);
      i++;
      return raw;
    };
    const positiveInt = () => {
      const raw = value();
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${arg} 需要正整数，收到 ${raw}`);
      return parsed;
    };
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--scene') options.scene = value();
    else if (arg === '--seed') options.seed = value();
    else if (arg === '--out') options.out = value();
    else if (arg === '--root') options.root = path.resolve(value());
    else if (arg === '--waves') options.waves = positiveInt();
    else if (arg === '--max-seconds') options.maxSeconds = positiveInt();
    else if (arg === '--diff') {
      options.mode = 'diff';
      options.diff = [value(), value()];
    } else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

export function formatUsage() {
  return [
    '用法：',
    '  node scripts/feel-sim-diff.mjs --scene combat --seed visual-fixed-seed --out <目录>',
    '  node scripts/feel-sim-diff.mjs --diff <左产物目录> <右产物目录>',
    '选项：--root <源码树> --waves <n> --max-seconds <n>',
  ].join('\n');
}

export async function main(argv = process.argv.slice(2), { log = console.log, error = console.error } = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (err) {
    error(`[feel-sim-diff] ${err.message}`);
    error(formatUsage());
    return 2;
  }
  if (options.help) {
    log(formatUsage());
    return 0;
  }
  if (!SCENES[options.scene]) {
    error(`[feel-sim-diff] 未知场景：${options.scene}（可选 ${Object.keys(SCENES).join(' / ')}）`);
    return 2;
  }

  if (options.mode === 'diff') {
    const [left, right] = options.diff;
    log(`[feel-sim-diff] diff 左 ${left} / 右 ${right}`);
    const result = compareDirectories(left, right);
    if (result.ok) {
      log('[feel-sim-diff] 一致：events / rng / state 三份产物逐项相同');
      return 0;
    }
    error(`[feel-sim-diff] 发现 ${result.differences.length} 处差异（首个：${result.differences[0].path}）`);
    for (const difference of result.differences) error(`[feel-sim-diff] ${formatDifference(difference)}`);
    return 1;
  }

  if (!options.out) {
    error('[feel-sim-diff] 缺少 --out <目录>（或改用 --diff <左> <右>）');
    error(formatUsage());
    return 2;
  }
  log(`[feel-sim-diff] scene=${options.scene} seed=${options.seed} root=${options.root}`);
  const artifacts = await runScene({
    scene: options.scene,
    seed: options.seed,
    root: options.root,
    waves: options.waves,
    maxSeconds: options.maxSeconds,
  });
  const files = writeArtifacts(options.out, artifacts);
  const state = artifacts['state.json'];
  log(
    `[feel-sim-diff] 命中事件 ${state.summary.hits} 条 · RNG 调用 ${state.summary.rngCalls} 次` +
      `（${artifacts['rng.json'].streams.length} 条流）· 塔 ${state.summary.towers} 座 · 波次 ${state.summary.clearedWave}/${state.run.waves}`
  );
  log(
    `[feel-sim-diff] 哈希 events=${artifacts['events.json'].hash.slice(0, 16)} ` +
      `rng=${artifacts['rng.json'].hash.slice(0, 16)} state=${state.hash.slice(0, 16)}`
  );
  for (const file of files) log(`[feel-sim-diff] 产物 ${file.file}`);
  return 0;
}

const invokedDirectly = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main().then((code) => {
    process.exitCode = code;
  });
}
