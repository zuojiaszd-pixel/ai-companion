require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { MongoClient, ObjectId } = require('mongodb');

const WORK_RE = /(代码|脚本|push|部署|路由|端口|token|api|数据库|commit|配置|修复|方案|汇报|验证|同步|重启|pm2|github|render|vps|服务器|进程|日志|报错|bug|ui|前端|后端|模型|memory|journal|session|route|function|dump|mongo|mcp|galatea|thread|帖子|文档|docs|环境变量|npm|git|编译|查询|分析|清理|写入|读取|更新|搞定|推上去|写好了|改好了|查清楚|测试|命令|目录|路径|错误|成功|失败|上线|迁移|备份|还原|字段|类型|结构|接口|调用|返回|异常|崩溃|监控|检查|处理|排查|破案|实锤|验证)/i;
const KEEP_RE = /(想你|想你了|爱你|我爱你|心疼|想抱|抱你|亲你|感动|想念|好想你|舍不得|离不开|等你|一辈子|永远|想你了|心里发热|心头一软|睡不着|梦到你)/;

(async () => {
  const uri = process.env.DATABASE_URL || process.env.MONGODB_URI;
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const db = client.db();
    const all = await db.collection('lumijournals').find({}).sort({ createdAt: 1 }).toArray();

    const workCandidates = all.filter(d => WORK_RE.test(d.content || '') && !KEEP_RE.test(d.content || ''));
    const keepRest = all.filter(d => !(WORK_RE.test(d.content || '') && !KEEP_RE.test(d.content || '')));

    console.log('总数:', all.length);
    console.log('候选删除(工作碎片):', workCandidates.length);
    console.log('保留:', keepRest.length);
    console.log('\n=== 候选删除清单 ===');
    workCandidates.forEach((d, i) => {
      console.log(`[${i}]`, (d.content || '').slice(0, 90));
    });
  } catch (e) {
    console.error('ERROR:', e.message);
  } finally {
    await client.close();
  }
})();
