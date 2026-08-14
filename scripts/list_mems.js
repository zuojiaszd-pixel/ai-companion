require('dotenv').config();
const mongoose = require('mongoose');
const uri = process.env.DATABASE_URL;
mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 })
  .then(async () => {
    const mems = mongoose.connection.db.collection('memories');
    const all = await mems.find({}).sort({ createdAt: -1 }).limit(30).toArray();
    console.log('=== 最近 30 条记忆 ===');
    for (const m of all) {
      console.log(`[${m._id}] session=${m.sessionId} type=${m.type} kind=${m.kind} pri=${m.priority}`);
      console.log(`  content: ${(m.content || '').slice(0, 80)}`);
      console.log(`  tags: ${(m.tags || []).join(',')} | mood: ${m.mood || '-'} | created: ${m.createdAt || '?'}`);
      console.log('---');
    }
    const sessions = await mems.distinct('sessionId');
    console.log('所有 sessionId:', sessions);
    process.exit(0);
  })
  .catch(e => { console.error('FAIL:', e.message); process.exit(1); });
