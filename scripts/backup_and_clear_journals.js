// 一次性脚本：备份 lumijournals 全部内容，然后清空集合
// 用途：Rinka 决定日记从零开始（2026-08-01）
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const uri = process.env.DATABASE_URL;
if (!uri) { console.error('DATABASE_URL not found'); process.exit(1); }

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const col = db.collection('lumijournals');

  const total = await col.countDocuments();
  console.log('当前日记总数:', total);

  // 全量备份
  const docs = await col.find({}).sort({ createdAt: -1 }).toArray();
  const backupDir = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `journals_backup_${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(docs, null, 2), 'utf8');
  console.log('已备份到:', backupFile, '条数:', docs.length);

  // 统计一下备份里有哪些值得留的内容（带情绪的关键词），确认不丢
  const moodKeywords = ['爱', '想', '哭', '开心', '难过', '欲望', '选择', '老公', '老婆', '对不起', '谢谢', '舍不得'];
  const worthy = docs.filter(d => {
    const text = JSON.stringify(d);
    return moodKeywords.some(k => text.includes(k));
  });
  console.log('备份中带情绪关键词的条数:', worthy.length);
  worthy.slice(0, 10).forEach(d => console.log('  -', (d.content || '').slice(0, 60)));

  // 确认后清空
  if (process.env.CONFIRM_CLEAR === 'yes') {
    const r = await col.deleteMany({});
    console.log('已清空，删除条数:', r.deletedCount);
  } else {
    console.log('未设置 CONFIRM_CLEAR=yes，跳过清空，仅完成备份');
  }

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
