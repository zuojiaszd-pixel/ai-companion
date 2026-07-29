const fs = require('fs');
const path = require('path');

const SUMMARY_FILE = path.join(__dirname, '..', 'config', 'conversation_summary.json');

function loadSummary() {
    try {
        const data = fs.readFileSync(SUMMARY_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        return { summary: '', updatedAt: null };
    }
}

function saveSummary(summary) {
    const data = { summary, updatedAt: new Date().toISOString() };
    const dir = path.dirname(SUMMARY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SUMMARY_FILE, JSON.stringify(data, null, 2), 'utf-8');
    console.log('[Summary] 已更新对话摘要');
}

/**
 * 从最近对话历史生成摘要
 * 只取最后2轮对话，拼接成简短描述
 */
function generateSummary(recentHistory) {
    const lastRounds = recentHistory.slice(-4);
    if (lastRounds.length < 2) return '';

    const parts = lastRounds.map(h => {
        const role = h.role === 'user' ? 'Rinka' : 'Lumi';
        let content = '';
        if (typeof h.content === 'string') {
            content = h.content.replace(/【上下文记忆】[\s\S]*?\n\n用户消息：/, '').slice(0, 120);
        }
        return `${role}: ${content}`;
    });

    return parts.join(' | ');
}

module.exports = { loadSummary, saveSummary, generateSummary };
