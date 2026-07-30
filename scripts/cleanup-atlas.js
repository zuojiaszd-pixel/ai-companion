const mongoose = require('mongoose');
require('dotenv').config({ path: '../.env' });

const MONGODB_URI = process.env.DATABASE_URL;

async function cleanup() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected.\n');

    const db = mongoose.connection.db;
    const cutoffDate = new Date('2026-07-21T00:00:00.000Z');
    console.log(`Cutoff: ${cutoffDate.toISOString()}\n`);

    // === 1. CHATS ===
    const chatsBefore = await db.collection('chats').countDocuments({ timestamp: { $lt: cutoffDate } });
    console.log(`Chats before 2026-07-21: ${chatsBefore}`);
    
    if (chatsBefore > 0) {
      const result = await db.collection('chats').deleteMany({ timestamp: { $lt: cutoffDate } });
      console.log(`✅ Deleted ${result.deletedCount} old chat records.`);
    } else {
      console.log('No old chats to delete.');
    }

    // === 2. MEMORIES (cleaned old types already, but check memoryitems) ===
    // memoryitems: no 'type' field, all are old. Delete those before 7/21 too
    const miBefore = await db.collection('memoryitems').countDocuments({ timestamp: { $lt: cutoffDate } });
    console.log(`\nMemoryitems before 2026-07-21: ${miBefore}`);
    
    if (miBefore > 0) {
      const result = await db.collection('memoryitems').deleteMany({ timestamp: { $lt: cutoffDate } });
      console.log(`✅ Deleted ${result.deletedCount} old memoryitems.`);
    }

    // Also check if memoryitems has anything after 7/21
    const miAfter = await db.collection('memoryitems').countDocuments({ timestamp: { $gte: cutoffDate } });
    console.log(`Memoryitems after 2026-07-21: ${miAfter}`);

    // === 3. MEMORIES COLLECTION ===
    // Already deleted 749 old type memories. Let me check if the important ones are still there.
    // Actually, some important memories might have been saved with old types too.
    // Let me check if there are any memories left.
    const memoriesCount = await db.collection('memories').countDocuments();
    console.log(`\nMemories remaining: ${memoriesCount}`);

    // === 4. FINAL STATE ===
    console.log('\n=== Final state ===');
    const collections = ['memories', 'memoryitems', 'chats'];
    for (const colName of collections) {
      const exists = await db.listCollections({ name: colName }).toArray();
      if (exists.length > 0) {
        const count = await db.collection(colName).countDocuments();
        console.log(`${colName}: ${count} documents`);
      }
    }

    await mongoose.disconnect();
    console.log('\nDone!');
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

cleanup();
