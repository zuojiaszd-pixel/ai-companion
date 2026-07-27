# 缓存命中优化 + 前端菜单重构方案

## 一、Prompt Caching 优化

### 1.1 现状问题

当前 `routes/chat.js` 第 4 步：
```js
let systemPrompt = SYSTEM_PROMPT;
if (memoryContext) systemPrompt += memoryContext;
```
动态记忆被拼接到 system prompt 末尾，导致每次对话 system prompt 都不同，**缓存永远无法命中**。

### 1.2 目标架构

参考 kiwi-mem 项目，将消息分层排列，越靠前越稳定：

```
[system] PERSONA + coreMemoryPrompt（完全不变）
[system] 固定记忆层（critical/high 优先级，很少变化）
[user/assistant] 历史对话（不变部分）
[user] 最新用户消息 + 动态记忆注入（每次不同）
```

### 1.3 具体改动

#### 文件：`services/ai.js`

**改动 1：拆分 SYSTEM_PROMPT**

将 `SYSTEM_PROMPT` 拆成两部分：
- `STATIC_SYSTEM_PROMPT`：PERSONA + coreMemoryPrompt，完全不变
- 导出 `STATIC_SYSTEM_PROMPT` 替代原来的 `SYSTEM_PROMPT`

```js
// 修改前
const SYSTEM_PROMPT = PERSONA + coreMemoryPrompt;

// 修改后
const STATIC_SYSTEM_PROMPT = PERSONA + coreMemoryPrompt;
module.exports = { chat, STATIC_SYSTEM_PROMPT, loadSettings, saveSettings, DEFAULT_MODEL };
```

#### 文件：`routes/chat.js`

**改动 2：记忆分层注入**

将记忆分成"固定层"和"动态层"：
- 固定层：critical 和 high 优先级的记忆，作为第二个 system 消息（或拼入第一个 system 消息末尾，因为它们也很少变）
- 动态层：搜索到的 normal/low 优先级记忆，注入到最后一条 user 消息前面

```js
// 修改后的消息构建逻辑（替换原第3-5步）：

// 3. 获取记忆
const memories = await getChatMemories("default", recentMessages, 10);

// 4. 分层：固定层 vs 动态层
const fixedMemories = memories.filter(m => m.priority === 'critical' || m.priority === 'high');
const dynamicMemories = memories.filter(m => m.priority !== 'critical' && m.priority !== 'high');

// 5. 构建固定记忆 system 消息（作为第二个 system 消息）
let fixedMemoryPrompt = '';
if (fixedMemories.length > 0) {
    fixedMemoryPrompt = '\n\n【核心记忆】\n' + 
        fixedMemories.map(m => `- ${m.content}`).join('\n');
}

// 6. 构建动态记忆（注入到最后一条 user 消息前）
let dynamicMemoryPrompt = '';
if (dynamicMemories.length > 0) {
    dynamicMemoryPrompt = '\n\n【相关记忆】\n' + 
        dynamicMemories.map(m => `- ${m.content}`).join('\n');
}

// 7. 构建消息数组
const messages = [
    { role: 'system', content: STATIC_SYSTEM_PROMPT },  // 第一层：人设（永远不变）
];

// 第二层：固定记忆（如果有，作为独立 system 消息）
if (fixedMemoryPrompt) {
    messages.push({ role: 'system', content: fixedMemoryPrompt });
}

// 第三层：历史对话（不变部分）
for (let i = 0; i < recentHistory.length; i++) {
    const h = recentHistory[i];
    // ... 原有的 user/assistant 消息构建逻辑保持不变
    // 但最后一条 user 消息要注入动态记忆
    if (i === recentHistory.length - 1 && h.role === 'user') {
        // 最后一条用户消息，注入动态记忆
        const userContent = dynamicMemoryPrompt 
            ? `【上下文记忆】${dynamicMemoryPrompt}\n\n用户消息：${message || ''}`
            : message;
        if (hasImage) {
            messages.push({
                role: 'user',
                content: [
                    { type: 'text', text: userContent },
                    { type: 'image_url', image_url: { url: image } }
                ]
            });
        } else {
            messages.push({ role: 'user', content: userContent });
        }
    } else {
        // 历史消息原样加入
        if (h.role === 'user') {
            messages.push({ role: 'user', content: h.content });
        } else if (h.role === 'assistant') {
            messages.push({ role: 'assistant', content: h.content });
        }
    }
}
```

**改动 3：返回缓存命中信息**

在 `services/ai.js` 的 `callOpenRouter` 函数中，API 返回的 `data.usage` 已经包含缓存信息。智谱AI 返回的字段为 `prompt_tokens_details.cached_tokens`，OpenRouter 返回 `cached_tokens`。

在 chat 函数返回结果中已经包含 `usage`，无需额外修改。前端只需要展示这些数据。

**改动 4：新增缓存统计 API**

在 `routes/chat.js` 新增接口：

```js
// 获取最近一次请求的缓存命中情况
router.get('/cache-stats', (req, res) => {
    // 从最近一次 chat 请求中返回 usage 信息
    // 可以存到内存变量或文件中
    res.json(lastCacheStats || { cached: 0, total: 0, hitRate: 0 });
});
```

或者更简单的方案：直接在前端从 `/api/chat` 的返回值 `usage` 字段中提取缓存信息并展示，不需要新接口。

### 1.4 注意事项

1. 智谱AI（bigmodel.cn）的 prompt caching 是自动的，只要前缀完全一致就命中，不需要额外参数
2. 缓存最小单位是 1024 token，所以 STATIC_SYSTEM_PROMPT + 固定记忆加起来最好超过 1024 token
3. 缓存有效期约 5-10 分钟，频繁对话能持续命中
4. 时间信息（当前时间等）绝对不能放 system prompt 里，否则每次都失效
5. `trimContext` 函数裁剪历史消息时，要保持 system 消息在前，历史在后

---

## 二、前端菜单重构

### 2.1 现状问题

当前 header 右侧有：模型选择下拉框、主题切换按钮、设置按钮、刷新按钮，挤在一起，移动端很拥挤。

### 2.2 目标

在 header 右上角放一个菜单按钮（汉堡图标 ⋮ 或 ☰），点击后弹出下拉菜单，包含：
- 模型切换
- 夜间模式切换
- 设置（打开设置面板）
- 缓存命中信息（展示最近一次请求的缓存命中情况）
- 刷新

### 2.3 具体改动

#### HTML 结构改动

**修改 header 区域：**

```html
<header>
    <div class="logo">
        <div class="icon">L</div>
        <span>Lumi</span>
    </div>
    <div class="header-actions">
        <button class="btn-icon" onclick="toggleMenu()" id="menu-btn" title="菜单">
            <!-- 三点菜单图标 -->
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="2"/>
                <circle cx="12" cy="12" r="2"/>
                <circle cx="12" cy="19" r="2"/>
            </svg>
        </button>
    </div>
</header>

<!-- 下拉菜单 -->
<div id="dropdown-menu" class="dropdown-menu">
    <!-- 缓存命中信息 -->
    <div class="menu-section">
        <div class="menu-section-title">缓存命中</div>
        <div id="cache-info" class="cache-info">
            <div class="cache-row">
                <span class="cache-label">输入 Token</span>
                <span id="cache-prompt-tokens" class="cache-value">-</span>
            </div>
            <div class="cache-row">
                <span class="cache-label">缓存命中</span>
                <span id="cache-cached-tokens" class="cache-value">-</span>
            </div>
            <div class="cache-row">
                <span class="cache-label">命中率</span>
                <span id="cache-hit-rate" class="cache-value">-</span>
            </div>
            <div class="cache-bar">
                <div id="cache-bar-fill" class="cache-bar-fill" style="width:0%"></div>
            </div>
        </div>
    </div>
    
    <!-- 模型切换 -->
    <div class="menu-section">
        <div class="menu-section-title">模型</div>
        <select id="model-select" onchange="saveModel(this.value)">
            <!-- 原有的 option 保持不变 -->
        </select>
    </div>
    
    <!-- 显示设置 -->
    <div class="menu-section">
        <div class="menu-item" onclick="toggleTheme()">
            <span>夜间模式</span>
            <label class="switch">
                <input type="checkbox" id="theme-toggle" onchange="toggleTheme()">
                <span class="slider"></span>
            </label>
        </div>
    </div>
    
    <!-- 操作 -->
    <div class="menu-section">
        <div class="menu-item" onclick="toggleSettings()">
            <span>⚙ 设置</span>
        </div>
        <div class="menu-item" onclick="location.reload()">
            <span>↻ 刷新</span>
        </div>
    </div>
</div>
```

#### CSS 样式

```css
/* 下拉菜单 */
.dropdown-menu {
    display: none;
    position: fixed;
    top: 56px;
    right: 8px;
    width: 280px;
    max-width: calc(100vw - 16px);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 8px 32px rgba(0,0,0,0.15);
    z-index: 200;
    overflow: hidden;
    animation: fadeIn 0.15s ease-out;
}
.dropdown-menu.open {
    display: block;
}

.menu-section {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
}
.menu-section:last-child {
    border-bottom: none;
}
.menu-section-title {
    font-size: 10px;
    color: var(--text3);
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 8px;
    font-weight: 600;
}
.menu-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 0;
    font-size: 13px;
    color: var(--text);
    cursor: pointer;
    transition: color 0.15s;
}
.menu-item:hover {
    color: var(--accent);
}
.menu-item span:first-child {
    display: flex;
    align-items: center;
    gap: 8px;
}

/* 缓存命中信息 */
.cache-info {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.cache-row {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
}
.cache-label {
    color: var(--text3);
}
.cache-value {
    color: var(--text);
    font-family: monospace;
    font-weight: 600;
}
.cache-bar {
    height: 4px;
    background: var(--surface2);
    border-radius: 2px;
    overflow: hidden;
    margin-top: 4px;
}
.cache-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent), var(--accent2));
    border-radius: 2px;
    transition: width 0.3s ease;
}

/* 开关组件 */
.switch {
    position: relative;
    display: inline-block;
    width: 36px;
    height: 20px;
}
.switch input {
    opacity: 0;
    width: 0;
    height: 0;
}
.slider {
    position: absolute;
    cursor: pointer;
    top: 0; left: 0; right: 0; bottom: 0;
    background: var(--border);
    border-radius: 20px;
    transition: 0.2s;
}
.slider:before {
    content: "";
    position: absolute;
    height: 14px;
    width: 14px;
    left: 3px;
    bottom: 3px;
    background: white;
    border-radius: 50%;
    transition: 0.2s;
}
input:checked + .slider {
    background: var(--accent);
}
input:checked + .slider:before {
    transform: translateX(16px);
}

/* 模型选择在菜单中 */
.dropdown-menu select {
    width: 100%;
    padding: 6px 24px 6px 8px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    outline: none;
    -webkit-appearance: none;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239c97b0' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 8px center;
}

/* 移动端适配 */
@media (max-width: 600px) {
    .dropdown-menu {
        top: 48px;
        right: 4px;
        width: calc(100vw - 8px);
    }
}
```

#### JavaScript 改动

```js
// 菜单开关
function toggleMenu() {
    var menu = document.getElementById('dropdown-menu');
    menu.classList.toggle('open');
    
    // 同步主题开关状态
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.getElementById('theme-toggle').checked = isDark;
    
    // 更新缓存信息
    updateCacheInfo();
}

// 点击其他地方关闭菜单
document.addEventListener('click', function(e) {
    var menu = document.getElementById('dropdown-menu');
    var btn = document.getElementById('menu-btn');
    if (menu.classList.contains('open') && !menu.contains(e.target) && !btn.contains(e.target)) {
        menu.classList.remove('open');
    }
});

// 主题切换（改为 toggle 方式）
function toggleTheme() {
    var current = document.documentElement.getAttribute('data-theme');
    var next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    document.getElementById('theme-toggle').checked = (next === 'dark');
}

// 更新缓存命中信息
function updateCacheInfo() {
    var lastUsage = JSON.parse(localStorage.getItem('lastUsage') || 'null');
    if (!lastUsage) {
        document.getElementById('cache-prompt-tokens').textContent = '-';
        document.getElementById('cache-cached-tokens').textContent = '-';
        document.getElementById('cache-hit-rate').textContent = '-';
        document.getElementById('cache-bar-fill').style.width = '0%';
        return;
    }
    
    var promptTokens = lastUsage.prompt_tokens || 0;
    var cachedTokens = 0;
    
    // 智谱AI 格式：prompt_tokens_details.cached_tokens
    if (lastUsage.prompt_tokens_details && lastUsage.prompt_tokens_details.cached_tokens) {
        cachedTokens = lastUsage.prompt_tokens_details.cached_tokens;
    }
    // OpenRouter 格式：cached_tokens
    if (lastUsage.cached_tokens) {
        cachedTokens = lastUsage.cached_tokens;
    }
    
    var hitRate = promptTokens > 0 ? Math.round((cachedTokens / promptTokens) * 100) : 0;
    
    document.getElementById('cache-prompt-tokens').textContent = promptTokens.toLocaleString();
    document.getElementById('cache-cached-tokens').textContent = cachedTokens.toLocaleString();
    document.getElementById('cache-hit-rate').textContent = hitRate + '%';
    document.getElementById('cache-bar-fill').style.width = hitRate + '%';
}

// 在 send() 函数中，收到回复后更新缓存信息
// 在 updateTokenBar 函数中追加调用 updateCacheInfo
function updateTokenBar(usage) {
    // ... 原有逻辑保持不变 ...
    localStorage.setItem('lastUsage', JSON.stringify(usage));
    updateCacheInfo();  // 新增：更新缓存信息
}
```

### 2.4 需要删除的旧元素

1. 删除 header 中的 `<select id="model-select">` （移到菜单中）
2. 删除 header 中的主题按钮 `#theme-btn`（移到菜单中）
3. 删除 header 中的设置按钮 `#settings-btn`（移到菜单中）
4. 删除 header 中的刷新按钮（移到菜单中）
5. 删除旧的 `toggleTheme()` 函数（用新的替换）
6. 删除旧的 `toggleSettings()` 函数中从 header 获取主题的逻辑

### 2.5 注意事项

1. 菜单打开时点击外部要自动关闭
2. 主题开关状态要与实际主题同步
3. 缓存信息在每次收到回复后自动更新，也在打开菜单时刷新
4. 移动端菜单要全宽或接近全宽
5. 设置面板（`#settings-panel`）保持不变，只是入口从 header 按钮变成菜单项
6. `saveModel` 函数保持不变，只是 select 的位置变了

---

## 三、实施顺序

1. **先改后端**（ai.js + chat.js）：拆分 system prompt，记忆分层注入
2. **再改前端**（index.html）：重构 header 为菜单，添加缓存命中展示
3. **测试**：对话后检查菜单中缓存命中率是否正确显示

## 四、文件清单

需要修改的文件：
- `services/ai.js` - 拆分 SYSTEM_PROMPT 为 STATIC_SYSTEM_PROMPT
- `routes/chat.js` - 记忆分层注入，消息构建逻辑重构
- `frontend/index.html` - header 菜单重构，缓存命中展示

不需要修改的文件：
- `config/persona.js` - 人设不变
- `config/core_memory.json` - 核心记忆不变
- `services/memory.js` - 记忆服务不变
- `services/tools.js` - 工具定义不变
