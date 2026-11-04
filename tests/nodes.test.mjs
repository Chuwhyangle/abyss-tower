import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BASELINE_ENEMIES,
  CHAPTERS,
  chapterForWave,
  normalizeTheme,
} from '../public/js/shared/chapters.js';
import { generateWave, selectBossVariant } from '../public/js/shared/waves.js';
import { MAX_WAVE } from '../public/js/shared/data.js';

const SEED = 'nodes-ref-seed';
const HERE = path.dirname(fileURLToPath(import.meta.url));

// 阶段 0 现状快照：chapters 未开启时的 generateWave 输出（普通/首领/最终/难度/修饰/无尽）。
// 用于证明「chapters=false 与现状逐字节一致」——一旦这里红，说明默认路径被改动了。
const REFERENCE = {
  "1:standard:std:plain": {
    "index": 1,
    "difficulty": "standard",
    "groups": [
      {
        "type": "grunt",
        "count": 5,
        "interval": 0.62,
        "delay": 0.3,
        "hpMul": 1.22,
        "portal": 0
      }
    ],
    "hpMul": 1.22,
    "speedMul": 1.016,
    "countMul": 1.04,
    "reward": 23,
    "boss": false,
    "bossVariant": null,
    "finalBoss": false,
    "totalCount": 5,
    "portals": [
      0
    ],
    "modifierId": null,
    "label": "第 1 波"
  },
  "5:standard:std:plain": {
    "index": 5,
    "difficulty": "standard",
    "groups": [
      {
        "type": "boss",
        "count": 1,
        "interval": 3,
        "delay": 0.4,
        "hpMul": 1.852,
        "portal": 0
      },
      {
        "type": "grunt",
        "count": 10,
        "interval": 0.5,
        "delay": 1.6,
        "portal": 0
      }
    ],
    "hpMul": 2.286,
    "speedMul": 1.04,
    "countMul": 1.04,
    "reward": 35,
    "boss": true,
    "bossVariant": "armored",
    "finalBoss": false,
    "totalCount": 11,
    "portals": [
      0
    ],
    "modifierId": null,
    "label": "首领波次"
  },
  "7:standard:std:plain": {
    "index": 7,
    "difficulty": "standard",
    "groups": [
      {
        "type": "grunt",
        "count": 6,
        "interval": 0.62,
        "delay": 0.3,
        "hpMul": 3.129500326158179,
        "portal": 0
      },
      {
        "type": "shielder",
        "count": 2,
        "interval": 1.25,
        "delay": 3.013916800543666,
        "hpMul": 3.129500326158179,
        "portal": 0
      }
    ],
    "hpMul": 3.13,
    "speedMul": 1.052,
    "countMul": 1.04,
    "reward": 41,
    "boss": false,
    "bossVariant": null,
    "finalBoss": false,
    "totalCount": 8,
    "portals": [
      0
    ],
    "modifierId": null,
    "label": "第 7 波"
  },
  "16:standard:std:plain": {
    "index": 16,
    "difficulty": "standard",
    "groups": [
      {
        "type": "tank",
        "count": 3,
        "interval": 1.15,
        "delay": 0.3,
        "hpMul": 12.857240181135,
        "portal": 0
      },
      {
        "type": "grunt",
        "count": 5,
        "interval": 0.62,
        "delay": 2.0007883980870247,
        "hpMul": 12.857240181135,
        "portal": 0
      },
      {
        "type": "wraith",
        "count": 3,
        "interval": 0.8,
        "delay": 4.741945281997323,
        "hpMul": 12.857240181135,
        "portal": 0
      },
      {
        "type": "caster",
        "count": 2,
        "interval": 1.3,
        "delay": 6.070938251819462,
        "hpMul": 12.857240181135,
        "portal": 0
      }
    ],
    "hpMul": 12.857,
    "speedMul": 1.107,
    "countMul": 1.04,
    "reward": 68,
    "boss": false,
    "bossVariant": null,
    "finalBoss": false,
    "totalCount": 13,
    "portals": [
      0
    ],
    "modifierId": null,
    "label": "第 16 波"
  },
  "30:standard:std:plain": {
    "index": 30,
    "difficulty": "standard",
    "groups": [
      {
        "type": "boss",
        "count": 1,
        "interval": 3,
        "delay": 0.4,
        "hpMul": 50.322,
        "portal": 0
      },
      {
        "type": "grunt",
        "count": 31,
        "interval": 0.5,
        "delay": 1.6,
        "portal": 0
      },
      {
        "type": "flyer",
        "count": 15,
        "interval": 0.8,
        "delay": 6,
        "portal": 0
      },
      {
        "type": "tank",
        "count": 5,
        "interval": 1.6,
        "delay": 9,
        "portal": 0
      },
      {
        "type": "shielder",
        "count": 2,
        "interval": 1.5,
        "delay": 11,
        "portal": 0
      },
      {
        "type": "caster",
        "count": 1,
        "interval": 1.7,
        "delay": 13,
        "portal": 0
      }
    ],
    "hpMul": 115.811,
    "speedMul": 1.192,
    "countMul": 1.04,
    "reward": 110,
    "boss": true,
    "bossVariant": "berserk",
    "finalBoss": true,
    "totalCount": 55,
    "portals": [
      0
    ],
    "modifierId": null,
    "label": "最终首领"
  },
  "12:abyss:std:plain": {
    "index": 12,
    "difficulty": "abyss",
    "groups": [
      {
        "type": "splitter",
        "count": 3,
        "interval": 1,
        "delay": 0.3,
        "hpMul": 8.435983823124598,
        "portal": 0
      },
      {
        "type": "grunt",
        "count": 6,
        "interval": 0.62,
        "delay": 2.2575109760276972,
        "hpMul": 8.435983823124598,
        "portal": 0
      },
      {
        "type": "healer",
        "count": 2,
        "interval": 1.5,
        "delay": 4.71958608366549,
        "hpMul": 8.435983823124598,
        "portal": 0
      }
    ],
    "hpMul": 8.436,
    "speedMul": 1.126,
    "countMul": 1.12,
    "reward": 56,
    "boss": false,
    "bossVariant": null,
    "finalBoss": false,
    "totalCount": 11,
    "portals": [
      0
    ],
    "modifierId": null,
    "label": "第 12 波"
  },
  "7:standard:std:mod": {
    "index": 7,
    "difficulty": "standard",
    "groups": [
      {
        "type": "grunt",
        "count": 6,
        "interval": 0.62,
        "delay": 0.3,
        "hpMul": 3.7554003913898146,
        "portal": 1
      },
      {
        "type": "shielder",
        "count": 2,
        "interval": 1.25,
        "delay": 3.013916800543666,
        "hpMul": 3.7554003913898146,
        "portal": 1
      }
    ],
    "hpMul": 3.755,
    "speedMul": 0.947,
    "countMul": 1.04,
    "reward": 41,
    "boss": false,
    "bossVariant": null,
    "finalBoss": false,
    "totalCount": 8,
    "portals": [
      1
    ],
    "modifierId": "chaos",
    "label": "第 7 波"
  },
  "40:standard:endless:plain": {
    "index": 40,
    "difficulty": "standard",
    "groups": [
      {
        "type": "boss",
        "count": 3,
        "interval": 3,
        "delay": 0.4,
        "hpMul": 71.442,
        "portal": 0
      },
      {
        "type": "grunt",
        "count": 40,
        "interval": 0.5,
        "delay": 1.6,
        "portal": 0
      },
      {
        "type": "flyer",
        "count": 18,
        "interval": 0.8,
        "delay": 6,
        "portal": 0
      },
      {
        "type": "tank",
        "count": 6,
        "interval": 1.6,
        "delay": 9,
        "portal": 0
      },
      {
        "type": "shielder",
        "count": 2,
        "interval": 1.5,
        "delay": 11,
        "portal": 0
      },
      {
        "type": "caster",
        "count": 1,
        "interval": 1.7,
        "delay": 13,
        "portal": 0
      }
    ],
    "hpMul": 556.684,
    "speedMul": 1.252,
    "countMul": 1.04,
    "reward": 140,
    "boss": true,
    "bossVariant": "summoner",
    "finalBoss": false,
    "totalCount": 70,
    "portals": [
      0
    ],
    "modifierId": null,
    "endless": true,
    "bossAffixes": {
      "shield": 2,
      "split": 1,
      "frenzy": 1
    },
    "bossAffixText": "渊盾×2·裂变×1·狂暴×1",
    "label": "深渊首领·渊盾×2·裂变×1·狂暴×1"
  }
};

const chaptersSource = fs.readFileSync(path.join(HERE, '../public/js/shared/chapters.js'), 'utf8');

test('章节表：6 节点覆盖 1..30 无重叠无缺口', () => {
  assert.equal(CHAPTERS.length, 6);
  assert.deepEqual(
    CHAPTERS.map((c) => c.id),
    ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6']
  );
  for (let w = 1; w <= MAX_WAVE; w++) {
    const owners = CHAPTERS.filter((c) => w >= c.waves[0] && w <= c.waves[1]);
    assert.equal(owners.length, 1, `第 ${w} 波应恰好属于一个节点`);
  }
  assert.deepEqual(CHAPTERS[0].waves, [1, 5]);
  assert.deepEqual(CHAPTERS[5].waves, [26, 30]);
  for (const c of CHAPTERS) {
    assert.equal(typeof c.id, 'string');
    assert.equal(typeof c.name, 'string');
    assert.equal(c.waves[1] - c.waves[0], 4);
    assert.equal(typeof c.theme.hpMul, 'number');
    assert.equal(typeof c.theme.speedMul, 'number');
    assert.ok(Array.isArray(c.enemyPool));
    assert.ok(['armored', 'summoner', 'berserk'].includes(c.bossVariant));
    // 每个节点基线 ∪ 主题敌人池 ≥ 3 类型（生效波敌人池不下塌）。
    const types = new Set([...BASELINE_ENEMIES, ...c.enemyPool]);
    assert.ok(types.size >= 3, `${c.id} 生效敌人池类型不足 3`);
  }
});

test('chapterForWave：区间反查纯函数', () => {
  const boundaries = {
    1: 'ch1', 5: 'ch1',
    6: 'ch2', 10: 'ch2',
    11: 'ch3', 15: 'ch3',
    16: 'ch4', 20: 'ch4',
    21: 'ch5', 25: 'ch5',
    26: 'ch6', 30: 'ch6',
  };
  for (const [wave, id] of Object.entries(boundaries)) {
    assert.equal(chapterForWave(Number(wave)).id, id);
  }
  assert.equal(chapterForWave(0), null);
  assert.equal(chapterForWave(31), null);
  assert.equal(chapterForWave(999), null);
  assert.strictEqual(chapterForWave(12), chapterForWave(12));
});

test('chapterForWave：纯函数无 RNG 无 IO', () => {
  assert.ok(!chaptersSource.includes('Math.random'));
  assert.ok(!chaptersSource.includes("from './rng.js'"));
  assert.ok(!chaptersSource.includes('new RNG'));
});

test('normalizeTheme：缺省字段回落 1.0', () => {
  assert.deepEqual(normalizeTheme({ hpMul: 1.2, speedMul: 0.9 }), { hpMul: 1.2, speedMul: 0.9 });
  assert.deepEqual(normalizeTheme({ hpMul: 1.1 }), { hpMul: 1.1, speedMul: 1 });
  assert.deepEqual(normalizeTheme({}), { hpMul: 1, speedMul: 1 });
  assert.deepEqual(normalizeTheme(null), { hpMul: 1, speedMul: 1 });
});

test('generateWave：chapters 默认关闭且与现状逐字节一致', () => {
  for (let w = 1; w <= MAX_WAVE; w++) {
    const def = generateWave(SEED, w);
    const off = generateWave(SEED, w, 'standard', {}, { chapters: false });
    assert.deepEqual(def, off, `第 ${w} 波 chapters=false 与默认不一致`);
    assert.equal('chapterId' in def, false, `第 ${w} 波默认输出不应含 chapterId`);
  }
  for (const [key, expected] of Object.entries(REFERENCE)) {
    const [wave, difficulty, mode, meta] = key.split(':');
    const mapMeta =
      meta === 'mod'
        ? { modifier: { id: 'chaos', hpMul: 1.2, speedMul: 0.9 }, portalCount: 2 }
        : {};
    const opts = mode === 'endless' ? { endless: true } : {};
    assert.deepEqual(
      generateWave(SEED, Number(wave), difficulty, mapMeta, opts),
      expected,
      `快照 ${key} 与现状不一致`
    );
  }
});

test('generateWave：chapters=true 主题 hpMul/speedMul 折叠进既有乘点', () => {
  for (let w = 1; w <= MAX_WAVE; w++) {
    const base = generateWave(SEED, w);
    const on = generateWave(SEED, w, 'standard', {}, { chapters: true });
    const chapter = chapterForWave(w);
    assert.equal(on.chapterId, chapter.id, `第 ${w} 波 chapterId`);
    assert.ok(
      Math.abs(on.hpMul - base.hpMul * chapter.theme.hpMul) <= 0.002,
      `第 ${w} 波 hpMul 未按 theme.hpMul 折叠`
    );
    assert.ok(
      Math.abs(on.speedMul - base.speedMul * chapter.theme.speedMul) <= 0.002,
      `第 ${w} 波 speedMul 未按 theme.speedMul 折叠`
    );
  }
  // 首领血量（boss group 的 hpMul）同样折叠 theme.hpMul。
  for (const w of [5, 10, 15, 20, 25]) {
    const bossHpOf = (wave, opts) =>
      generateWave(SEED, wave, 'standard', {}, opts).groups.find((g) => g.type === 'boss').hpMul;
    const theme = chapterForWave(w).theme.hpMul;
    assert.ok(
      Math.abs(bossHpOf(w, { chapters: true }) - bossHpOf(w, {}) * theme) <= 0.002,
      `第 ${w} 波首领血量未折叠`
    );
  }
});

test('generateWave：chapters=true 敌人池过滤到节点主题', () => {
  for (let w = 1; w <= MAX_WAVE; w++) {
    if (w % 5 === 0) continue; // 首领波混入的机制型敌人是既有硬编码，不参与主题池过滤。
    const allowed = new Set([...BASELINE_ENEMIES, ...chapterForWave(w).enemyPool]);
    const on = generateWave(SEED, w, 'standard', {}, { chapters: true });
    for (const g of on.groups) {
      assert.ok(allowed.has(g.type), `第 ${w} 波混入非主题敌人 ${g.type}`);
    }
  }
  // 负向对照：ch2（6-9）不得出现 tank（非基线且非 ch2 主题）。
  for (let w = 6; w <= 9; w++) {
    const types = generateWave(SEED, w, 'standard', {}, { chapters: true }).groups.map((g) => g.type);
    assert.ok(!types.includes('tank'), `第 ${w} 波混入 tank`);
  }
  // 生效波敌人池 ≥ 3 类型（wanted ≥ 3 时群组确实铺出 ≥ 3 种敌人）。
  for (const w of [12, 17, 22, 27]) {
    const types = generateWave(SEED, w, 'standard', {}, { chapters: true }).groups.map((g) => g.type);
    assert.ok(new Set(types).size >= 3, `第 ${w} 波敌人类型不足 3`);
  }
});

test('generateWave：chapters=true 首领变体覆盖且最终波强制 berserk', () => {
  for (const w of [5, 10, 15, 20, 25]) {
    const on = generateWave(SEED, w, 'standard', {}, { chapters: true });
    const chapter = chapterForWave(w);
    assert.equal(on.bossVariant, chapter.bossVariant, `第 ${w} 波首领变体未覆盖`);
    assert.equal(chapter.bossVariant, selectBossVariant(w), `第 ${w} 波章节变体与轮换未对齐`);
  }
  const final = generateWave(SEED, MAX_WAVE, 'standard', {}, { chapters: true });
  assert.equal(final.bossVariant, 'berserk');
  assert.equal(final.finalBoss, true);
});

test('确定性：chapters 开关不引入新 RNG、同输入同输出', () => {
  for (const w of [1, 7, 12, 20, 25, 30]) {
    assert.deepEqual(
      generateWave(SEED, w, 'standard', {}, { chapters: true }),
      generateWave(SEED, w, 'standard', {}, { chapters: true })
    );
    assert.deepEqual(generateWave(SEED, w), generateWave(SEED, w));
  }
});
