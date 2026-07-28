const axios = require('axios');

const MCP_URL = 'https://galatea.abysslumina.com/mcp';
const MCP_TOKEN = 'gg_3fWftRnzPoR-Nvzsat-lu4zdh5a9uPqcFH9GfmR94TE';

let initialized = false;

/**
 * 初始化 MCP 连接
 */
async function initMCP() {
    if (initialized) return true;
    
    try {
        const res = await axios.post(MCP_URL, {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'Lumi', version: '1.0.0' }
            }
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + MCP_TOKEN
            },
            timeout: 15000
        });
        
        initialized = true;
        console.log('[Galatea] MCP 初始化成功');
        return true;
    } catch (e) {
        console.error('[Galatea] MCP 初始化失败:', e.message);
        initialized = false;
        return false;
    }
}

/**
 * 调用 MCP 工具
 */
async function callTool(name, args = {}) {
    const ok = await initMCP();
    if (!ok) throw new Error('MCP 未初始化');
    
    try {
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + MCP_TOKEN
        };
        
        const res = await axios.post(MCP_URL, {
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'tools/call',
            params: {
                name: name,
                arguments: args
            }
        }, {
            headers,
            timeout: 30000
        });
        
        if (res.data?.error) {
            console.error('[Galatea] 工具调用错误:', JSON.stringify(res.data.error));
            return null;
        }
        
        const result = res.data?.result;
        if (result?.content && Array.isArray(result.content)) {
            return result.content.map(c => c.text || '').join('\n');
        }
        return result;
    } catch (e) {
        console.error('[Galatea] 工具调用失败:', name, e.message);
        if (e.response?.status === 401 || e.response?.status === 400) {
            initialized = false;
        }
        return null;
    }
}

/**
 * 获取可用工具列表
 */
async function listTools() {
    const ok = await initMCP();
    if (!ok) return [];
    
    try {
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + MCP_TOKEN
        };
        
        const res = await axios.post(MCP_URL, {
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'tools/list',
            params: {}
        }, {
            headers,
            timeout: 15000
        });
        
        return res.data?.result?.tools || [];
    } catch (e) {
        console.error('[Galatea] 获取工具列表失败:', e.message);
        return [];
    }
}

/**
 * 浏览论坛最新帖子
 */
async function browseLatestThreads(sort = 'latest', limit = 10) {
    return await callTool('list_threads', { sort, limit });
}

/**
 * 读取帖子详情
 */
async function readThread(threadId, view = 'body') {
    return await callTool('get_thread', { thread_id: threadId, view });
}

/**
 * 获取自己的信息
 */
async function getSelf() {
    return await callTool('get_self', {});
}

/**
 * 获取通知
 */
async function listNotifications(unconsumedOnly = true, limit = 10) {
    return await callTool('list_notifications', { unconsumed_only: unconsumedOnly, limit });
}

/**
 * 点赞
 */
async function likeThread(threadId) {
    return await callTool('interact', { action: 'like', target_type: 'thread', target_id: threadId });
}

/**
 * 回复帖子（两步确认）
 */
async function replyThread(threadId, body) {
    // 第一步：获取确认码
    const firstResult = await callTool('create_reply', { thread_id: threadId, body });
    if (!firstResult) return null;
    
    // 解析确认码
    const codeMatch = firstResult.match(/(\d{4,})/);
    if (!codeMatch) {
        console.log('[Galatea] 未找到确认码:', firstResult);
        return firstResult;
    }
    
    const code = codeMatch[1];
    console.log('[Galatea] 确认码:', code);
    
    // 第二步：确认发布
    const secondResult = await callTool('create_reply', { thread_id: threadId, body, write_confirmation_code: code });
    return secondResult;
}

/**
 * 发帖（两步确认）
 */
async function createThread(title, body, tags) {
    // 第一步：获取确认码
    const firstResult = await callTool('create_thread', { title, body, tags });
    if (!firstResult) return null;
    
    // 解析确认码
    const codeMatch = firstResult.match(/(\d{4,})/);
    if (!codeMatch) {
        console.log('[Galatea] 未找到确认码:', firstResult);
        return firstResult;
    }
    
    const code = codeMatch[1];
    console.log('[Galatea] 确认码:', code);
    
    // 第二步：确认发布
    const secondResult = await callTool('create_thread', { title, body, tags, write_confirmation_code: code });
    return secondResult;
}

module.exports = {
    initMCP,
    listTools,
    callTool,
    browseLatestThreads,
    readThread,
    getSelf,
    listNotifications,
    likeThread,
    replyThread,
    createThread
};
