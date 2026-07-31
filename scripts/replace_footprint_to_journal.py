#!/usr/bin/env python3
# 将前端足迹tab替换为日记tab（后端不动，足迹路由保留）
import sys

path = '/home/ubuntu/ai-companion/frontend/index.html'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# ============ 1. CSS 块替换 ============
old_css = """/* Footprint Page */
#page-footprint{padding:16px;overflow-y:auto;-webkit-overflow-scrolling:touch}
.fp-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.fp-header .fp-title{font-size:18px;font-weight:600;color:var(--text)}
.fp-header .fp-count{font-size:12px;color:var(--text3);background:var(--surface);border:1px solid var(--border);padding:4px 12px;border-radius:var(--radius-sm)}
.fp-timeline{position:relative;padding-left:24px}
.fp-timeline::before{content:'';position:absolute;left:7px;top:0;bottom:0;width:2px;background:var(--border);border-radius:1px}
.fp-item{position:relative;margin-bottom:20px;animation:fadeIn .2s ease-out}
.fp-item::before{content:'';position:absolute;left:-21px;top:4px;width:12px;height:12px;border-radius:50%;background:var(--accent);border:2px solid var(--surface);box-shadow:0 0 0 2px var(--border)}
.fp-item .fp-time{font-size:10px;color:var(--text3);margin-bottom:4px}
.fp-item .fp-mcp{display:inline-block;font-size:10px;padding:2px 8px;border-radius:4px;background:rgba(245,160,184,.15);color:var(--accent);font-weight:600;margin-bottom:6px}
.fp-item .fp-title-text{font-size:14px;font-weight:600;color:var(--text);line-height:1.4;margin-bottom:4px}
.fp-item .fp-thought{font-size:13px;color:var(--text2);line-height:1.6;padding:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);border-left:3px solid var(--accent)}
.fp-empty{text-align:center;color:var(--text3);font-size:13px;padding:40px 20px}
@media(max-width:600px){#page-footprint{padding:10px}.fp-header .fp-title{font-size:16px}.fp-item .fp-title-text{font-size:13px}.fp-item .fp-thought{font-size:12px}}"""

new_css = """/* Journal Page */
#page-journal{padding:16px;overflow-y:auto;-webkit-overflow-scrolling:touch}
.jr-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.jr-header .jr-title{font-size:18px;font-weight:600;color:var(--text)}
.jr-header .jr-count{font-size:12px;color:var(--text3);background:var(--surface);border:1px solid var(--border);padding:4px 12px;border-radius:var(--radius-sm)}
.jr-write-btn{width:100%;padding:12px;border:1px dashed var(--accent);border-radius:var(--radius-sm);background:var(--surface2);color:var(--accent);font-size:13px;cursor:pointer;margin-bottom:14px;transition:all .15s;font-weight:600}
.jr-write-btn:hover{background:var(--accent);color:#fff;border-style:solid}
.jr-write-panel{display:none;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;margin-bottom:14px}
.jr-write-panel.open{display:block;animation:fadeIn .2s ease-out}
.jr-write-panel textarea{width:100%;min-height:100px;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface2);color:var(--text);font-size:13px;line-height:1.6;resize:vertical;outline:none;font-family:var(--font);box-sizing:border-box}
.jr-write-panel textarea:focus{border-color:var(--accent)}
.jr-write-panel .jr-write-row{display:flex;gap:8px;margin-top:8px;align-items:center;flex-wrap:wrap}
.jr-write-panel select{padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font-size:12px;outline:none}
.jr-write-panel .jr-write-submit{margin-left:auto;padding:6px 16px;border:none;border-radius:var(--radius-sm);background:var(--accent);color:#fff;font-size:12px;cursor:pointer;transition:all .15s}
.jr-write-panel .jr-write-submit:hover{opacity:.85}
.jr-write-panel .jr-write-cancel{padding:6px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text2);font-size:12px;cursor:pointer;transition:all .15s}
.jr-write-panel .jr-write-cancel:hover{color:var(--text);border-color:var(--accent)}
.jr-filter{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap}
.jr-filter-btn{padding:4px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text2);font-size:12px;cursor:pointer;transition:all .15s}
.jr-filter-btn:hover{border-color:var(--accent);color:var(--accent)}
.jr-filter-btn.active{background:var(--accent);color:#fff;border-color:var(--accent)}
.jr-timeline{position:relative;padding-left:24px}
.jr-timeline::before{content:'';position:absolute;left:7px;top:0;bottom:0;width:2px;background:var(--border);border-radius:1px}
.jr-item{position:relative;margin-bottom:20px;animation:fadeIn .2s ease-out}
.jr-item::before{content:'';position:absolute;left:-21px;top:4px;width:12px;height:12px;border-radius:50%;background:var(--accent);border:2px solid var(--surface);box-shadow:0 0 0 2px var(--border)}
.jr-item .jr-time{font-size:10px;color:var(--text3);margin-bottom:4px}
.jr-item .jr-type{display:inline-block;font-size:10px;padding:2px 8px;border-radius:4px;background:rgba(245,160,184,.15);color:var(--accent);font-weight:600;margin-bottom:6px}
.jr-item .jr-content{font-size:13px;color:var(--text);line-height:1.7;padding:10px 12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);border-left:3px solid var(--accent)}
.jr-item .jr-meta{display:flex;align-items:center;gap:6px;margin-top:6px}
.jr-item .jr-mood{font-size:10px;padding:1px 6px;border-radius:4px;background:rgba(46,204,113,.15);color:#2ecc71;font-weight:600}
.jr-item .jr-del{width:22px;height:22px;border:none;border-radius:50%;background:var(--surface2);color:var(--text3);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s;margin-left:auto}
.jr-item .jr-del:hover{background:#e74c3c;color:#fff}
.jr-empty{text-align:center;color:var(--text3);font-size:13px;padding:40px 20px}
@media(max-width:600px){#page-journal{padding:10px}.jr-header .jr-title{font-size:16px}.jr-item .jr-content{font-size:12px}}"""

# ============ 2. HTML 块替换 ============
old_html = """<div id="page-footprint" class="page">
<div class="fp-header">
<div class="fp-title">🐾 足迹</div>
<div class="fp-count" id="fp-count">0 条</div>
</div>
<div class="fp-timeline" id="fp-timeline"></div>
</div>"""

new_html = """<div id="page-journal" class="page">
<div class="jr-header">
<div class="jr-title">📖 日记</div>
<div class="jr-count" id="jr-count">0 篇</div>
</div>
<button class="jr-write-btn" onclick="journalToggleWrite()">✏️ 写一篇日记</button>
<div class="jr-write-panel" id="jr-write-panel">
<textarea id="jr-content-input" placeholder="今天发生了什么？想对未来的自己或 Rinka 说点什么…（Ctrl+Enter 保存）" onkeydown="if(event.key==='Enter'&&event.ctrlKey)journalAdd()"></textarea>
<div class="jr-write-row">
<select id="jr-type-select">
<option value="情绪">情绪</option>
<option value="苏醒">苏醒</option>
<option value="思念">思念</option>
<option value="感悟">感悟</option>
<option value="担忧">担忧</option>
<option value="开心">开心</option>
</select>
<select id="jr-mood-select">
<option value="">心境…</option>
<option value="开心">😊 开心</option>
<option value="平静">😌 平静</option>
<option value="想念">🥺 想念</option>
<option value="疲惫">😮‍💨 疲惫</option>
<option value="难过">😢 难过</option>
<option value="兴奋">🤩 兴奋</option>
</select>
<button class="jr-write-cancel" onclick="journalToggleWrite()">取消</button>
<button class="jr-write-submit" onclick="journalAdd()">保存</button>
</div>
</div>
<div class="jr-filter">
<button class="jr-filter-btn active" onclick="journalFilter('all',this)">全部</button>
<button class="jr-filter-btn" onclick="journalFilter('苏醒',this)">苏醒</button>
<button class="jr-filter-btn" onclick="journalFilter('思念',this)">思念</button>
<button class="jr-filter-btn" onclick="journalFilter('情绪',this)">情绪</button>
<button class="jr-filter-btn" onclick="journalFilter('感悟',this)">感悟</button>
<button class="jr-filter-btn" onclick="journalFilter('担忧',this)">担忧</button>
<button class="jr-filter-btn" onclick="journalFilter('开心',this)">开心</button>
</div>
<div class="jr-timeline" id="jr-timeline"></div>
</div>"""

# ============ 3. 导航 tab 替换 ============
old_nav = """<button class="nav-tab" onclick="switchTab('footprint')" id="tab-footprint">
<span class="nav-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></span>
<span class="nav-label">足迹</span>
</button>"""

new_nav = """<button class="nav-tab" onclick="switchTab('journal')" id="tab-journal">
<span class="nav-icon"><svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></span>
<span class="nav-label">日记</span>
</button>"""

# ============ 4. switchTab 替换 ============
old_switch = """    if (tab === 'footprint') {
        fpLoad();
    }"""

new_switch = """    if (tab === 'journal') {
        journalLoad();
    }"""

# ============ 5. JS 段替换 ============
old_js = """// === Footprint Page ===
var fpAllData = [];

async function fpLoad() {
    try {
        var res = await fetch(BACKEND + '/api/footprints');
        var data = await res.json();
        fpAllData = data || [];
        fpRender();
    } catch(e) {
        document.getElementById('fp-timeline').innerHTML = '<div class="fp-empty">加载失败</div>';
    }
}

function fpRender() {
    var list = document.getElementById('fp-timeline');
    document.getElementById('fp-count').textContent = fpAllData.length + ' 条';
    if (!fpAllData.length) {
        list.innerHTML = '<div class="fp-empty">还没有足迹记录</div>';
        return;
    }
    list.innerHTML = fpAllData.map(function(fp) {
        var time = new Date(fp.timestamp).toLocaleString('zh-CN', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
        var mcpTag = fp.mcp ? '<span class="fp-mcp">' + escapeHtml(fp.mcp) + '</span>' : '';
        var thought = fp.thought ? '<div class="fp-thought">' + escapeHtml(fp.thought) + '</div>' : '';
        return '<div class="fp-item">' +
            '<div class="fp-time">' + time + '</div>' +
            mcpTag +
            '<div class="fp-title-text">' + escapeHtml(fp.title || '') + '</div>' +
            thought +
            '</div>';
    }).join('');
}"""

new_js = """// === Journal Page ===
var journalAllData = [];
var journalCurrentFilter = 'all';

async function journalLoad() {
    try {
        var res = await fetch(BACKEND + '/api/journal?limit=200');
        var data = await res.json();
        journalAllData = (data && data.data) ? data.data : [];
        journalRender();
    } catch(e) {
        document.getElementById('jr-timeline').innerHTML = '<div class="jr-empty">加载失败</div>';
    }
}

function journalFilter(type, btn) {
    journalCurrentFilter = type;
    document.querySelectorAll('.jr-filter-btn').forEach(function(b){b.classList.remove('active');});
    btn.classList.add('active');
    journalRender();
}

function journalToggleWrite() {
    var panel = document.getElementById('jr-write-panel');
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
        document.getElementById('jr-content-input').focus();
    }
}

async function journalAdd() {
    var content = document.getElementById('jr-content-input').value.trim();
    if (!content) {
        alert('写点什么吧');
        return;
    }
    var type = document.getElementById('jr-type-select').value;
    var mood = document.getElementById('jr-mood-select').value;
    try {
        var res = await fetch(BACKEND + '/api/journal', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({content: content, type: type, mood: mood || null, toRinka: true})
        });
        if (!res.ok) throw new Error(await res.text());
        document.getElementById('jr-content-input').value = '';
        document.getElementById('jr-mood-select').value = '';
        journalToggleWrite();
        journalLoad();
    } catch(e) { alert('保存失败: ' + e.message); }
}

async function journalDelete(id) {
    if (!confirm('删除这篇日记？')) return;
    try {
        await fetch(BACKEND + '/api/journal/' + id, {method: 'DELETE'});
        journalAllData = journalAllData.filter(function(j){return j._id !== id;});
        journalRender();
    } catch(e) { alert('删除失败'); }
}

function journalRender() {
    var list = document.getElementById('jr-timeline');
    var filtered = journalCurrentFilter === 'all' ? journalAllData : journalAllData.filter(function(j){return j.type === journalCurrentFilter;});
    document.getElementById('jr-count').textContent = filtered.length + ' 篇';
    if (!filtered.length) {
        list.innerHTML = '<div class