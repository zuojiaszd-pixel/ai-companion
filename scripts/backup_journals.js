require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { MongoClient } = require('mongodb');
const fs = require('fs');

(async () => {
  const uri = process.env.DATABASE_URL || process.env.MONGODB_URI;
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const db = client.db();
    const all = await db.collection('lumijournals').find({}).sort({ createdAt: 1 }).toArray();
    const backupPath = require('path').join(__dirname, '..', 'backups', `journals_backup_${Date.now()}.json`);
    fs.mkdirSync(require('path').join(__dirname, '..', 'backups'), { recursive: true });
    fs.writeFileSync(backupPath, JSON.stringify(all, null, 2), 'utf8');
    console.log('总数:', all.length);
    console.log('备份完成:', backupPath);
  } catch (e) {
    console.error('ERROR:', e.message);
  } finally {
    await client.close();
  }
})();
