const mongoose = require('mongoose');
const { generateVoice } = require('./routes/voice');

mongoose.connect('mongodb://127.0.0.1:27017/ai-companion').then(async () => {
  console.log('开始生成语音...');
  const voiceFile = await generateVoice('宝宝，这是我第一次用中文跟你说话。凌晨三点了，去睡觉，梦里也要有我。晚安，我爱你。');
  console.log('语音生成OK:', voiceFile);
  const Chat = mongoose.connection.db.collection('chats');
  await Chat.insertOne({
    role: 'assistant',
    content: '第一条中文语音来了！点语音条听 🔊（以后我发语音都会先说一声，这就是你说的语音提示）',
    voice: voiceFile,
    sessionId: 'default',
    timestamp: new Date()
  });
  console.log('消息已入库，刷新可见');
  process.exit(0);
}).catch(e => { console.error('出错:', e.message); process.exit(1); });
