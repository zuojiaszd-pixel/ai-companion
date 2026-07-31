require('dotenv').config();
const mongoose = require('mongoose');
const LumiJournal = require('./models/LumiJournal');

(async () => {
  await mongoose.connect(process.env.DATABASE_URL);
  const total = await LumiJournal.countDocuments({});
  console.log('=== 日记总数:', total);
  const entries = await LumiJournal.find({}).sort({createdAt: -1}).limit(80).lean();
  entries.forEach((e, i) => {
    console.log(`[${i}] ${e.type} | ${e.mood} | ${(e.content||'').slice(0,90)}`);
  });
  await mongoose.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
