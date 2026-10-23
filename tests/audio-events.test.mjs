// 音效事件一致性：sim.js 发出的每个 playSound 事件都必须在 audio.js 有 case 实现。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOWERS } from '../public/js/shared/data.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, '..', rel), 'utf8');

function extractEmittedEvents(source) {
  const events = new Set();
  for (const call of source.matchAll(/playSound\(([^)]*)\)/g)) {
    const arg = call[1];
    // 字面量，包括三元表达式里的两个分支：playSound(victory ? 'victory' : 'gameover')
    for (const literal of arg.matchAll(/'([^']*)'|"([^"]*)"/g)) {
      const name = literal[1] ?? literal[2];
      if (name) events.add(name);
    }
    // 模板字面量：playSound(`shoot_${tower.type}`) 按 TOWERS 展开
    for (const template of arg.matchAll(/`([^`]*)`/g)) {
      const body = template[1];
      if (/\$\{tower\.type\}/.test(body)) {
        for (const id of Object.keys(TOWERS)) events.add(body.replace(/\$\{tower\.type\}/g, id));
      } else if (!body.includes('${')) {
        events.add(body);
      }
    }
  }
  return events;
}

function extractImplementedEvents(source) {
  const events = new Set();
  for (const match of source.matchAll(/case\s+['"]([^'"]+)['"]\s*:/g)) events.add(match[1]);
  return events;
}

test('sim.js 发出的音效事件都在 audio.js 有实现', () => {
  const emitted = extractEmittedEvents(read('public/js/sim.js'));
  const implemented = extractImplementedEvents(read('public/js/audio.js'));

  assert.ok(emitted.size > 0, '未能从 sim.js 解析出任何 playSound 事件，解析器失效');
  assert.ok(implemented.size > 0, '未能从 audio.js 解析出任何 case，解析器失效');

  const missing = [...emitted].filter((name) => !implemented.has(name)).sort();
  assert.deepEqual(missing, [], `audio.js 缺少音效实现：${missing.join(', ')}`);
});

test('通关事件 victory 确实从 sim.js 发出', () => {
  const emitted = extractEmittedEvents(read('public/js/sim.js'));
  assert.ok(emitted.has('victory'), 'sim.js 通关分支应发出 victory 音效事件');
});
