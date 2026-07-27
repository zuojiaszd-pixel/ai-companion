const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const path = require('path');
const fs = require('fs');

// Tool definitions for OpenRouter function calling
const toolDefinitions = [
    {
        type: "function",
        function: {
            name: "execute_command",
            description: "执行终端命令",
            parameters: { type: "object", properties: { command: { type: "string", description: "命令" } }, required: ["command"] }
        }
    },
    {
        type: "function",
        function: {
            name: "recall_memories",
            description: "搜索长期记忆",
            parameters: { type: "object", properties: { query: { type: "string", description: "关键词" } }, required: ["query"] }
        }
    },
    {
        type: "function",
        function: {
            name: "current_time",
            description: "获取当前时间",
            parameters: { type: "object", properties: {} }
        }
    },
    {
        type: "function",
        function: {
            name: "read_file",
            description: "读取文件",
            parameters: { type: "object", properties: { filepath: { type: "string", description: "文件路径" } }, required: ["filepath"] }
        }
    },
    {
        type: "function",
        function: {
            name: "write_file",
            description: "写入文件",
            parameters: { type: "object", properties: { filepath: { type: "string", description: "路径" }, content: { type: "string", description: "内容" } }, required: ["filepath", "content"] }
        }
    },
    {
        type: "function",
        function: {
            name: "save_memory",
            description: "保存重要信息到长期记忆",
            parameters: {
                type: "object",
                properties: {
                    content: { type: "string", description: "记忆内容" },
                    type: { type: "string", enum: ["fact", "preference", "experience", "summary"], description: "类型" },
                    priority: { type: "string", enum: ["critical", "high", "normal", "low"], description: "优先级" },
                    tags: { type: "array", items: { type: "string" }, description: "标签" }
                },
                required: ["content"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "push_to_github",
            description: "提交代码到GitHub",
            parameters: { type: "object", properties: { commit_message: { type: "string", description: "提交信息" } }, required: ["commit_message"] }
        }
    },
    {
        type: "function",
        function: {
            name: "set_status",
            description: "设置状态栏",
            parameters: { type: "object", properties: { status: { type: "string", description: "状态内容" } }, required: ["status"] }
        }
    }
];

// Tool handlers - execute each tool and return result
async function executeTool(name, args) {
    try {
        switch (name) {
            case 'save_memory': {
                const { storeMemory } = require('./memory');
                await storeMemory(
                    'default',
                    args.content,
                    args.type || 'fact',
                    args.priority || 'normal',
                    args.tags || []
                );
                return '记忆已保存';
            }
            case 'execute_command': {
                const { stdout, stderr } = await execPromise(args.command, { timeout: 15000 });
                return stdout || stderr || '(命令执行完毕，无输出)';
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
            case 'push_to_github': {
                const token = process.env.GITHUB_TOKEN;
                if (!token) return '错误: 未设置 GITHUB_TOKEN 环境变量。请在 Render 设置中添加 GitHub Personal Access Token。';
                const { stdout: remoteUrl } = await execPromise('git remote get-url origin', { timeout: 5000 }).catch(() => ({ stdout: 'origin https://github.com/zuojiaszd-pixel/ai-companion.git' }));
                const urlWithToken = remoteUrl.trim().replace('https://', 'https://x-access-token:' + token + '@');
                await execPromise('git remote set-url origin "' + urlWithToken + '"', { timeout: 5000 });
                await execPromise('git add -A', { timeout: 10000 });
                const safeMsg = args.commit_message.replace(/"/g, '\\"');
                const { stdout: commitResult } = await execPromise('git commit -m "' + safeMsg + '"', { timeout: 10000 }).catch(e => ({ stdout: e.stdout || '(无新提交)' }));
                const { stdout: pushResult } = await execPromise('git push', { timeout: 30000 });
                await execPromise('git remote set-url origin "' + remoteUrl.trim() + '"', { timeout: 5000 });
                return '提交结果: ' + commitResult + '\\n推送结果: ' + pushResult;
            }
            case 'set_status': {
                const statusFile = path.join(__dirname, '..', 'config', 'status.json');
                const data = { status: args.status || '', updatedAt: new Date().toISOString() };
                const dir = path.dirname(statusFile);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(statusFile, JSON.stringify(data, null, 2), 'utf-8');
                return '状态已设置: ' + (args.status || '');
            }
            default:
                return `未知工具: ${name}`;
        }
    } catch (e) {
        return `工具执行失败: ${e.message}`;
    }
}

module.exports = { toolDefinitions, executeTool };
