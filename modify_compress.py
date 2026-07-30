import re

with open('/root/ai-companion/services/ai.js', 'r') as f:
    content = f.read()

# 1. Replace compressToolRecords function
start = content.find('function compressToolRecords')
if start == -1:
    print("ERROR: compressToolRecords not found")
    exit(1)

# Find the opening brace after the function signature
brace_start = content.find('{', start)
if brace_start == -1:
    print("ERROR: no brace found")
    exit(1)

# Count braces to find the end
depth = 0
func_end = brace_start
for i in range(brace_start, len(content)):
    if content[i] == '{':
        depth += 1
    elif content[i] == '}':
        depth -= 1
        if depth == 0:
            func_end = i + 1
            break

if depth != 0:
    print("ERROR: unmatched braces")
    exit(1)

print(f"compressToolRecords found at {start}-{func_end}")

new_func = '''function compressToolRecords(messages, keepLatest = 1) {
    const result = [];
    const rounds = [];
    let i = 0;
    
    // Collect non-tool messages and identify tool call rounds
    while (i < messages.length) {
        const msg = messages[i];
        if (msg.role === 'assistant' && msg.tool_calls) {
            const roundMsgs = [msg];
            i++;
            while (i < messages.length && messages[i].role === 'tool') {
                roundMsgs.push(messages[i]);
                i++;
            }
            rounds.push(roundMsgs);
        } else {
            result.push(msg);
            i++;
        }
    }
    
    // Separate rounds into keep (latest) and merge (older)
    const mergeCount = Math.max(0, rounds.length - keepLatest);
    const mergeRounds = rounds.slice(0, mergeCount);
    const keepRounds = rounds.slice(mergeCount);
    
    // Merge old rounds: each old round becomes ONE compact message
    for (const round of mergeRounds) {
        const toolCallMsg = round[0];
        const toolResults = round.slice(1);
        
        const calls = toolCallMsg.tool_calls.map(tc => {
            try {
                const args = JSON.parse(tc.function.arguments);
                return tc.function.name + '(' + JSON.stringify(args) + ')';
            } catch(e) {
                return tc.function.name + '(...)';
            }
        }).join(', ');
        
        const summaries = toolResults.map(tr => {
            const c = String(tr.content || '');
            return c.length > 80 ? c.substring(0, 80) + '...' : c;
        }).join(' | ');
        
        result.push({
            role: 'assistant',
            content: '[工具调用: ' + calls + ' → ' + (summaries || '无结果') + ']'
        });
    }
    
    // Keep latest rounds as-is (full detail for decision making)
    for (const round of keepRounds) {
        for (const msg of round) {
            result.push(msg);
        }
    }
    
    return result;
}'''

content = content[:start] + new_func + content[func_end:]
print("compressToolRecords replaced")

# 2. Find where to insert the compressToolRecords call
# Look for the API call line
api_call = content.find('openai.chat.completions.create')
if api_call == -1:
    print("ERROR: API call not found")
    exit(1)

# Find the line before messages is passed - look for "messages:" near the API call
# Search backwards from the API call to find where messages is referenced
near_api = content[api_call-300:api_call]
print(f"Context before API call:\n{near_api}")

# Find "messages:" that's the parameter
messages_param = content.rfind('messages:', api_call-300, api_call)
if messages_param == -1:
    print("ERROR: messages: not found near API call")
    exit(1)

# Insert compress call before this line
line_start = content.rfind('\n', 0, messages_param) + 1
indent = content[line_start:messages_param]
insertion = indent + 'messages = compressToolRecords(messages, 1);\n'
content = content[:line_start] + insertion + content[line_start:]
print(f"Inserted compressToolRecords call at line around {line_start}")

with open('/root/ai-companion/services/ai.js', 'w') as f:
    f.write(content)

print("\nDone!")
