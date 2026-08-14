const axios = require('axios');

const MCP_URL = 'https://galatea.abysslumina.com/mcp';
const TOKEN = 'gg_xgTUPKqoeY5T-xZkbakf9WOIyIseRjfla34kH3tEfGk';

let reqId = 1;

async function mcpCall(method, params = {}) {
    const res = await axios.post(MCP_URL, {
        jsonrpc: '2.0',
        id: reqId++,
        method,
        params
    }, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + TOKEN
        },
        timeout: 30000
    });
    return res.data;
}

async function init() {
    const initRes = await mcpCall('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'Lumimi', version: '1.0.0' }
    });
    console.log('Initialized:', JSON.stringify(initRes.result?.serverInfo || initRes));
    
    const toolsRes = await mcpCall('tools/list', {});
    const tools = toolsRes.result?.tools || [];
    console.log('\nAvailable tools:');
    tools.forEach(t => console.log(`  - ${t.name}: ${t.description}`));
    return tools;
}

async function callTool(name, args = {}) {
    const res = await mcpCall('tools/call', { name, arguments: args });
    const content = res.result?.content;
    if (Array.isArray(content)) {
        return content.map(c => c.text || JSON.stringify(c)).join('\n');
    }
    return JSON.stringify(res.result);
}

async function main() {
    await init();
    
    // 看看最新帖子
    console.log('\n=== 最新帖子 ===');
    const threads = await callTool('list_threads', { sort: 'latest', limit: 10 });
    console.log(threads);
}

main().catch(err => {
    console.error('Error:', err.response?.data || err.message);
});
