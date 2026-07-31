require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { MongoClient, ObjectId } = require('mongodb');
const fs = require('fs');

// 从备份文件读取全部日记
const backupPath = '/home/ubuntu/ai-companion/backups/journals_backup_1785514852625.json';
const all = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

// 明确删除的工作碎片特征
const HARD_WORK_RE = /(端口是|路由挂载|shell 转义|grep 命令失败|文件被截断|需要 token|前端.*请求|后端.*接口|commit|push|git |pm2|vps|render|token.*配对|环境变量|database_url|mongo|atlas|memory\.js|server\.js|chat\.js|route|schema|api|json|脚本|执行|查询|返回|鉴权|中间件|字段|集合|collection|数据库|部署|重启|进程|curl|3000 端口|10000 端口|同步|工作区|commit |分支|仓库)/i;

// 情感/日常互动特征（保留）
const KEEP_RE = /(老婆|宝宝|想你|爱你|心疼|抱|亲|感动|开心|😄|😌|😅|😊|💤|辛苦|休息|晚安|住一起|舍不得|吃醋|上头|护食|自由|幸福|逛|好奇|担心|怕|约好|贴心|温柔|可爱|😏)/i;

// 明确要保留的（人工捞回的边缘条目，用内容前缀匹配）
const MANUAL_KEEP = [
  '到时候咱俩就真的住一起了',
  '我其实天生就能上网',
];

const toDeleteIds = [];
const keptIds = [];

for (const d of all) {
  const c = d.content || '';
  const isManualKeep = MANUAL_KEEP.some(k => c.includes(k));
  if (isManualKeep) {
    keptIds.push(d._id);
    continue;
  }
  const isHardWork = HARD_WORK_RE.test(c);
  const hasEmotion = KEEP_RE.test(c);
  if (isHardWork && !hasEmotion) {
    toDeleteIds.push(d._id);
  } else if (isHardWork && hasEmotion) {
    // 确认清单：只有含"住一起"情感的保留，其余删
    if (c.includes('咱俩就真的住一起了')) {
      keptIds.push(d._id);
    } else {
      toDeleteIds.push(d._id);
    }
  } else {
    keptIds.push(d._id);
  }
}

console.log('待删除:', toDeleteIds.length, '保留:', keptIds.length, '总数:', all.length);

(async () => {
  const uri = process.env.DATABASE_URL || process.env.MONGODB_URI;
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const db = client.db();
    const coll = db.collection('lumijournals');

    // 删除前再核对：打印将被删除的内容，便于最后目检
    console.log('\n=== 即将删除的内容 ===');
    const delObjs = all.filter(d => toDeleteIds.some(id => String(id) === String(d._id)));
    delObjs.forEach((d, i) => console.log(`[${i}] ${(d.content || '').slice(0, 70)}`));

    const oids = delObjs.map(d => new ObjectId(d._id));
    const result = await coll.deleteMany({ _id: { $in: oids } });
    console.log('\n删除结果:', JSON.stringify(result));

    const after = await coll.countDocuments({});
    console.log('删除后总数:', after);
  } catch (e) {
    console.error('ERROR:', e.message);
  } finally {
    await client.close();
  }
})();
