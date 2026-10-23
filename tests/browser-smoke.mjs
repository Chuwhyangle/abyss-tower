// 无头浏览器冒烟：选难度 → 建塔 → 开波。使用隔离服务端与临时数据库。
// 用法：node tests/browser-smoke.mjs
import path from 'node:path';
import {
  startTestServer,
  launchBrowser,
  chooseFirstMap,
  registerAndLogin,
} from './harness.mjs';

const OUT_DIR = process.env.OUT_DIR || '/tmp';

async function main() {
  const server = await startTestServer();
  const session = await registerAndLogin(server.base);
  let browser = null;
  try {
    browser = await launchBrowser({
      base: server.base,
      name: 'rtd-smoke',
      cookie: session.rawCookie,
    });

    const bootErrors = await browser.evaluate(`window.__bootErrors || []`);
    if (bootErrors.length) throw new Error(`页面启动错误：${bootErrors.join(' | ')}`);
    await browser.screenshot(path.join(OUT_DIR, 'rtd-01-title.png'));

    // 标题页技能卡：3 个技能、等级 Ⅰ–Ⅹ、选中态可切换。
    await browser.waitFor(`document.querySelectorAll('#title-skills .skill-card').length === 3`, '标题页技能卡');
    const titleSkills = await browser.evaluate(`
      (() => {
        const cards = [...document.querySelectorAll('#title-skills .skill-card')];
        return {
          count: cards.length,
          selected: document.querySelector('#title-skills .skill-card.selected')?.dataset.skill || null,
          levels: cards.map((card) => card.querySelector('.skill-level')?.textContent || ''),
          locked: cards.filter((card) => card.classList.contains('locked')).length,
        };
      })()
    `);
    if (titleSkills.count !== 3) throw new Error(`技能卡数量异常：${titleSkills.count}`);
    if (!titleSkills.selected) throw new Error('标题页没有默认选中的技能');
    if (titleSkills.levels.some((level) => !level)) throw new Error('技能等级未渲染');

    await browser.evaluate(`document.querySelector('#btn-play').click()`);
    await browser.waitFor(`!!document.querySelector('.difficulty-modal')`, '难度弹窗');
    const diffSkills = await browser.evaluate(`
      (() => ({
        chips: document.querySelectorAll('.difficulty-modal .skill-chip').length,
        selected: document.querySelector('.difficulty-modal .skill-chip.selected')?.dataset.skill || null,
      }))()
    `);
    if (diffSkills.chips !== 3) throw new Error(`难度弹窗技能条异常：${diffSkills.chips}`);
    // 显式选择极光（初始解锁），并验证记忆写入 localStorage。
    await browser.evaluate(`document.querySelector('.skill-chip[data-skill="aurora"]').click()`);
    const remembered = await browser.evaluate(`localStorage.getItem('abyss-tower.skill.selected.v1')`);
    if (!remembered || !remembered.includes('aurora')) {
      throw new Error(`技能选择未写入本地：${remembered}`);
    }
    await browser.screenshot(path.join(OUT_DIR, 'rtd-02-difficulty.png'));

    await browser.evaluate(`document.querySelector('.diff-card[data-id="roam"]').click()`);
    await chooseFirstMap(browser);
    await browser.waitFor(
      `document.getElementById('game-screen').hidden === false`,
      '战斗界面'
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    await browser.screenshot(path.join(OUT_DIR, 'rtd-03-game.png'));

    // 整备阶段：按钮置灰并提示“战斗中可用”。
    const prepSkill = await browser.evaluate(`
      (() => {
        const btn = document.getElementById('btn-skill');
        return {
          hidden: btn.hidden,
          state: btn.dataset.state,
          idle: btn.classList.contains('idle'),
          title: btn.title,
        };
      })()
    `);
    if (prepSkill.hidden) throw new Error('整备阶段技能按钮未显示');
    if (prepSkill.state !== 'prep' || !prepSkill.idle) {
      throw new Error(`整备阶段按钮未置灰：${JSON.stringify(prepSkill)}`);
    }
    if (!prepSkill.title.includes('战斗中可用')) {
      throw new Error(`整备阶段缺少提示：${prepSkill.title}`);
    }

    const setup = await browser.evaluate(`
      (() => {
        const sim = window.__rtd.state.sim;
        const map = sim.map;
        let cell = null;
        for (const p of map.pathCells) {
          for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const c = p.c + dc, r = p.r + dr;
            if (map.buildable[r]?.[c] && !sim.towerAt(c, r)) { cell = { c, r }; break; }
          }
          if (cell) break;
        }
        if (!cell) return { error: '没有可建造格' };
        document.querySelector('.tower-card[data-type="arrow"]').click();
        const rect = document.querySelector('#game-canvas').getBoundingClientRect();
        return {
          cell,
          x: rect.left + ((cell.c + 0.5) / map.cols) * rect.width,
          y: rect.top + ((cell.r + 0.5) / map.rows) * rect.height,
          diff: sim.difficulty,
          gold: sim.gold,
        };
      })()
    `);
    if (!setup || setup.error) throw new Error(setup?.error || '无法定位建造格');

    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: setup.x, y: setup.y });
    await browser.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: setup.x, y: setup.y, button: 'left', clickCount: 1,
    });
    await browser.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: setup.x, y: setup.y, button: 'left', clickCount: 1,
    });

    const towerCount = await browser.evaluate(`window.__rtd.state.sim.towers.length`);
    if (towerCount !== 1) throw new Error(`建塔失败，towers=${towerCount}`);
    await browser.screenshot(path.join(OUT_DIR, 'rtd-04-built.png'));

    await browser.evaluate(`document.querySelector('.speed-btn[data-speed="3"]').click()`);
    await browser.evaluate(`document.querySelector('#btn-next-wave').click()`);
    await browser.waitFor(`window.__rtd.state.sim.phase === 'wave'`, '波次开始');
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await browser.screenshot(path.join(OUT_DIR, 'rtd-05-battle.png'));

    const battle = await browser.evaluate(`
      (() => {
        const sim = window.__rtd.state.sim;
        return {
          wave: sim.wave,
          phase: sim.phase,
          enemies: sim.enemies.length,
          towers: sim.towers.length,
          gold: Math.floor(sim.gold),
          hp: Math.ceil(sim.baseHp),
          kills: sim.kills,
          difficulty: sim.difficulty,
        };
      })()
    `);
    if (battle.wave !== 1) throw new Error(`波次异常：${battle.wave}`);
    if (battle.towers < 1) throw new Error('塔数量异常');
    if (battle.difficulty !== 'roam') throw new Error(`难度异常：${battle.difficulty}`);

    // 局内技能按钮：存在、可见、触控尺寸 ≥48px。
    const skillButton = await browser.evaluate(`
      (() => {
        const sim = window.__rtd.state.sim;
        const btn = document.getElementById('btn-skill');
        const rect = btn.getBoundingClientRect();
        return {
          skill: sim.skill ? { id: sim.skill.id, level: sim.skill.level, cooldown: sim.skill.cooldown } : null,
          hidden: btn.hidden,
          state: btn.dataset.state,
          width: rect.width,
          height: rect.height,
        };
      })()
    `);
    if (!skillButton.skill) throw new Error('本局未注入技能（服务端 ruleset 缺失）');
    if (skillButton.skill.id !== 'aurora') throw new Error(`技能注入错误：${skillButton.skill.id}`);
    if (skillButton.hidden) throw new Error('技能按钮未显示');
    if (skillButton.width < 48 || skillButton.height < 48) {
      throw new Error(`技能按钮过小：${skillButton.width}x${skillButton.height}`);
    }

    // Q 释放 → 冷却可见 → 冷却中再次按下无效。
    const pressQ = async () => {
      await browser.send('Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'q', code: 'KeyQ', windowsVirtualKeyCode: 81, nativeVirtualKeyCode: 81,
      });
      await browser.send('Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'q', code: 'KeyQ', windowsVirtualKeyCode: 81, nativeVirtualKeyCode: 81,
      });
    };

    await pressQ();
    await browser.waitFor(
      `(() => { const s = window.__rtd.state.sim; return s.skillCastCount === 1 && s.skill.cooldown > 0; })()`,
      'Q 释放技能',
      5000
    );
    const afterCast = await browser.evaluate(`
      (() => {
        const sim = window.__rtd.state.sim;
        const btn = document.getElementById('btn-skill');
        return {
          casts: sim.skillCastCount,
          cooldown: sim.skill.cooldown,
          state: btn.dataset.state,
          countText: document.getElementById('skill-count').textContent,
          ready: btn.classList.contains('ready'),
        };
      })()
    `);
    if (afterCast.state !== 'cooling') throw new Error(`冷却态未显示：${afterCast.state}`);
    if (!(afterCast.cooldown > 0)) throw new Error('技能冷却未开始');
    if (!afterCast.countText) throw new Error('冷却秒数未显示');

    await pressQ();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const afterSecond = await browser.evaluate(`
      (() => {
        const sim = window.__rtd.state.sim;
        return { casts: sim.skillCastCount, cooldown: sim.skill.cooldown };
      })()
    `);
    if (afterSecond.casts !== afterCast.casts) throw new Error('冷却中再次释放成功（应无效）');
    if (!(afterSecond.cooldown < afterCast.cooldown)) throw new Error('冷却中释放重置了冷却');
    await browser.screenshot(path.join(OUT_DIR, 'rtd-06-skill.png'));

    // 刷新续玩：技能与剩余冷却必须从快照恢复，不清零。
    await browser.send('Page.reload', { ignoreCache: true });
    await browser.waitBoot();
    await browser.waitFor(`document.getElementById('btn-resume').hidden === false`, '继续按钮（技能冷却）');
    await browser.evaluate(`document.querySelector('#btn-resume').click()`);
    await browser.waitFor(`!!(window.__rtd && window.__rtd.state.sim)`, '续玩加载（技能冷却）');
    const restoredSkill = await browser.evaluate(`
      (() => {
        const sim = window.__rtd.state.sim;
        const btn = document.getElementById('btn-skill');
        return {
          skill: sim.skill ? { id: sim.skill.id, cooldown: sim.skill.cooldown } : null,
          hidden: btn.hidden,
          state: btn.dataset.state,
        };
      })()
    `);
    if (!restoredSkill.skill || restoredSkill.skill.id !== 'aurora') {
      throw new Error(`续玩未恢复技能：${JSON.stringify(restoredSkill.skill)}`);
    }
    if (!(restoredSkill.skill.cooldown > 0)) {
      throw new Error(`刷新后冷却被清零：${restoredSkill.skill.cooldown}`);
    }
    if (restoredSkill.hidden) throw new Error('续玩后技能按钮未恢复');

    // 无技能旧局（ruleset 为空）：按钮必须隐藏且不报错。
    const noSkill = await browser.evaluate(`
      (() => {
        const sim = window.__rtd.state.sim;
        const btn = document.getElementById('btn-skill');
        const prev = sim.skill;
        sim.skill = null;
        window.__rtd.ui.updateSkillButton();
        const hidden = btn.hidden;
        const state = btn.dataset.state;
        sim.skill = prev;
        window.__rtd.ui.updateSkillButton();
        return { hidden, state, restored: !btn.hidden };
      })()
    `);
    if (!noSkill.hidden || noSkill.state !== 'none') throw new Error('无技能局按钮未隐藏');
    if (!noSkill.restored) throw new Error('恢复技能后按钮未重新显示');

    if (browser.pageErrors.length) throw new Error(`控制台错误：${browser.pageErrors.join(' | ')}`);

    console.log('[smoke] 通过');
    console.log(JSON.stringify({
      setup, battle, titleSkills, diffSkills, prepSkill, skillButton, afterCast, afterSecond,
      restoredSkill, noSkill,
    }, null, 2));
  } finally {
    if (browser) await browser.close();
    await server.stop();
  }
}

main().catch((error) => {
  console.error(`\n[smoke] FAIL: ${error.message || error}`);
  process.exit(1);
});
