// 精灵资源管线：清单 → DPR 变体 → 并发/超时加载 → 图集切帧 → 绘制。
// 这是基础设施而不是视觉改动：缺资源 / 空清单时 draw() 一律返回 false，
// 调用方继续走既有程序化绘制，画面与接入前逐像素一致。
//
// 边界：导入期不触碰 document / Image / fetch（Node 下可直接 import）；
// 浏览器默认加载器在真正发起加载时才创建 Image。实体渲染器通过依赖注入拿到本管线，
// 自己不加载图片（tests/render-animations.test.mjs 的源码断言因此继续成立）。
import {
  atlasFrame,
  dprVariants,
  normalizeDeviceDpr,
  normalizeManifest,
  resolveDprVariant,
} from './sprite-manifest.js';

export const DEFAULT_MANIFEST_URL = '/assets/sprites/manifest.json';
export const DEFAULT_CONCURRENCY = 6;
export const DEFAULT_TIMEOUT_MS = 8000;
// 预算按解码后的 RGBA 估算（w × h × 4），默认 64 MiB：足够放下四个场景的 @2x 图集。
export const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
export const ENTRY_STATES = Object.freeze(['missing', 'pending', 'ready', 'failed', 'skipped']);

// 浏览器默认加载器：只在被调用时引用 Image，模块求值期保持无 DOM。
function createImageLoader() {
  return (url) =>
    new Promise((resolve, reject) => {
      if (typeof Image === 'undefined') {
        reject(new Error(`当前环境没有 Image，无法加载精灵：${url}`));
        return;
      }
      const image = new Image();
      image.onload = () =>
        resolve({
          image,
          width: image.naturalWidth || image.width,
          height: image.naturalHeight || image.height,
        });
      image.onerror = () => reject(new Error(`精灵文件加载失败：${url}`));
      image.src = url;
    });
}

// 默认 JSON 加载（清单与图集 JSON 共用）：只在被调用时引用 fetch。
async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`JSON 获取失败：${url}（HTTP ${response.status}）`);
  return response.json();
}

function toPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

// 统一加载结果：默认加载器给 { image, width, height }，内置对象也行。
function normalizeLoad(raw, url) {
  const image = raw && typeof raw === 'object' && raw.image ? raw.image : raw;
  const width = toPositiveNumber(raw?.width ?? raw?.naturalWidth ?? image?.naturalWidth ?? image?.width);
  const height = toPositiveNumber(raw?.height ?? raw?.naturalHeight ?? image?.naturalHeight ?? image?.height);
  if (!image || !width || !height) throw new Error(`加载结果缺少可用尺寸：${url}`);
  const bytes = typeof raw?.bytes === 'number' && raw.bytes >= 0 ? raw.bytes : width * height * 4;
  return { image, width, height, bytes };
}

function firstFrameName(atlas) {
  const frames = atlas?.frames;
  if (!frames || typeof frames !== 'object') return null;
  const keys = Object.keys(frames);
  return keys.length ? keys[0] : null;
}

export class SpritePipeline {
  constructor({
    manifestUrl = DEFAULT_MANIFEST_URL,
    dpr = 1,
    loader = null,
    loadJson = null,
    concurrency = DEFAULT_CONCURRENCY,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    warn = null,
  } = {}) {
    this.manifestUrl = manifestUrl;
    this.dpr = normalizeDeviceDpr(dpr);
    this.loader = typeof loader === 'function' ? loader : createImageLoader();
    this.loadJson = typeof loadJson === 'function' ? loadJson : fetchJson;
    this.concurrency = Math.max(1, Math.floor(toPositiveNumber(concurrency)) || DEFAULT_CONCURRENCY);
    this.timeoutMs = Math.max(1, Math.floor(toPositiveNumber(timeoutMs)) || DEFAULT_TIMEOUT_MS);
    // maxBytes <= 0 表示不设上限（调试/测试用）。
    this.maxBytes = typeof maxBytes === 'number' && Number.isFinite(maxBytes) ? maxBytes : DEFAULT_MAX_BYTES;
    this.warnFn = typeof warn === 'function' ? warn : (message) => console.warn(message);

    this.entries = [];
    this.atlasSpecs = {};
    this.records = new Map();
    this.atlases = new Map();
    this.cache = new Map();
    this.queue = [];
    this.active = 0;
    this.running = new Set();
    this.warned = new Set();
    this.disposed = false;
    this.manifestLoaded = false;
    this.drain = null;
    this.onProgress = null;
  }

  // 预载全部 status:ready 条目。永不 reject：单条失败只影响该 id。
  async preload(onProgress = null) {
    if (typeof onProgress === 'function') this.onProgress = onProgress;
    if (this.disposed) return this.stats();
    try {
      await this.ensureManifest();
      this.requeuePending();
      await this.drainQueue();
      await this.enforceBudget();
    } catch (error) {
      this.warnOnce('preload', `[sprites] 预载异常：${error?.message || error}`);
    }
    this.report();
    return this.stats();
  }

  // 清单只加载一次；之后的 preload 复用同一条目表（失效条目由 requeuePending 处理）。
  async ensureManifest() {
    if (this.manifestLoaded) return;
    this.manifestLoaded = true;
    let raw = null;
    try {
      raw = await this.loadJson(this.manifestUrl);
    } catch (error) {
      this.warnOnce('manifest', `[sprites] 清单不可用：${error?.message || error}；全部回退程序化绘制`);
      return;
    }
    const { entries, errors } = normalizeManifest(raw);
    for (const error of errors) {
      this.warnOnce(
        `manifest:${error.index}:${error.code}`,
        `[sprites] 清单条目被忽略（${error.code}）：${error.message}`
      );
    }
    this.atlasSpecs = raw && typeof raw === 'object' && raw.atlases && typeof raw.atlases === 'object' ? raw.atlases : {};
    await this.loadAtlases(entries);
    this.entries = entries;
    for (const spec of entries) {
      if (spec.status !== 'ready' || this.records.has(spec.id)) continue;
      const record = {
        spec,
        state: 'missing',
        image: null,
        url: null,
        variant: resolveDprVariant(spec, this.dpr),
        generation: 0,
        bytes: 0,
        width: 0,
        height: 0,
      };
      this.records.set(spec.id, record);
      this.enqueue(record);
    }
  }

  async loadAtlases(entries) {
    const names = [...new Set(entries.map((entry) => entry.atlas).filter(Boolean))];
    await Promise.all(
      names.map(async (name) => {
        const spec = this.atlasSpecs[name];
        if (!spec || typeof spec.json !== 'string') {
          this.atlases.set(name, { data: null, spec: spec || null, error: new Error('图集未在清单 atlases 中声明') });
          return;
        }
        try {
          const data = await this.loadJson(spec.json);
          this.atlases.set(name, { data, spec });
        } catch (error) {
          this.atlases.set(name, { data: null, spec, error });
        }
      })
    );
  }

  // 失效后回到 pending 的条目在这里重新排队（调用方显式再 preload 一次）。
  requeuePending() {
    for (const record of this.records.values()) {
      if (record.state !== 'pending') continue;
      if (this.running.has(record)) continue;
      if (this.queue.some((task) => task.record === record)) continue;
      const url = this.urlFor(record, record.variant);
      if (!url) {
        record.state = 'failed';
        continue;
      }
      this.queue.push({ record, url, variant: record.variant, generation: record.generation });
    }
    this.pump();
  }

  urlFor(record, variant) {
    return record.spec.srcs?.[variant] || record.spec.src || null;
  }

  enqueue(record) {
    const url = this.urlFor(record, record.variant);
    if (!url) {
      this.fail(record, 'missing-url', new Error('条目没有可用 URL'), record.generation);
      return;
    }
    record.state = 'pending';
    this.queue.push({ record, url, variant: record.variant, generation: record.generation });
    this.pump();
  }

  pump() {
    if (this.disposed) return;
    while (this.active < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      this.active += 1;
      this.running.add(task.record);
      this.runTask(task);
    }
  }

  async runTask(task) {
    let timer = null;
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), this.timeoutMs);
      });
      const loaded = await Promise.race([this.load(task.url), timeout]);
      this.apply(task, loaded);
    } catch (error) {
      const code = error?.message === 'timeout' ? 'timeout' : 'load-error';
      this.fail(task.record, code, error, task.generation);
    } finally {
      if (timer) clearTimeout(timer);
      this.running.delete(task.record);
      this.active = Math.max(0, this.active - 1);
      this.pump();
      this.settleIfIdle();
      this.report();
    }
  }

  // 同一 URL 只下载一次：configure 切换 DPR 时命中缓存直接复用。
  load(url) {
    const hit = this.cache.get(url);
    if (hit) return hit.promise;
    const promise = Promise.resolve()
      .then(() => this.loader(url))
      .then((raw) => normalizeLoad(raw, url));
    const slot = { promise, result: null };
    this.cache.set(url, slot);
    promise.then(
      (result) => {
        slot.result = result;
      },
      () => {}
    );
    // 失败结果也缓存（同 URL 的其它条目快速失败），但不能留下未处理的拒绝。
    promise.catch(() => {});
    return promise;
  }

  apply(task, loaded) {
    const record = task.record;
    if (this.disposed || record.generation !== task.generation) return;
    record.image = loaded.image;
    record.width = loaded.width;
    record.height = loaded.height;
    record.bytes = loaded.bytes;
    record.url = task.url;
    record.variant = task.variant;
    record.state = 'ready';
  }

  fail(record, code, error, generation = record.generation) {
    if (this.disposed || record.generation !== generation) return;
    record.state = 'failed';
    record.image = null;
    record.bytes = 0;
    this.warnOnce(
      record.spec.id,
      `[sprites] 资源不可用（${code}）：${record.spec.id} —— ${error?.message || code}；回退程序化绘制`
    );
  }

  warnOnce(key, message) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    try {
      this.warnFn(message);
    } catch {
      /* 告警渠道异常不得影响加载流程 */
    }
  }

  drainQueue() {
    if (!this.drain) {
      let resolve = null;
      const promise = new Promise((done) => {
        resolve = done;
      });
      this.drain = { promise, resolve };
    }
    const { promise } = this.drain;
    this.pump();
    this.settleIfIdle();
    return promise;
  }

  settleIfIdle() {
    if (!this.drain || this.active > 0 || this.queue.length > 0) return;
    const { resolve } = this.drain;
    this.drain = null;
    resolve();
  }

  report() {
    if (typeof this.onProgress !== 'function') return;
    try {
      this.onProgress(this.stats());
    } catch {
      /* 进度回调异常不影响加载 */
    }
  }

  // 内存预算：先丢 @2x 改用 @1x，仍超预算则把最大的剩余条目置为 skipped。
  async enforceBudget() {
    if (!(this.maxBytes > 0)) return;
    if (this.bytes() <= this.maxBytes) return;

    const downgraded = [];
    for (const record of this.records.values()) {
      if (record.state !== 'ready' || record.variant <= 1) continue;
      if (!dprVariants(record.spec).includes(1)) continue;
      this.drop(record);
      record.generation += 1;
      record.variant = 1;
      const url = this.urlFor(record, 1);
      if (!url) {
        record.state = 'failed';
        continue;
      }
      record.state = 'pending';
      this.queue.push({ record, url, variant: 1, generation: record.generation });
      downgraded.push(record);
    }
    if (downgraded.length) {
      this.pump();
      await this.drainQueue();
    }

    while (this.bytes() > this.maxBytes) {
      const victim = [...this.records.values()]
        .filter((record) => record.state === 'ready')
        .sort((a, b) => b.bytes - a.bytes)[0];
      // 字节数为 0 的条目无法再释放内存，继续循环只会空转。
      if (!victim || !(victim.bytes > 0)) break;
      this.drop(victim);
      victim.state = 'skipped';
      this.warnOnce(victim.spec.id, `[sprites] 内存预算不足，跳过：${victim.spec.id}；回退程序化绘制`);
    }
  }

  // 释放单条目的图片引用与字节计数，并清掉该条目所有变体 URL 的缓存（下次加载会重新取）。
  drop(record) {
    for (const url of Object.values(record.spec.srcs || {})) this.cache.delete(url);
    if (record.url) this.cache.delete(record.url);
    this.release(record);
  }

  // 只释放引用、保留缓存：DPR 切回旧档时直接复用已下载的 URL。
  release(record) {
    record.image = null;
    record.bytes = 0;
    record.width = 0;
    record.height = 0;
    record.url = null;
  }

  // 预算按「解码后的唯一图片」计：图集条目共享同一张 PNG（每条只切不同 frame），
  // 逐条目累加会把同一张图重复算 N 次，内存预算因此误判并成批跳帧。
  bytes() {
    const seen = new Set();
    let total = 0;
    for (const record of this.records.values()) {
      if (record.state !== 'ready' || !record.image) continue;
      const key = record.url || record.image;
      if (seen.has(key)) continue;
      seen.add(key);
      total += record.bytes;
    }
    return total;
  }

  // DPR 变化只重选变体：已缓存的 URL 直接复用，不重复下载。
  configure({ dpr } = {}) {
    if (this.disposed) return Promise.resolve(this.stats());
    const next = normalizeDeviceDpr(dpr);
    if (next === this.dpr) return Promise.resolve(this.stats());
    this.dpr = next;

    for (const record of this.records.values()) {
      if (record.state === 'skipped') continue;
      const want = resolveDprVariant(record.spec, next);
      if (want === record.variant && record.state !== 'missing') continue;
      if (record.state === 'failed' && want === record.variant) continue;
      this.switchVariant(record, want);
    }

    if (!this.queue.length) return Promise.resolve(this.stats());
    this.pump();
    return this.drainQueue().then(() => this.stats());
  }

  switchVariant(record, variant) {
    if (record.variant !== variant) this.release(record);
    record.variant = variant;
    record.generation += 1;
    const url = this.urlFor(record, variant);
    if (!url) {
      record.state = 'failed';
      return;
    }
    // 已下载过的 URL：直接接管结果，不再发起请求。
    const cached = this.cache.get(url)?.result;
    if (cached) {
      record.image = cached.image;
      record.width = cached.width;
      record.height = cached.height;
      record.bytes = cached.bytes;
      record.url = url;
      record.state = 'ready';
      return;
    }
    record.state = 'pending';
    this.queue.push({ record, url, variant, generation: record.generation });
  }

  // 缓存失效：回到 pending 并递增 generation，失效前发出的结果回来也不会被采纳。
  invalidate(id) {
    const record = this.records.get(id);
    if (!record || this.disposed) return false;
    this.drop(record);
    record.generation += 1;
    record.state = 'pending';
    return true;
  }

  frame(id) {
    if (this.disposed) return null;
    const record = this.records.get(id);
    if (!record || record.state !== 'ready' || !record.image) return null;
    return this.geometry(record);
  }

  geometry(record) {
    const scale = record.variant;
    const spec = record.spec;
    if (spec.atlas) {
      const atlas = this.atlases.get(spec.atlas);
      if (!atlas?.data) return null;
      const frame = atlasFrame(atlas.data, spec.frame || firstFrameName(atlas.data));
      if (!frame) return null;
      return {
        image: record.image,
        sx: frame.sx * scale,
        sy: frame.sy * scale,
        sw: frame.sw * scale,
        sh: frame.sh * scale,
        dw: frame.sourceW * scale,
        dh: frame.sourceH * scale,
        ax: frame.ax * scale,
        ay: frame.ay * scale,
        variantDpr: scale,
        trimmed: frame.trimmed,
        mode: 'atlas',
      };
    }
    const width = record.width;
    const height = record.height;
    if (!(width > 0) || !(height > 0)) return null;
    const pivot = spec.pivot;
    return {
      image: record.image,
      sx: 0,
      sy: 0,
      sw: width,
      sh: height,
      dw: width,
      dh: height,
      ax: pivot.x * width,
      ay: pivot.y * height,
      variantDpr: scale,
      trimmed: false,
      mode: 'image',
    };
  }

  // (x, y) 是 pivot 落点：本函数只做一次 drawImage，返回是否真的画了。
  // 未就绪 / 未知 / 失败一律返回 false 且不发起任何绘制调用。
  draw(ctx, id, x, y, { scale = 1, alpha = 1, rotation = 0 } = {}) {
    const frame = this.frame(id);
    if (!frame || !ctx) return false;
    const sizeScale = typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : 1;
    const ratio = sizeScale / frame.variantDpr;
    const dw = frame.dw * ratio;
    const dh = frame.dh * ratio;
    const ax = frame.ax * ratio;
    const ay = frame.ay * ratio;
    const turn = typeof rotation === 'number' && Number.isFinite(rotation) ? rotation : 0;
    const opacity = typeof alpha === 'number' && Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
    const muted = opacity !== 1;
    const wrapped = muted || turn !== 0;
    if (wrapped) ctx.save();
    if (muted) ctx.globalAlpha = opacity;
    if (turn !== 0) {
      ctx.translate(x, y);
      ctx.rotate(turn);
      if (frame.mode === 'image') {
        ctx.drawImage(frame.image, -ax, -ay, dw, dh);
      } else {
        ctx.drawImage(frame.image, frame.sx, frame.sy, frame.sw, frame.sh, -ax, -ay, dw, dh);
      }
    } else if (frame.mode === 'image') {
      ctx.drawImage(frame.image, x - ax, y - ay, dw, dh);
    } else {
      ctx.drawImage(frame.image, frame.sx, frame.sy, frame.sw, frame.sh, x - ax, y - ay, dw, dh);
    }
    if (wrapped) ctx.restore();
    return true;
  }

  stats() {
    const out = { total: 0, ready: 0, failed: 0, skipped: 0, pending: 0, bytes: 0, inFlight: this.active };
    for (const record of this.records.values()) {
      out.total += 1;
      if (record.state === 'ready') {
        out.ready += 1;
        out.bytes += record.bytes;
      } else if (record.state === 'failed') {
        out.failed += 1;
      } else if (record.state === 'skipped') {
        out.skipped += 1;
      } else if (record.state === 'pending') {
        out.pending += 1;
      }
    }
    return out;
  }

  dispose() {
    this.disposed = true;
    this.queue.length = 0;
    this.records.clear();
    this.cache.clear();
    this.atlases.clear();
    this.entries = [];
    this.atlasSpecs = {};
    this.settleIfIdle();
  }
}
