'use strict';
const assert = require('assert');
const {
    buildSupersededUpdate,
    restoreMemoryVersion
} = require('../services/memory');

// 一条新记忆替代多条旧记忆时，更新条件必须完整且去重。
const replacement = buildSupersededUpdate(['old-a', 'old-a', 'old-b'], 'new-current');
assert.deepStrictEqual(replacement, {
    filter: { _id: { $in: ['old-a', 'old-b'] } },
    update: { $set: { supersededBy: 'new-current', contradicted: true } }
});
assert.strictEqual(buildSupersededUpdate([], 'new-current'), null);
assert.strictEqual(buildSupersededUpdate(['old-a'], null), null);

// 恢复接口先校验版本号，非法输入不应触碰数据库。
(async () => {
    await assert.rejects(
        () => restoreMemoryVersion('not-used', 0),
        error => error && error.code === 'INVALID_VERSION'
    );
    await assert.rejects(
        () => restoreMemoryVersion('not-used', 'abc'),
        error => error && error.code === 'INVALID_VERSION'
    );
    console.log('memory-version tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
