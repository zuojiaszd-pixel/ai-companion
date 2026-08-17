'use strict';
const assert = require('assert');
const { buildActiveMemoryFilter, getPriorityBoost } = require('../services/memory');

// 检索候选必须只包含当前有效版本，并保留归档/矛盾排除条件。
assert.deepStrictEqual(buildActiveMemoryFilter('rinka'), {
    sessionId: 'rinka',
    supersededBy: null,
    contradicted: false,
    archived: false
});

// 常驻卡片排除条件不能误伤普通记忆。
assert.deepStrictEqual(buildActiveMemoryFilter('rinka', { excludeResident: true }), {
    sessionId: 'rinka',
    supersededBy: null,
    contradicted: false,
    archived: false,
    $or: [
        { kind: { $ne: 'core' } },
        { priority: { $ne: 'critical' } }
    ]
});

assert.strictEqual(getPriorityBoost('critical'), 0.3);
assert.strictEqual(getPriorityBoost('high'), 0.15);
assert.strictEqual(getPriorityBoost('normal'), 0);
assert.strictEqual(getPriorityBoost('low'), -0.1);
assert.strictEqual(getPriorityBoost('unknown'), 0);

console.log('memory-recall-filter tests passed');
