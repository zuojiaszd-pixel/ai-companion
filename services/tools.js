const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Tool definitions for OpenRouter function calling
const toolDefinitions = [
    {
        type: "function",
        function: {
            name: "execute_command",
            description: "在服务器的终端执行命令（Node.js/Python/shell），返回输出结果",
            parameters: {
                type: "object",
                properties: {
                    command: { type: "string", description: "要执行的命令" }
                },
                required: ["command"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "recall_memories",
            description: "搜索长期记忆中与查询相关的内容",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "搜索关键词" }
                },
                required: ["query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "current_time",
            description: "获取当前日期和时间",
            parameters: { type: "object", properties: {} }
        }
    },
    {
        type: "function",
        function: {
            name: "read_file",
            description: "读取工作目录下的文件内容",
            parameters: {
                type: "object",
                properties: {
                    filepath: { type: "string", description: "文件路径（相对工作空间）" }
                },
                required: ["filepath"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "write_file",
            description: "写入文件到工作目录",
            parameters: {
                type: "object",
                properties: {
                    filepath: { type: "string", description: "文件路径" },
                    content: { type: "string", description: "文件内容" }
                },
                required: ["filepath", "content"]
            }
        }
    }
];

// Tool handlers - execute each tool and return result
async function executeTool(name, args) {
    try {
        switch (name) {
            case 'execute_command': {
                const result = execSync(args.command, { timeout: 15000, encoding: 'utf-8' });
                return result || '(命令执行完毕，无输出)';
            }
            case 'recall_memories': {
                const { searchMemories } = require('./memory');
                const results = await searchMemories(args.query);
                if (!results.length) return '未找到相关记忆';
                return results.map(r => `- ${r.content}`).join('\n');
            }
            case 'current_time': {
                return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
            }
            case 'read_file': {
                const p = path.resolve(args.filepath);
                if (!fs.existsSync(p)) return `文件不存在: ${args.filepath}`;
                return fs.readFileSync(p, 'utf-8');
            }
            case 'write_file': {
                const p = path.resolve(args.filepath);
                fs.writeFileSync(p, args.content, 'utf-8');
                return `文件已写入: ${args.filepath}`;
            }
            default:
                return `未知工具: ${name}`;
        }
    } catch (e) {
        return `工具执行失败: ${e.message}`;
    }
}

module.exports = { toolDefinitions, executeTool };