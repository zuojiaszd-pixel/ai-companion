require('dotenv').config();
const mongoose = require('mongoose');
const Sticker = require('./models/Sticker');
const uri = process.env.DATABASE_URL;
mongoose.connect(uri).then(async () => {
  const all = await Sticker.find().sort({ createdAt: -1 }).limit(3).lean();
  console.log('count:', all.length);
  for (const s of all) {
    console.log('---', s.name, '|', s.emotion, '|', (s.data||'').slice(0, 80), '| len:', (s.data||'').length);
  }
  process.exit(0);
}).catch(e => { console.error('ERR', e.message); process.exit(1); });
