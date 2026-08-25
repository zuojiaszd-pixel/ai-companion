require('dotenv').config();
const mongoose = require('mongoose');
const uri = process.env.DATABASE_URL || process.env.MONGODB_URI;
if (!uri) { console.log('NO DB URL'); process.exit(1); }

(async () => {
  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  const coll = mongoose.connection.collection('memories');
  const all = await coll.find({}).project({ content: 1, title: 1, tags: 1, priority: 1, kind: 1, sessionId: 1, createdAt: 1 }).toArray();
  console.log('总数:', all.length);
  const toy = all.filter(m => JSON.stringify(m).includes('玩具'));
  console.log('含"玩具"的卡:', toy.length);
  toy.forEach(m => {
    console.log('---');
    console.log('_id:', m._id);
    console.log('title:', m.title);
    console.log('sessionId:', m.sessionId);
    console.log('priority:', m.priority, 'kind:', m.kind);
    console.log('tags:', JSON.stringify(m.tags));
    console.log('content:', (m.content||'').slice(0, 120));
    console.log('createdAt:', m.createdAt);
  });
  const sessions = [...new Set(all.map(m => m.sessionId))];
  console.log('\n所有 sessionId:', JSON.stringify(sessions));
  await mongoose.disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
