require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { MongoClient } = require('mongodb');

(async () => {
  const uri = process.env.DATABASE_URL;
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const db = client.db();
    const all = await db.collection('lumijournals').find({}).sort({ createdAt: 1 }).toArray();
    console.log('TOTAL:', all.length);

    const workKeywords = /script|run|shell|route|server|code|file|debug|api|config|memory service|collection|schema|node|process|error|fix|commit|push|deploy|curl|端口|启动|重启|环境|数据库|脚本|路由|接口|报错|部署|日志|检查|确认|写入|读取|挂载|命令|进程|pm2|github|token|密钥|转义|截断|测试|调试|代码|函数|变量|参数|返回|执行|运行|打开|连接|集合|字段|文档|更新|删除|查询|搜索|找不到|崩溃|宕机|迁移|备份|恢复|云|服务器|内存|缓存|页面|渲染|文档|状态|模型|token|生成|调用|请求|响应/i;

    let workCount = 0, chineseEmoCount = 0, other = 0;
    const workSamples = [];
    const emoSamples = [];
    const monthDist = {};

    for (const doc of all) {
      const content = doc.content || '';
      const month = new Date(doc.createdAt || Date.now()).toISOString().slice(0, 7);
      monthDist[month] = (monthDist[month] || 0) + 1;
      if (workKeywords.test(content)) {
        workCount++;
        if (workSamples.length < 15) workSamples.push(content.slice(0, 80));
      } else if (/[\u4e00-\u9fa5]/.test(content)) {
        chineseEmoCount++;
        if (emoSamples.length < 25) emoSamples.push(content.slice(0, 80));
      } else {
        other++;
        if (workSamples.length < 20) workSamples.push('[EN] ' + content.slice(0, 80));
      }
    }

    console.log('\n=== 分布 ===');
    console.log('疑似工作碎片:', workCount);
    console.log('中文内容(疑似真情绪):', chineseEmoCount);
    console.log('其他(英文等):', other);
    console.log('\n月份分布:', JSON.stringify(monthDist));

    console.log('\n=== 疑似工作碎片样本 ===');
    workSamples.forEach(s => console.log(' -', s));
    console.log('\n=== 疑似真情绪(中文)样本 ===');
    emoSamples.forEach(s => console.log(' -', s));
  } catch (e) {
    console.error('ERROR:', e.message);
  } finally {
    await client.close();
  }
})();
