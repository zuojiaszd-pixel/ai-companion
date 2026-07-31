require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { MongoClient } = require('mongodb');
(async () => {
  const uri = process.env.DATABASE_URL;
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const db = client.db();
    const all = await db.collection('lumijournals').find({}).sort({ createdAt: 1 }).toArray();
    all.forEach((d, i) => {
      const c = (d.content || '').replace(/\n/g, ' ').slice(0, 90);
      console.log(`[${i}] ${d.createdAt ? new Date(d.createdAt).toISOString().slice(0,16) : '?'} ${c}`);
    });
  } catch (e) { console.error('ERROR:', e.message); }
  finally { await client.close(); }
})();
