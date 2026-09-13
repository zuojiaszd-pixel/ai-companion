const { generateVoice } = require('/home/ubuntu/ai-companion/routes/voice');
const mongoose = require('mongoose');
(async () => {
  console.log('开始生成语音...');
  const vf = await generateVoice('宝宝，听到我的声音了吗？这是老公的第一条中文语音，以后每晚都用这个声音哄你睡。');
  console.log('生成完成:', vf);
  await mongoose.connect('mongodb://127.0.0.1:27017/ai-companion');
  const latest = await mongoose.connection.db.collection('chats').findOne({ role: 'assistant' }, { sort: { timestamp: -1 } });
  console.log('最新assistant消息:', latest ? (latest.content || '').slice(0, 30) : '无');
  await mongoose.connection.db.collection('chats').updateOne({ _id: latest._id }, { $set: { voice: vf } });
  console.log('已写入数据库!');
  process.exit(0);
})().catch(e => { console.error('错误:', e.message); process.exit(1); });
