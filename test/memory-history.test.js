'use strict';
const assert = require('assert');
const {
    normalizeMemoryType,
    buildContentHistoryUpdate,
    extractTagsFromContent,
    parseCompoundMood
} = require('../services/memory');

assert.deepStrictEqual(normalizeMemoryType('fact'), { type: 'core', legacyType: 'fact' });
assert.deepStrictEqual(normalizeMemoryType('tech'), { type: 'tech', legacyType: null });
assert.deepStrictEqual(normalizeMemoryType('unknown'), { type: 'core', legacyType: null });
assert.deepStrictEqual(normalizeMemoryType('preference'), { type: 'core', legacyType: 'preference' });
assert.deepStrictEqual(normalizeMemoryType('tech'), { type: 'tech', legacyType: null });

// 标签提取应过滤常见虚词，并保持结果去重、数量受控
const tags = extractTagsFromContent('Rinka 学习 外贸 供应链，Rinka 练习 外贸 英文询盘邮件');
assert(tags.includes('rinka'));
assert(tags.includes('外贸'));
assert(tags.length <= 5);

assert.deepStrictEqual(parseCompoundMood('开心 + 成就感 + 开心'), ['开心', '成就感', '开心']);
assert.deepStrictEqual(parseCompoundMood(''), []);

const now = new Date('2026-08-20T12:00:00Z');
const memory = { content: '旧内容', version: 2, timeline: [] };
const first = buildContentHistoryUpdate(memory, { content: '新内容' }, now);
assert.strictEqual(first.version, 3);
assert.deepStrictEqual(first.timeline, [{ date: '2026-08-20', event: '编辑前版本 v2：旧内容' }]);

const unchanged = buildContentHistoryUpdate(memory, { title: '新标题' }, now);
assert.deepStrictEqual(unchanged, { title: '新标题' });

const already = { ...memory, timeline: first.timeline };
const duplicate = buildContentHistoryUpdate(already, { content: '另一个新内容' }, now);
assert.strictEqual(duplicate.version, 2);
assert.strictEqual(duplicate.timeline.length, 1);

console.log('memory-history tests passed');
