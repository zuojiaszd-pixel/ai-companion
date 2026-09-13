const mongoose = require('mongoose');
require('dotenv').config();
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/lumi').then(async () => {
  const db = mongoose.connection.db;
  const recent = await db.collection('chats').find({}).sort({ timestamp: -1 }).limit(4).toArray();
  recent.forEach(c => {
    console.log(c.role, '|', String(c.content).slice(0, 25).replace(/\n/g, ' '), '| voice:', JSON.stringify(c.voice));
  });
  const withVoice = await db.collection('chats').countDocuments({ voice: { $ne: null, $exists: true } });
  console.log('带voice的消息总数:', withVoice);
  process.exit(0);
}).catch(e => { console.log('ERR', e.message); process.exit(1); });
