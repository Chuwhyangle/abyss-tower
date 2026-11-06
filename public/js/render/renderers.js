// 渲染器注册清单：只做副作用 import，顺序即渲染层序（光晕/背景 → 实体 → 覆盖/技能/演出）。
// render.js 通过 './render/registry.js' 按 id 创建实例；本文件是唯一的「有哪些渲染器」声明处。
import './glow-renderer.js';
import './background-renderer.js';
import './portal-renderer.js';
import './tower-renderer.js';
import './enemy-renderer.js';
import './ally-renderer.js';
import './projectile-renderer.js';
import './destructible-renderer.js';
import './effect-renderer.js';
import './floater-renderer.js';
import './overlay-renderer.js';
import './skill-renderer.js';
import './culmination-renderer.js';
