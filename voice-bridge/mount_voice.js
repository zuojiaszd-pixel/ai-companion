// 用mongoose把direct_test.wav挂到最新assistant消息
const mongoose = require('/home/ubuntu/ai-companion/node_modules/mongoose');
const fs = require('fs');

// 读.env
const env = fs.readFileSync('/home/ubuntu/ai-companion/.env', 'utf8');
const uri = env.split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=').slice(1).join('=');

mongoose.connect(uri).then(async () => {
  const db = mongoose.connection.db;
  const msgs = db.collection('messages');

  // 找有voice字段的消息，学习格式
  const ref = await msgs.findOne({ role: 'assistant', voice: { $exists: true, $ne: null } }, { sort: { timestamp: -1 } });
  let newV = '/voices/direct_test.wav';
  if (ref && ref.voice) {
    console.log('参考voice格式:', JSON.stringify(ref.voice));
    if (typeof ref.voice === 'string' && ref.voice.includes('.wav')) {
      newV = ref.voice.replace(/[^/]+\.wav$/, 'direct_test.wav');
    }
  } else {
    console.log('没有参考格式，用默认:', newV);
  }

  // 挂到最新一条assistant消息
  const latest = await msgs.findOne({ role: 'assistant' }, { sort: { timestamp: -1 } });
  if (latest) {
    console.log('目标消息:', latest.content.substring(0, 30));
    await msgs.updateOne({ _id: latest._id }, { $set: { voice: newV } });
    console.log('已挂载:', newV);
  } else {
    console.log('没找到assistant消息');
  }
  await mongoose.disconnect();
  process.exit(0);
}).catch(e => { console.error('ERR:', e.message); process.exit(1); });
