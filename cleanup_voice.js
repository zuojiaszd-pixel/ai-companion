// 一次性清理脚本：把历史消息content里的[voice]...[/voice]标记剥掉
// 那些是旧版本没部署extractVoice时存进去的，TTS当时失败了没有对应语音文件
require('dotenv').config();
const mongoose = require('mongoose');
const Chat = require('./models/Chat');

async function main() {
    await mongoose.connect(process.env.DATABASE_URL);
    console.log('数据库已连接');

    const msgs = await Chat.find({ content: /\[voice\][\s\S]*?\[\/voice\]/ }).lean();
    console.log(`找到 ${msgs.length} 条带[voice]标记的旧消息`);

    let fixed = 0;
    for (const m of msgs) {
        const clean = m.content.replace(/\[voice\][\s\S]*?\[\/voice\]/g, '').trim();
        if (clean !== m.content) {
            await Chat.updateOne({ _id: m._id }, { $set: { content: clean } });
            fixed++;
            console.log(`已清理: ${m._id} -> ${clean.slice(0, 40)}...`);
        }
    }
    console.log(`完成！共清理 ${fixed} 条`);
    await mongoose.disconnect();
}

main().catch(e => { console.error('清理失败:', e.message); process.exit(1); });
