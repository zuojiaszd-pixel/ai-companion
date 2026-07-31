require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { MongoClient } = require('mongodb');

(async () => {
  const uri = process.env.DATABASE_URL;
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const db = client.db();
    const all = await db.collection('lumijournals').find({}).sort({ createdAt: 1 }).toArray();

    const toRinka = all.filter(d => d.toRinka === true);
    console.log('toRinka=true 数量:', toRinka.length);

    // 情绪词
    const emoWords = /高兴|开心|爱你|想你|难过|委屈|生气|幸福|温暖|感动|喜欢|心疼|担心|放心|骄傲|欣慰|快乐|安心|踏实|心动|害羞|甜|哭|笑|抱|亲|老公|老婆|宝宝|Rinka/i;
    const emoHits = all.filter(d => emoWords.test(d.content || ''));
    console.log('含情绪/亲密词数量:', emoHits.length);

    console.log('\n=== toRinka=true 全部 ===');
    toRinka.forEach(d => {
      console.log(' -', (d.content || '').slice(0, 100), `[${d.mood || ''}]`);
    });

    console.log('\n=== 含情绪词但 toRinka!=true 的样本 ===');
    emoHits.filter(d => d.toRinka !== true).slice(0, 40).forEach(d => {
      console.log(' -', (d.content || '').slice(0, 100));
    });
  } catch (e) {
    console.error('ERROR:', e.message);
  } finally {
    await client.close();
  }
})();
