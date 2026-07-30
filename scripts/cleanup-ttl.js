/**
 * TTL 自动清理脚本
 * 扫描 expired 标记或 ttl 到期的技术记忆，批量删除
 * 
 * 用法: node scripts/cleanup-ttl.js [--dry-run] [--force]
 *   --dry-run  只统计，不实际删除
 *   --force    强制清理（不询问确认）
 */

const mongoose = require('mongoose');
const path = require('path');

// 加载环境变量
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Memory = require('../models/Memory');

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');

  console.log(`\n🧹 TTL 自动清理 ${dryRun ? '[DRY RUN - 仅统计]' : ''}`);
  console.log('='.repeat(50));

  // 连接数据库
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/ai-companion';
  await mongoose.connect(mongoUri);
  console.log(`📡 已连接: ${mongoUri}`);

  // ========== 统计各类可清理的记忆 ==========

  // 1. 明确标记为 expired 的
  const expiredMarked = await Memory.countDocuments({ expired: true });
  console.log(`\n📌 expired=true 标记: ${expiredMarked} 条`);

  // 2. ttl 已过期但未标记 expired 的
  const ttlExpired = await Memory.countDocuments({
    expired: false,
    ttl: { $ne: null, $lte: new Date() }
  });
  console.log(`📌 TTL 已过期未标记: ${ttlExpired} 条`);

  // 3. 按类型统计
  const byType = await Memory.aggregate([
    { $match: { $or: [{ expired: true }, { ttl: { $ne: null, $lte: new Date() } }] } },
    { $group: { _id: '$type', count: { $sum: 1 } } }
  ]);
  if (byType.length > 0) {
    console.log('\n📊 按类型分布:');
    for (const t of byType) {
      console.log(`   ${t._id || '未分类'}: ${t.count} 条`);
    }
  }

  // 4. 优先级分布
  const byPriority = await Memory.aggregate([
    { $match: { $or: [{ expired: true }, { ttl: { $ne: null, $lte: new Date() } }] } },
    { $group: { _id: '$priority', count: { $sum: 1 } } }
  ]);
  if (byPriority.length > 0) {
    console.log('\n📊 按优先级分布:');
    for (const p of byPriority) {
      console.log(`   ${p._id || '未设置'}: ${p.count} 条`);
    }
  }

  const totalCleanable = expiredMarked + ttlExpired;

  if (totalCleanable === 0) {
    console.log('\n✅ 没有需要清理的记忆');
    await mongoose.disconnect();
    return;
  }

  console.log(`\n🔢 共可清理: ${totalCleanable} 条`);

  // ========== 实际清理 ==========

  if (dryRun) {
    console.log('\n⏸  DRY RUN 模式，未执行删除');
    await mongoose.disconnect();
    return;
  }

  if (!force) {
    console.log('\n⚠️  将删除以上所有记忆。');
    console.log('   使用 --force 跳过确认，或 --dry-run 仅查看');
    console.log('   按 Ctrl+C 取消，或回车继续...');
    await new Promise(resolve => {
      process.stdin.once('data', () => resolve());
    });
  }

  // 先标记已 ttl 过期但未标记的
  const markResult = await Memory.updateMany(
    { expired: false, ttl: { $ne: null, $lte: new Date() } },
    { $set: { expired: true } }
  );
  console.log(`\n🏷  标记过期: ${markResult.modifiedCount} 条`);

  // 删除所有 expired 的记忆
  // 但保护 locked 和 critical 级别的记忆
  const toDelete = await Memory.countDocuments({
    expired: true,
    locked: { $ne: true },
    priority: { $ne: 'critical' }
  });

  if (toDelete === 0) {
    console.log('✅ 无可删除记录（可能全部被锁定或为 critical）');
    await mongoose.disconnect();
    return;
  }

  const deleteResult = await Memory.deleteMany({
    expired: true,
    locked: { $ne: true },
    priority: { $ne: 'critical' }
  });

  console.log(`\n🗑  实际删除: ${deleteResult.deletedCount} 条`);
  console.log(`   (跳过了 ${totalCleanable - deleteResult.deletedCount} 条 locked/critical 保护)`);

  // 最终统计
  const remaining = await Memory.countDocuments({});
  const stillExpired = await Memory.countDocuments({ expired: true });
  console.log(`\n📈 剩余记忆总数: ${remaining} 条`);
  console.log(`   其中仍标记 expired: ${stillExpired} 条（locked/critical 保护）`);

  await mongoose.disconnect();
  console.log('\n✅ 清理完成');
}

run().catch(err => {
  console.error('❌ 清理失败:', err);
  process.exit(1);
});
