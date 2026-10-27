// 场景精灵接入表：四个场景（标题 / 选图 / 战斗 / 结算）的必需与可选精灵 id，
// 以及「资源是否齐全」到「是否回退程序化绘制」的纯函数映射。
//
// 边界：导入期零 DOM、零随机、不 import 模拟层与渲染层（服务端也可安全导入）。
// 权威定义见 docs/PHASE_FEEL_ART.md §4.4；本模块只持有 id 集与计划推导，
// 不决定绘制顺序、不加载图片、不自行读取设备像素比（DPR 由渲染管线的 applyDpr 决定）。

// 场景键即验收矩阵的行；顺序固定，供两视口 id 集比对时稳定输出。
export const SCENE_KEYS = Object.freeze(['title', 'map', 'combat', 'result']);

// 缺资源时的回退语言：全部退回接入前的程序化绘制。
export const SCENE_FALLBACK = 'programmatic';

// 视口 → DPR 变体的缺省档位（桌面 1x、移动 2x）。
// 实际变体仍以渲染管线的 configure({ dpr }) 为准，这里只给计划阶段的缺省值。
export const VIEWPORT_VARIANTS = Object.freeze({ desktop: 1, mobile: 2 });

// 场景精灵 id 的单一来源：manifest 条目、DOM 标记与 Canvas 绘制都从这里取，
// 避免三个模块各自写字符串字面量。命名遵循 ASSET_PIPELINE 的 `<类别>/<名称>`。
export const SCENE_SPRITE_IDS = Object.freeze({
  titleBackground: 'bg/scene-title',
  titleLogo: 'ui/scene-title-logo',
  mapCard: 'ui/scene-map-card',
  mapThumbnail: 'ui/scene-map-thumbnail',
  combatBackground: 'bg/scene-combat',
  combatHud: 'ui/scene-combat-hud',
  resultPanel: 'ui/scene-result-panel',
  titleParticles: 'fx/scene-title-particles',
  mapBadge: 'ui/scene-map-badge',
  combatAmbience: 'fx/scene-combat-ambience',
  resultBadge: 'ui/scene-result-badge',
});

const IDS = SCENE_SPRITE_IDS;

// DOM 场景的摆放样式（内联 CSS，避免场景接线依赖样式表改动）。
// 标题背景居中铺在标题卡之后；logo 放左下角，避开标题文字。
export const SCENE_SPRITE_PLACEMENT = Object.freeze({
  [SCENE_SPRITE_IDS.titleBackground]: 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);opacity:.6;',
  [SCENE_SPRITE_IDS.titleLogo]: 'position:absolute;left:24px;bottom:24px;opacity:.85;',
});

// 每个场景的必需组 / 可选组。必需组是「接入矩阵」的判定集：
// 两视口下的 id 集必须与 required 完全相等；可选组只登记在清单里，不进验收集。
function sceneSpec(id, required, optional) {
  return { id, required: [...required], optional: [...optional], fallback: SCENE_FALLBACK };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

export const SCENE_SPRITES = deepFreeze({
  title: sceneSpec('title', [IDS.titleBackground, IDS.titleLogo], [IDS.titleParticles]),
  map: sceneSpec('map', [IDS.mapCard, IDS.mapThumbnail], [IDS.mapBadge]),
  combat: sceneSpec('combat', [IDS.combatBackground, IDS.combatHud], [IDS.combatAmbience]),
  result: sceneSpec('result', [IDS.resultPanel], [IDS.resultBadge]),
});

// 未知场景一律返回 null（不抛错）：调用方据此跳过接线，保留既有程序化绘制。
export function sceneSprite(scene) {
  return typeof scene === 'string' && Object.hasOwn(SCENE_SPRITES, scene) ? SCENE_SPRITES[scene] : null;
}

// 场景的必需 id 集（includeOptional 时追加可选 id）。未知场景返回 null。
export function sceneSpriteIds(scene, { includeOptional = false } = {}) {
  const spec = sceneSprite(scene);
  if (!spec) return null;
  return includeOptional ? [...spec.required, ...spec.optional] : [...spec.required];
}

function normalizeViewport(viewport) {
  return viewport === 'mobile' ? 'mobile' : 'desktop';
}

// 把「已就绪 id」归一成 Set：接受数组 / Set / Map / 普通对象（id → 计数）。
function readySet(readyIds) {
  if (readyIds == null) return new Set();
  if (readyIds instanceof Set) return new Set(readyIds);
  if (Array.isArray(readyIds)) return new Set(readyIds.filter((id) => typeof id === 'string'));
  if (readyIds instanceof Map) return new Set(readyIds.keys());
  if (typeof readyIds === 'object') return new Set(Object.keys(readyIds));
  return new Set();
}

// 场景计划：ids 恒为必需集；assetsReady 为 null 表示「尚未知」——此时不判回退，
// 由调用方在加载结束后重算，避免首帧误标 fallback。
export function sceneSpritePlan(scene, { viewport = 'desktop', dpr = null, assetsReady = null } = {}) {
  const spec = sceneSprite(scene);
  if (!spec) return null;
  const view = normalizeViewport(viewport);
  const variant = Number.isFinite(dpr) && dpr > 0 ? (dpr >= 2 ? 2 : 1) : VIEWPORT_VARIANTS[view];
  const ready = assetsReady == null ? null : readySet(assetsReady);
  const missing = ready ? spec.required.filter((id) => !ready.has(id)) : [];
  return {
    scene: spec.id,
    viewport: view,
    ids: [...spec.required],
    optionalIds: [...spec.optional],
    fallback: spec.fallback,
    variant,
    useFallback: missing.length > 0,
    missing,
  };
}

// 该场景还缺哪些必需 id；readyIds 缺失按「一个都没就绪」处理。未知场景返回 null。
export function missingSceneSprites(scene, readyIds) {
  const spec = sceneSprite(scene);
  if (!spec) return null;
  const ready = readySet(readyIds);
  return spec.required.filter((id) => !ready.has(id));
}

// 给一段 DOM 里带 data-sprite-id 的元素套用管线读数；只处理该场景的必需 id，
// 其余标记（例如同一容器里的其它场景）原样跳过。root 由调用方创建并传入。
export function applySceneSpritesTo(root, sprites, scene) {
  const spec = sceneSprite(scene);
  if (!root || !spec || typeof root.querySelectorAll !== 'function') return [];
  const applied = [];
  for (const node of root.querySelectorAll('[data-sprite-id]')) {
    const id = node.getAttribute('data-sprite-id');
    if (!spec.required.includes(id)) continue;
    applySceneSpriteElement(node, sprites, id);
    applied.push(id);
  }
  return applied;
}

// 把某个场景精灵 id 应用到 DOM 元素（纯元素操作，不读全局 DOM）：
//   - 命中精灵：写入 data-sprite-id、以 CSS 变量 --sprite-<slug> 承载图集 URL，
//     并按管线给出的图集切帧位置设置背景；
//   - 缺资源：保留 data-sprite-id 并加 data-sprite-fallback="1"，既有样式不被覆盖。
// sprites 是注入的管线（只调用只读访问器），元素由调用方创建。
export function applySceneSpriteElement(element, sprites, id) {
  if (!element || typeof element.setAttribute !== 'function') return false;
  element.setAttribute('data-sprite-id', id);
  const style = typeof sprites?.spriteStyle === 'function' ? sprites.spriteStyle(id) : null;
  if (!style) {
    element.setAttribute('data-sprite-fallback', '1');
    if (element.style) element.style.backgroundImage = 'none';
    return false;
  }
  element.removeAttribute?.('data-sprite-fallback');
  if (!element.style) return true;
  // 变量名只保留小写字母数字：id 里的 / 与 . 不进入自定义属性名。
  const variable = `--sprite-${String(id).replace(/[^a-z0-9]+/g, '-')}`;
  element.style.setProperty(variable, style.backgroundImage);
  element.style.backgroundImage = `var(${variable})`;
  element.style.backgroundPosition = style.backgroundPosition;
  element.style.backgroundSize = style.backgroundSize;
  element.style.backgroundRepeat = 'no-repeat';
  element.style.width = `${style.width}px`;
  element.style.height = `${style.height}px`;
  return true;
}
