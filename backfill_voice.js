// 回填脚本v2：v_毫秒时间戳.wav 格式
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const VOICES_DIR = path.join(__dirname, 'frontend', 'voices');

async function main() {
  require('dotenv').config();
  const uri = process.env.DATABASE_URL;
  if (!uri) { console.log('NO_URI'); process.exit(1); }
  await mongoose.connect(uri);
  const Chat = mongoose.model('Chat', new mongoose.Schema({ role: String, content: String, timestamp: Date, voice: String }, { collection: 'messages', strict: false }));

  const files = fs.readdirSync(VOICES_DIR).filter(f => f.endsWith('.wav'));
  console.log('wav文件数:', files.length);

  let matched = 0, skipped = 0;
  for (const f of files) {
    const m = f.match(/v_(\d{13})\.wav/);
    if (!m) { skipped++; continue; }
    const ts = new Date(parseInt(m[1]));
    // 找这条时间戳前后90秒内的assistant消息
    const msg = await Chat.findOne({
      role: 'assistant',
      timestamp: { $gte: new Date(ts.getTime() - 90000), $lte: new Date(ts.getTime() + 90000) },
      voice: { $in: [null, ''] }
    }).sort({ timestamp: 1 });
    if (msg) {
      await Chat.updateOne({ _id: msg._id }, { $set: { voice: f } });
      matched++;
      console.log('OK', f, '->', (msg.content || '').slice(0, 20));
    } else {
      skipped++;
      console.log('SKIP', f, new Date(ts).toISOString());
    }
  }
  console.log(`完成: 匹配${matched}条, 跳过${skipped}个`);
  const n = await Chat.countDocuments({ voice: { $nin: [null, ''] } });
  console.log('数据库中带voice的消息总数:', n);
  await mongoose.disconnect();
}

main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
