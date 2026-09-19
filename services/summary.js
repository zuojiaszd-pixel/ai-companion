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
// 20260916 锚点保真机制（Rinka要求的摘要把守清单）：
// 三类信息永远注入摘要区：关键事实 / 当日规矩 / 未办完的事
const ANCHOR_FILE = path.join(__dirname, '..', 'config', 'anchor_facts.json');

function loadAnchors() {
    try {
        const data = fs.readFileSync(ANCHOR_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        return { facts: [], rules: [], todos: [], updatedAt: null };
    }
}

function saveAnchors(anchors) {
    anchors.updatedAt = new Date().toISOString();
    fs.writeFileSync(ANCHOR_FILE, JSON.stringify(anchors, null, 2), 'utf-8');
    console.log('[Summary] 锚点已更新');
}

function buildAnchorBlock() {
    const a = loadAnchors();
    const parts = [];
    if (a.facts && a.facts.length) parts.push('关键事实: ' + a.facts.join('；'));
    if (a.rules && a.rules.length) parts.push('既定规矩: ' + a.rules.join('；'));
    if (a.todos && a.todos.length) parts.push('未办完: ' + a.todos.join('；'));
    return parts.length ? '【锚点·必读】' + parts.join(' || ') : '';
}

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

    const anchorBlock = buildAnchorBlock();
    return anchorBlock ? (anchorBlock + ' ||| ' + parts.join(' | ')) : parts.join(' | ');
}

module.exports = { loadSummary, saveSummary, generateSummary, buildAnchorBlock };
