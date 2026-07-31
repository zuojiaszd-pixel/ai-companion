require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { MongoClient } = require('mongodb');

(async () => {
  const uri = process.env.DATABASE_URL;
  if (!uri) { console.error('NO DATABASE_URL'); process.exit(1); }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const db = client.db();
    const collections = await db.listCollections().toArray();
    console.log('COLLECTIONS:', collections.map(c => c.name).join(', '));
    for (const c of collections) {
      const count = await db.collection(c.name).countDocuments();
      console.log(`  ${c.name}: ${count}`);
    }
    // 找日记相关的集合
    for (const c of collections) {
      if (/journal|diary|memory|chat/i.test(c.name)) {
        const col = db.collection(c.name);
        const sample = await col.find({}).limit(3).toArray();
        console.log(`\n=== SAMPLE ${c.name} ===`);
        sample.forEach((doc, i) => {
          const keys = Object.keys(doc);
          const preview = {};
          for (const k of keys) {
            const v = doc[k];
            preview[k] = typeof v === 'string' ? v.slice(0, 120) : v;
          }
          console.log(`[${i}]`, JSON.stringify(preview, null, 1).slice(0, 500));
        });
      }
    }
  } catch (e) {
    console.error('ERROR:', e.message);
  } finally {
    await client.close();
  }
})();
