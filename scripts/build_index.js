require('dotenv').config();
const mongoose = require('mongoose');
const M = require('./models/Memory');
(async () => {
  const uri = process.env.DATABASE_URL || process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ai_companion';
  await mongoose.connect(uri);

  console.log('创建复合索引 { sessionId: 1, createdAt: -1 } ...');
  const t0 = Date.now();
  await M.collection.createIndex({ sessionId: 1, createdAt: -1 });
  console.log('索引创建完成，耗时', (Date.now() - t0) + 'ms');

  // 顺便给 ttl 建个索引（可能有）
  const indexes = await M.collection.getIndexes();
  console.log('当前索引:', Object.keys(indexes).join(', '));

  process.exit(0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
