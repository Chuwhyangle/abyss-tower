// 浏览器 harness 的重试策略：只有环境类失败（CDP / 启动超时）重试一次，断言失败立即抛出。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENV_FAILURE_CODES,
  HarnessEnvError,
  classifyFailure,
  withRetry,
} from './harness.mjs';

test('classifyFailure 区分环境类失败与断言失败', () => {
  assert.deepEqual(ENV_FAILURE_CODES, ['cdp', 'timeout']);
  assert.equal(classifyFailure(new HarnessEnvError('无法连接 Chrome CDP', 'cdp')), 'cdp');
  assert.equal(classifyFailure(new HarnessEnvError('页面启动超时', 'timeout')), 'timeout');
  assert.equal(classifyFailure(new Error('技能卡数量异常：2')), 'assertion');
  assert.equal(classifyFailure(Object.assign(new Error('x'), { code: 'cdp' })), 'cdp');
  assert.equal(classifyFailure(Object.assign(new Error('x'), { code: 'other' })), 'assertion');
  assert.equal(classifyFailure(null), 'assertion');
});

test('环境类失败重试一次后成功', async () => {
  let calls = 0;
  const retries = [];
  const result = await withRetry(
    async () => {
      calls += 1;
      if (calls === 1) throw new HarnessEnvError('cdp down', 'cdp');
      return 'ok';
    },
    { onRetry: (info) => retries.push(info) }
  );
  assert.equal(result, 'ok');
  assert.equal(calls, 2);
  assert.equal(retries.length, 1);
  assert.equal(retries[0].code, 'cdp');
  assert.equal(retries[0].attempt, 1);
  assert.equal(retries[0].retries, 1);
});

test('断言失败不重试', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1;
        throw new Error('技能卡数量异常：2');
      },
      { onRetry: () => assert.fail('断言失败不应触发重试') }
    ),
    /技能卡数量异常/
  );
  assert.equal(calls, 1);
});

test('重试耗尽后仍抛出最后一次错误', async () => {
  let calls = 0;
  const error = new HarnessEnvError('cdp still down', 'cdp');
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1;
        throw error;
      },
      { onRetry: () => {} }
    ),
    (thrown) => thrown === error
  );
  assert.equal(calls, 2);
});

test('onlyOn 之外的环境码不重试', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1;
        throw new HarnessEnvError('页面启动超时', 'timeout');
      },
      { onlyOn: ['cdp'] }
    ),
    /页面启动超时/
  );
  assert.equal(calls, 1);
});

test('retries 可配置为 0（不重试）', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1;
        throw new HarnessEnvError('cdp down', 'cdp');
      },
      { retries: 0 }
    ),
    /cdp down/
  );
  assert.equal(calls, 1);
});
