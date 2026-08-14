require('dotenv').config();
const mongoose = require('mongoose');
const uri = process.env.DATABASE_URL;
(async () => {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  const Memory = require('./models/Memory');

  const t = (label, ms) => console.log(label, ms + 'ms');

  // 1. embedding 获取耗时
  const { getEmbedding } = require('./services/memory.js');
  let s = Date.now();
  const emb = await getEmbedding('Rinka 生日 表白 在一起');
  t('embedding:', Date.now() - s);

  // 2. 候选查询（排除 embedding）
  s = Date.now();
  const cand = await Memory.find({ sessionId: 'default', supersededBy: null, contradicted: false, archived: false })
    .select('-embedding').sort({ createdAt: -1 }).limit(100).maxTimeMS(3000).lean();
  t('candidates(' + cand.length + '条):', Date.now() - s);

  // 3. 按需加载 embedding（40条）
  const pool = cand.slice(0, 40);
  s = Date.now();
  const embDocs = await Memory.find({ _id: { $in: pool.map(c => c._id) } }).select('_id embedding').lean();
  t('embDocs(' + embDocs.length + '条):', Date.now() - s);

  // 4. touch pipeline 更新（8条并发）
  const top8 = cand.slice(0, 8);
  s = Date.now();
  await Promise.all(top8.map(m => Memory.updateOne({ _id: m._id }, [ { $set: { accessCount: { $add: [{ $ifNull: ['$accessCount', 0] }, 1] }, lastAccessed: new Date(), heat: { $max: [{ $ifNull: ['$heat', 0] }, { $ifNull: ['$baseHeat', 1] }] }, updatedAt: new Date() } } ]).catch(() => {})));
  t('touch(8条):', Date.now() - s);

  await mongoose.disconnect();
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
