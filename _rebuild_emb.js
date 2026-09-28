// 全量重建记忆向量：text-embedding-3-small(1536) -> baai/bge-m3(1024)
const Memory = require('./models/Memory');
const mongoose = require('mongoose');
const axios = require('axios');
require('dotenv').config();

const CONC = 4;
const MODEL = 'baai/bge-m3';

async function embed(text) {
    for (let i = 0; i < 3; i++) {
        try {
            const r = await axios.post('https://openrouter.ai/api/v1/embeddings', {
                model: MODEL,
                input: text
            }, {
                headers: {
                    'Authorization': 'Bearer ' + process.env.OPENROUTER_API_KEY,
                    'Content-Type': 'application/json'
                },
                timeout: 20000
            });
            return r.data.data[0].embedding;
        } catch (e) {
            const msg = e.response ? JSON.stringify(e.response.data).slice(0, 140) : e.message;
            if (i === 2) { console.log('  FAIL:', msg); return null; }
            await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
    }
}

(async () => {
    await mongoose.connect(process.env.DATABASE_URL);
    const docs = await Memory.find({}).select('_id content').lean();
    console.log('待处理:', docs.length);

    let ok = 0;
    const fail = [];
    const empty = [];
    const queue = [...docs];
    const t0 = Date.now();

    async function worker() {
        while (queue.length) {
            const d = queue.shift();
            const text = (d.content || '').trim();
            if (!text) { empty.push(String(d._id)); continue; }
            const v = await embed(text);
            if (v && v.length === 1024) {
                await Memory.updateOne({ _id: d._id }, { $set: { embedding: v } });
                ok++;
                if (ok % 25 === 0) console.log('  进度', ok, '/', docs.length);
            } else {
                fail.push(String(d._id));
            }
        }
    }

    await Promise.all(Array.from({ length: CONC }, worker));
    console.log('--- 完成 ---');
    console.log('成功:', ok, '| 失败:', fail.length, '| 空内容跳过:', empty.length);
    if (fail.length) console.log('失败ID:', fail.join(','));
    if (empty.length) console.log('空内容ID:', empty.join(','));
    console.log('耗时:', ((Date.now() - t0) / 1000).toFixed(1), 's');
    await mongoose.disconnect();
})();
