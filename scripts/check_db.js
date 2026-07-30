const mongoose = require('mongoose');
const uri = 'mongodb+srv://Rinkauser:ll2001314@cluster0.agrnzq5.mongodb.net/ai-companion?appName=Cluster0';

async function main() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  // Chats
  const chats = db.collection('chats');
  const total = await chats.countDocuments();
  console.log('Total chats:', total);

  // Check date types
  const sample = await chats.find().limit(10).toArray();
  console.log('Sample chat createdAt types:');
  sample.forEach(c => console.log('  typeof:', typeof c.createdAt, 'value:', c.createdAt, 'role:', c.role));

  // Try to find min/max using different approaches
  const allDates = await chats.find({}, { projection: { createdAt: 1, role: 1 } }).toArray();
  let minDate = null, maxDate = null;
  let before21 = 0, after21 = 0;
  const cutoff = new Date('2026-07-21T00:00:00.000Z');
  
  for (const c of allDates) {
    const d = c.createdAt ? new Date(c.createdAt) : null;
    if (d && !isNaN(d.getTime())) {
      if (!minDate || d < minDate) minDate = d;
      if (!maxDate || d > maxDate) maxDate = d;
      if (d < cutoff) before21++;
      else after21++;
    }
  }
  console.log('Date range:', minDate?.toISOString(), 'to', maxDate?.toISOString());
  console.log('Before July 21:', before21);
  console.log('After July 21:', after21);

  // Memories
  const mems = db.collection('memories');
  const memCount = await mems.countDocuments();
  console.log('\nTotal memories:', memCount);

  const typeCounts = await mems.aggregate([
    { $group: { _id: '$type', count: { $sum: 1 } } }
  ]).toArray();
  console.log('Memory types:');
  typeCounts.forEach(t => console.log(`  ${t._id}: ${t.count}`));

  const locked = await mems.find({ locked: true }).toArray();
  console.log('\nLocked memories:', locked.length);
  locked.forEach(m => {
    console.log(`  [${m.type}] priority:${m.priority} content:${m.content?.substring(0, 120)}`);
  });

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
