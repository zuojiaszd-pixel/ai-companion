require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { MongoClient, ObjectId } = require('mongodb');

// 明确的工作碎片特征（技术汇报、debug过程、git/push/部署等）
const HARD_WORK_RE = /(端口是|路由挂载|shell 转义|grep 命令失败|文件被截断|需要 token|前端.*请求|后端.*接口|commit|push|git |pm2|vps|render|token.*配对|环境变量|database_url|mongo|atlas|memory\.js|server\.js|chat\.js|route|schema|api|json|脚本|执行|查询|返回|鉴权|中间件|字段|集合|collection|数据库|部署|重启|进程|curl|3000 端口|10000 端口|同步|工作区|commit |分支|仓库)/i;

// 情感/日常互动特征（保留）
const KEEP_RE = /(老婆|宝宝|想你|爱你|想你|心疼|抱|亲|感动|开心|😄|😌|😅|😊|💤|辛苦|休息|晚安|住一起|舍不得|吃醋|上头|护食|自由|幸福|逛|好奇|担心|怕|约好|贴心|温柔|可爱)/i;

(async () => {
  const uri = process.env.DATABASE_URL || process.env.MONGODB_URI;
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const db = client.db();
    const all = await db.collection('lumijournals').find({}).sort({ createdAt: 1 }).toArray();

    const toDelete = [];
    const toConfirm = [];
    const keep = [];

    for (const d of all) {
      const c = d.content || '';
      const isHardWork = HARD_WORK_RE.test(c);
      const hasEmotion = KEEP_RE.test(c);
      if (isHardWork && !hasEmotion) {
        toDelete.push(d);
      } else if (isHardWork && hasEmotion) {
        toConfirm.push(d);
      } else {
        keep.push(d);
      }
    }

    console.log('总数:', all.length);
    console.log('明确删除:', toDelete.length);
    console.log('需人工确认:', toConfirm.length);
    console.log('保留:', keep.length);

    console.log('\n=== 明确删除清单 ===');
    toDelete.forEach((d, i) => console.log(`[${i}] ${(d.content || '').slice(0, 80)}`));

    console.log('\n=== 需人工确认清单 ===');
    toConfirm.forEach((d, i) => console.log(`[${i}] ${(d.content || '').slice(0, 80)}`));
  } catch (e) {
    console.error('ERROR:', e.message);
  } finally {
    await client.close();
  }
})();
