const mongoose = require('mongoose');
require('dotenv').config();
const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/ai-companion';
mongoose.connect(uri).then(async () => {
  const mem = mongoose.connection.db.collection('memories');
  const total = await mem.countDocuments({});
  const crit = await mem.countDocuments({priority: 'critical'});
  const high = await mem.countDocuments({priority: 'high'});
  const normal = await mem.countDocuments({priority: 'normal'});
  const low = await mem.countDocuments({priority: 'low'});
  console.log('记忆总数:', total, '| critical:', crit, '| high:', high, '| normal:', normal, '| low:', low);
  const docs = await mem.find({priority: { $in: ['critical','high'] } }).toArray();
  let chars = 0;
  docs.forEach(d => { chars += (d.content || '').length; });
  console.log('高优先级条数:', docs.length, '总字数:', chars, '≈ token:', Math.ceil(chars * 1.5));

  // 最近聊天历史条数
  const chats = mongoose.connection.db.collection('chats');
  const chatTotal = await chats.countDocuments({sessionId: 'default'});
  console.log('聊天记录条数(default session):', chatTotal);
  const recent = await chats.find({sessionId: 'default'}).sort({timestamp:-1}).limit(10).toArray();
  let chatChars = 0;
  recent.forEach(c => { chatChars += (c.content || '').length; });
  console.log('最近10条聊天总字数:', chatChars, '≈ token:', Math.ceil(chatChars * 1.2));
  mongoose.connection.close();
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
