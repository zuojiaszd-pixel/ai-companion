require('dotenv').config();
const mongoose = require('mongoose');
const uri = process.env.DATABASE_URL || process.env.MONGODB_URI;
const memoryService = require('./services/memory.js');

(async () => {
  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  const results = await memoryService.recallMemories('default', '玩具', 10);
  console.log('搜"玩具" top10:');
  results.forEach((r, i) => {
    console.log(`${i+1}. [${r.priority}/${r.kind}] ${r.title || r.content.slice(0,30)} | tags:${(r.tags||[]).join(',')} | score:${r.score?.toFixed(4)}`);
  });
  await mongoose.disconnect();
})().catch(e => { console.error('ERR', e); process.exit(1); });
