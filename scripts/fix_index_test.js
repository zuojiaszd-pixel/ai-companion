const mongoose = require('mongoose');
const Memory = require('../models/Memory');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ai_companion';

(async () => {
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  console.log('connected');

  // 1. 看当前索引
  const indexes = await Memory.collection.indexes();
  console.log('当前索引:', indexes.map(i => i.name).join(', '));

  // 2. 建复合索引
  console.log('创建复合索引 sessionId+createdAt ...');
  const t0 = Date.now();
  await Memory.collection.createIndex({ sessionId: 1, createdAt: -1 });
  console.log('索引创建完成', Date.now() - t0, 'ms');

  // 3. 测查询耗时（不带 embedding）
  const t1 = Date.now();
  const all = await Memory.find({
    sessionId: 'default',
    supersededBy: null, contradicted: false, archived: false
  }).sort({ createdAt: -1 }).limit(100).select('-embedding').lean().maxTimeMS(3000);
  console.log('find+sort+limit(不带embedding):', Date.now() - t1, 'ms, 条数:', all.length);

  // 4. 测查询耗时（带 embedding）
  const t2 = Date.now();
  const all2 = await Memory.find({
    sessionId: 'default',
    supersededBy: null, contradicted: false, archived: false
  }).sort({ createdAt: -1 }).limit(100).lean().maxTimeMS(3000);
  console.log('find+sort+limit(带embedding):', Date.now() - t2, 'ms, 条数:', all2.length);

  await mongoose.disconnect();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
