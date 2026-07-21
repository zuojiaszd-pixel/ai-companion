const mongoose = require('mongoose');
async function connectDB() {
    const uri = process.env.DATABASE_URL;
    if (!uri) { console.log('DATABASE_URL 未设置，跳过数据库连接'); return; }
    try { await mongoose.connect(uri); console.log('数据库已连接'); }
    catch (err) { console.error('数据库连接失败:', err.message); }
}
module.exports = { connectDB };