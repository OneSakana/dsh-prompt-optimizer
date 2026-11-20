/** @file 最小回归测试:node --test test.mjs。只覆盖纯函数与数据结构,不依赖 DSH 运行时。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanOutput, readSettings, Config, inject } from './index.js';
import { TEMPLATES, STRENGTHS, OUTPUT_RULES, DEFAULT_SETTINGS } from './templates.js';

test('cleanOutput: 去除代码栅栏', () => {
  assert.equal(cleanOutput('```text\n优化后的提示词\n```'), '优化后的提示词');
  assert.equal(cleanOutput('```\n优化后的提示词\n```'), '优化后的提示词');
});

test('cleanOutput: 去除成对引号包裹', () => {
  assert.equal(cleanOutput('"优化后的提示词"'), '优化后的提示词');
});

test('cleanOutput: 普通文本原样保留(仅 trim)', () => {
  assert.equal(cleanOutput('  请审查代码。  '), '请审查代码。');
});

test('cleanOutput: 空输出抛出中文错误', () => {
  assert.throws(() => cleanOutput('   '), /模型返回了空内容/);
  assert.throws(() => cleanOutput('```\n\n```'), /模型返回了空内容/);
});

test('TEMPLATES: 三种模式齐备且含安全输出规则', () => {
  for (const key of ['basic', 'professional', 'planning']) {
    assert.ok(TEMPLATES[key], `缺少模板 ${key}`);
    assert.ok(TEMPLATES[key].system.includes(OUTPUT_RULES), `${key} 模板缺少 OUTPUT_RULES`);
  }
});

test('STRENGTHS: 三档齐备且温度递增', () => {
  assert.ok(STRENGTHS.concise.temperature < STRENGTHS.balanced.temperature);
  assert.ok(STRENGTHS.balanced.temperature < STRENGTHS.detailed.temperature);
});

test('Config schema 与默认设置字段一致', () => {
  const keys = Object.keys(DEFAULT_SETTINGS).sort();
  assert.deepEqual(keys, ['followDefaultModel', 'instruction', 'model', 'provider', 'strength', 'template']);
  assert.equal(DEFAULT_SETTINGS.template, 'basic');
  assert.equal(DEFAULT_SETTINGS.strength, 'balanced');
  assert.equal(DEFAULT_SETTINGS.followDefaultModel, true);
});

test('readSettings: 无 settings 服务时回退默认值', () => {
  const r = readSettings(undefined);
  assert.equal(r.revision, 0);
  assert.deepEqual(r.value, DEFAULT_SETTINGS);
});

test('readSettings: 用户设置覆盖默认值', () => {
  const fake = {
    describe: () => [{
      ns: 'prompt-optimizer',
      revision: 7,
      value: { template: 'planning', strength: 'detailed' },
    }],
  };
  const r = readSettings(fake);
  assert.equal(r.revision, 7);
  assert.equal(r.value.template, 'planning');
  assert.equal(r.value.strength, 'detailed');
  assert.equal(r.value.followDefaultModel, true); // 未覆盖的字段取默认
});

test('readSettings: describe 抛错时静默回退', () => {
  const r = readSettings({ describe: () => { throw new Error('boom'); } });
  assert.deepEqual(r.value, DEFAULT_SETTINGS);
});

test('inject: Host 半声明命令与设置依赖', () => {
  assert.deepEqual(inject, ['commands', 'settings']);
});

test('schemastery volatile 字段可通过 Config 校验并补默认', () => {
  const parsed = Config['~standard'].validate({});
  assert.ok(!parsed.issues);
  // volatile 字段编译为 { get } 访问器,读取 get() 得到默认值
  const read = (v) => (typeof v === 'object' && v !== null && typeof v.get === 'function' ? v.get() : v);
  assert.equal(read(parsed.value.template), 'basic');
  assert.equal(read(parsed.value.strength), 'balanced');
  assert.equal(read(parsed.value.followDefaultModel), true);
});
