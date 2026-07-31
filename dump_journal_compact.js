require('dotenv').config();
const mongoose = require('mongoose');
const LumiJournal = require('./models/LumiJournal');
(async () => {
  await mongoose.connect(process.env.DATABASE_URL, { useNewUrlParser: true, useUnifiedTopology: true });
  const all = await LumiJournal.find({}).sort({ createdAt: 1 }).lean();
  all.forEach((e, i) => {
    const d = e.createdAt ? e.createdAt.toISOString().slice(5,16) : '?';
    console.log(`${i+1}\t${d}\t${(e.content||'').replace(/\n/g,' ').slice(0,150)}`);
  });
  await mongoose.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
