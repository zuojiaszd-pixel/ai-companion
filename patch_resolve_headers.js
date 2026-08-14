const fs = require('fs');
let code = fs.readFileSync('services/mcpManager.js', 'utf-8');

const start = code.indexOf('function resolveHeaders(headers = {}) {');
if (start === -1) { console.error('resolveHeaders not found'); process.exit(1); }
const end = code.indexOf('\n}\n', start) + 3;
if (end <= start) { console.error('end not found'); process.exit(1); }

const lines = [];
lines.push('function resolveHeaders(headers = {}) {');
lines.push('    const resolved = {};');
lines.push('    for (const [key, value] of Object.entries(headers)) {');
lines.push('        if (typeof value === \'string\') {');
lines.push('            // 替换值中所有 ${ENV} 占位符（支持带前缀/后缀的写法，如 Bearer ${TOKEN}）');
lines.push('            resolved[key] = value.replace(/\\$\\{([A-Z0-9_]+)\\}/g, (match, name) => {');
lines.push('                const envVal = process.env[name];');
lines.push('                if (envVal) {');
lines.push('                    return envVal;');
lines.push('                }');
lines.push('                console.warn(\'[MCP] 环境变量 \' + name + \' 未设置，占位符保留为空\');');
lines.push('                return \'\';');
lines.push('            });');
lines.push('            continue;');
lines.push('        }');
lines.push('        resolved[key] = value;');
lines.push('    }');
lines.push('    return resolved;');
lines.push('}');
const newFn = lines.join('\n');

code = code.slice(0, start) + newFn + code.slice(end);
fs.writeFileSync('services/mcpManager.js', code);
console.log('patched resolveHeaders OK');
