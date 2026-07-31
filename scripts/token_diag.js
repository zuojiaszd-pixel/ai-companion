// token 诊断：统计记忆库与对话历史，估算每次请求的输入 token
// 按 services/memory.js getChatMemories 的真实逻辑计算：
//   baseline = critical only, limit 10
//   recent   = 3天内, limit 5
//   search   = topK 10
//   总量封顶 15（search 优先，baseline/recent 补充去重）
const mongoose = require('mongoose');
require('dotenv').config({ path: '/home/ubuntu/ai-companion/.env' });
const config = require('/home/ubuntu/ai-companion/config/db');

async function main() {
    await mongoose.connect(process.env.DATABASE_URL);
    const Memory = require('/home/ubuntu/ai-companion/models/Memory');
    const Chat = require('/home/ubuntu/ai-companion/models/Chat');

    const total = await Memory.countDocuments({});
    const active = await Memory.countDocuments({ archived: false });
    const critical = await Memory.countDocuments({ archived: false, priority: 'critical' });
    const high = await Memory.countDocuments({ archived: false, priority: 'high' });
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const recent3d = await Memory.countDocuments({ archived: false, createdAt: { $gte: threeDaysAgo } });

    // 真实注入逻辑
    const baseline = await Memory.find({
        archived: false, priority: 'critical', supersededBy: null, contradicted: false
    }).limit(10).lean();
    const recent = await Memory.find({
        archived: false, createdAt: { $gte: threeDaysAgo }, supersededBy: null, contradicted: false
    }).sort({ createdAt: -1 }).limit(5).lean();

    // 模拟去重后的实际注入条数（search 命中 10 条里若与 baseline/recent 重叠会去重）
    const all = [...baseline, ...recent];
    const seen = new Set();
    const merged = all.filter(m => {
        const id = m._id.toString();
        if (seen.has(id)) return false;
        seen.add(id); return true;
    });
    // 与 search 去重后一般 ≤ 15，这里按封顶 15 估算
    const finalCount = Math.min(merged.length + 10, 15);
    const finalChars = merged.slice(0, finalCount).reduce((s, m) => s + m.content.length, 0) +
        // search 命中的 10 条（近似：与 baseline/recent 部分重叠，取 10 条平均 150 字符）
        Math.max(0, finalCount - merged.length) * 150;

    const baselineChars = baseline.reduce((s, m) => s + m.content.length, 0);
    const recentChars = recent.reduce((s, m) => s + m.content.length, 0);

    // 对话历史：最近 20 条消息的字符数
    const history = await Chat.find({ sessionId: 'default' }).sort({ timestamp: -1 }).limit(20).lean();
    const historyChars = history.reduce((s, m) => s + (m.content || '').length, 0);
    const historyCount = history.length;

    // 情绪轨迹：最近 5 条
    const moodMems = await Memory.find({ archived: false, mood: { $ne: null } }).sort({ createdAt: -1 }).limit(20).lean();
    const moodChars = moodMems.slice(-5).reduce((s, m) => s + 30, 0);

    console.log('===== 记忆库统计 =====');
    console.log(`记忆总数: ${total}, 活跃: ${active}`);
    console.log(`critical(未归档): ${critical}, high(未归档): ${high}`);
    console.log(`最近3天创建的活跃记忆: ${recent3d}`);
    console.log(`baseline注入(critical only, 上限10): ${baseline.length}条, 共${baselineChars}字符 ≈ ${Math.round(baselineChars * 0.5)} token`);
    console.log(`recent注入(最近3天, 上限5): ${recent.length}条, 共${recentChars}字符 ≈ ${Math.round(recentChars * 0.5)} token`);
    console.log(`去重后 + search(10) 封顶15: 实际约 ${finalCount}条, ≈ ${Math.round(finalChars * 0.5)} token`);
    console.log(`情绪轨迹: 最近5条 ≈ ${moodChars} token`);

    console.log('\n===== 对话历史 =====');
    console.log(`最近${historyCount}条消息, 共${historyChars}字符 ≈ ${Math.round(historyChars * 0.5)} token`);
    const maxMsg = Math.max(...history.map(m => (m.content || '').length));
    console.log(`单条最长消息: ${maxMsg}字符`);

    // 估算总输入
    const personaChars = 2183; // 人设字符数（近似）
    console.log('\n===== 估算 =====');
    console.log(`人设 ≈ ${Math.round(personaChars * 0.5)} token`);
    console.log(`记忆注入 ≈ ${Math.round(finalChars * 0.5)} token`);
    console.log(`历史消息 ≈ ${Math.round(historyChars * 0.5)} token`);
    console.log(`合计(不含摘要/新消息) ≈ ${Math.round((personaChars + finalChars + historyChars) * 0.5)} token`);
    
    await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
