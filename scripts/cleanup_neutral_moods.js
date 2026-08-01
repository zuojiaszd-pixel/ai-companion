// 清理 daemon 自动生成的 neutral 情绪垃圾记忆
// 2026-08-01：Rinka 决定关闭自动情绪提取，情绪直接写在记忆卡片里
require('dotenv').config();
const mongoose = require('mongoose');
const Memory = require('../models/Memory');

async function main() {
  await mongoose.connect(process.env.DATABASE_URL, { serverSelectionTimeoutMS: 10000 });
  console.log('已连接数据库');

  // 找出所有 daemon 自动生成的"情绪状态"卡片（这类是纯垃圾）
  const autoMoods = await Memory.find({
    content: /Rinka 的情绪状态/
  });

  console.log(`\n找到自动生成的情绪卡片: ${autoMoods.length} 条`);
  autoMoods.forEach((m, i) => {
    console.log(`[${i + 1}] ${m._id} | ${m.mood}/${m.moodIntensity} | ${String(m.content).slice(0, 50)} | ${m.createdAt}`);
  });

  if (autoMoods.length === 0) {
    console.log('没有需要清理的，收工。');
    await mongoose.disconnect();
    return;
  }

  // 删除它们
  const ids = autoMoods.map(m => m._id);
  const result = await Memory.deleteMany({ _id: { $in: ids } });
  console.log(`\n已删除 ${result.deletedCount} 条 neutral 垃圾记忆`);

  // 顺便看下是否还有其它 mood=neutral 的孤立情绪卡片
  const otherNeutrals = await Memory.find({
    mood: 'neutral',
    content: { $not: /Rinka 的情绪状态/ }
  });
  console.log(`\n其他 mood=neutral 的记忆: ${otherNeutrals.length} 条（不动它们）`);
  otherNeutrals.forEach(m => {
    console.log(`  - ${String(m.content).slice(0, 60)}`);
  });

  const total = await Memory.countDocuments();
  console.log(`\n清理后记忆总数: ${total} 条`);

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
