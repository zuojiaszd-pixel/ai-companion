require('dotenv').config();
const mongoose = require('mongoose');
const LumiJournal = require('./models/LumiJournal');
(async () => {
  await mongoose.connect(process.env.DATABASE_URL, { useNewUrlParser: true, useUnifiedTopology: true });
  const all = await LumiJournal.find({}).sort({ createdAt: 1 }).lean();
  console.log('总数:', all.length);
  // 按天统计
  const byDay = {};
  all.forEach(e => {
    const d = e.createdAt ? e.createdAt.toISOString().slice(0,10) : 'none';
    byDay[d] = (byDay[d]||0)+1;
  });
  console.log('按天:', JSON.stringify(byDay));
  // 全量输出（id + 时间 + 内容）
  all.forEach(e => {
    console.log(e._id.toString(), '|', e.createdAt ? e.createdAt.toISOString().slice(0,16) : '?', '|', (e.content||'').replace(/\n/g,' ').slice(0,120));
  });
  await mongoose.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
