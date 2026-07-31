// === MCP Manager (前端逻辑) ===
var mcpEditingName = null;

function toggleLeftMenu() { document.getElementById('left-menu').classList.toggle('open'); }
document.addEventListener('click', function (e) {
    var m = document.getElementById('left-menu');
    var b = document.getElementById('left-menu-btn');
    if (m && m.classList.contains('open') && b && !m.contains(e.target) && !b.contains(e.target)) m.classList.remove('open');
});
function leftMenuGo(tab) {
    document.getElementById('left-menu').classList.remove('open');
    switchTab(tab);
}
function mcpQ(s) { return String(s == null ? '' : s).replace(/'/g, "\\'"); }
function mcpEscape(s) { return escapeHtml(String(s == null ? '' : s)); }

function mcpLoad() {
    mcpHideForm();
    var list = document.getElementById('mcp-list');
    if (!list) return;
    list.innerHTML = '<div class="mcp-empty">加载中…</div>';
    fetch('/api/mcp').then(function (r) { return r.json(); }).then(function (servers) {
        return fetch('/api/mcp/config').then(function (r) { return r.json(); }).then(function (cfg) {
            return { servers: servers, cfg: cfg };
        });
    }).then(function (d) {
        var t = document.getElementById('mcp-global-timeout');
        if (t && d.cfg && d.cfg.globalTimeout) t.value = d.cfg.globalTimeout;
        mcpRenderServers(d.servers);
    }).catch(function (e) {
        list.innerHTML = '<div class="mcp-empty">加载失败：' + mcpEscape(e.message) + '</div>';
    });
}

function mcpRenderServers(servers) {
    var html = '';
    servers.forEach(function (s) {
        var toolsId = 'mcp-tools-' + s.name;
        var testId = 'mcp-test-' + s.name;
        html += '<div class="mcp-card' + (s.enabled ? '' : ' disabled') + '">'
            + '<div class="mcp-card-head"><span class="mcp-status ' + (s.enabled ? 'on' : 'off') + '"></span>'
            + '<span class="mcp-name">' + mcpEscape(s.name) + '</span>'
            + '<span class="mcp-badge">' + (s.toolCount || 0) + ' 个工具</span></div>'
            + (s.description ? '<div class="mcp-card-desc">' + mcpEscape(s.description) + '</div>' : '')
            + '<div class="mcp-card-url">' + mcpEscape(s.url) + '</div>'
            + '<div class="mcp-card-actions">'
            + '<button onclick="mcpTest(\'' + mcpQ(s.name) + '\')">测试</button>'
            + '<button onclick="mcpViewTools(\'' + mcpQ(s.name) + '\')">工具</button>'
            + '<button onclick="mcpEdit(\'' + mcpQ(s.name) + '\')">编辑</button>'
            + '<button onclick="mcpToggle(\'' + mcpQ(s.name) + '\')">' + (s.enabled ? '停用' : '启用') + '</button>'
            + '<button class="danger" onclick="mcpDelete(\'' + mcpQ(s.name) + '\')">删除</button>'
            + '</div>'
            + '<div class="mcp-test-result" id="' + testId + '"></div>'
            + '<div class="mcp-tools" id="' + toolsId + '" style="display:none"></div>'
            + '</div>';
    });
    document.getElementById('mcp-list').innerHTML = html || '<div class="mcp-empty">还没有 MCP 服务器，点「新增服务器」加一个吧</div>';
}

function mcpShowForm() {
    mcpEditingName = null;
    document.getElementById('mcp-form-title').textContent = '新增服务器';
    ['mcp-f-name', 'mcp-f-desc', 'mcp-f-url', 'mcp-f-headers', 'mcp-f-timeout'].forEach(function (id) { document.getElementById(id).value = ''; });
    document.getElementById('mcp-f-type').value = 'http';
    document.getElementById('mcp-form-result').innerHTML = '';
    document.getElementById('mcp-form').style.display = 'block';
}
function mcpHideForm() {
    var f = document.getElementById('mcp-form');
    if (f) f.style.display = 'none';
}
function mcpEdit(name) {
    fetch('/api/mcp').then(function (r) { return r.json(); }).then(function (servers) {
        var s = servers.find(function (x) { return x.name === name; });
        if (!s) { alert('找不到服务器: ' + name); return; }
        mcpEditingName = name;
        document.getElementById('mcp-form-title').textContent = '编辑服务器：' + name;
        document.getElementById('mcp-f-name').value = s.name;
        document.getElementById('mcp-f-desc').value = s.description || '';
        document.getElementById('mcp-f-type').value = s.type || 'http';
        document.getElementById('mcp-f-url').value = s.url || '';
        document.getElementById('mcp-f-headers').value = s.headers ? JSON.stringify(s.headers, null, 2) : '';
        document.getElementById('mcp-f-timeout').value = s.timeout || '';
        document.getElementById('mcp-form-result').innerHTML = '';
        document.getElementById('mcp-form').style.display = 'block';
    }).catch(function (e) { alert('加载失败: ' + e.message); });
}
function mcpFormData() {
    var headers = {};
    var h = document.getElementById('mcp-f-headers').value.trim();
    if (h) {
        try { headers = JSON.parse(h); } catch (e) { throw new Error('Headers 不是合法的 JSON'); }
    }
    var data = {
        name: document.getElementById('mcp-f-name').value.trim(),
        description: document.getElementById('mcp-f-desc').value.trim(),
        type: document.getElementById('mcp-f-type').value,
        url: document.getElementById('mcp-f-url').value.trim(),
        headers: headers,
        enabled: true
    };
    var to = document.getElementById('mcp-f-timeout').value.trim();
    if (to) data.timeout = parseInt(to, 10);
    if (!data.name) throw new Error('名称不能为空');
    if (!data.url) throw new Error('URL 不能为空');
    return data;
}
function mcpSave() {
    var data;
    try { data = mcpFormData(); } catch (e) { alert(e.message); return; }
    var method = mcpEditingName ? 'PUT' : 'POST';
    var url = mcpEditingName ? '/api/mcp/' + encodeURIComponent(mcpEditingName) : '/api/mcp';
    fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
        .then(function (r) { return r.json(); })
        .then(function (res) {
            if (res.error) throw new Error(res.error);
            mcpHideForm();
            mcpLoad();
        })
        .catch(function (e) { alert('保存失败: ' + e.message); });
}
function mcpDelete(name) {
    if (!confirm('确定删除 MCP 服务器「' + name + '」？')) return;
    fetch('/api/mcp/' + encodeURIComponent(name), { method: 'DELETE' })
        .then(function (r) { return r.json(); })
        .then(function (res) {
            if (res.error) throw new Error(res.error);
            mcpLoad();
        })
        .catch(function (e) { alert('删除失败: ' + e.message); });
}
function mcpToggle(name) {
    fetch('/api/mcp').then(function (r) { return r.json(); }).then(function (servers) {
        var s = servers.find(function (x) { return x.name === name; });
        if (!s) return null;
        s.enabled = !s.enabled;
        return fetch('/api/mcp/' + encodeURIComponent(name), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) });
    }).then(function (r) { if (r) return r.json(); }).then(function (res) {
        if (res && res.error) throw new Error(res.error);
        mcpLoad();
    }).catch(function (e) { alert('操作失败: ' + e.message); });
}
function mcpTest(name) {
    var el = document.getElementById('mcp-test-' + name);
    if (!el) return;
    el.innerHTML = '<span style="color:var(--text3)">测试中…</span>';
    fetch('/api/mcp/' + encodeURIComponent(name) + '/test', { method: 'POST' })
        .then(function (r) { return r.json(); })
        .then(function (res) {
            if (res.ok) {
                el.innerHTML = '<span style="color:#4cd964">✓ 连接成功，' + (res.tools ? res.tools.length : 0) + ' 个工具</span>';
            } else {
                el.innerHTML = '<span style="color:#e74c3c">✗ ' + mcpEscape(res.error || '连接失败') + '</span>';
            }
        })
        .catch(function (e) { el.innerHTML = '<span style="color:#e74c3c">✗ ' + mcpEscape(e.message) + '</span>'; });
}
function mcpTestForm() {
    var data;
    try { data = mcpFormData(); } catch (e) { document.getElementById('mcp-form-result').innerHTML = '<span style="color:#e74c3c">✗ ' + mcpEscape(e.message) + '</span>'; return; }
    var name = mcpEditingName || data.name;
    var el = document.getElementById('mcp-form-result');
    el.innerHTML = '<span style="color:var(--text3)">测试中…</span>';
    fetch('/api/mcp/' + encodeURIComponent(name) + '/test', { method: 'POST' })
        .then(function (r) { return r.json(); })
        .then(function (res) {
            if (res.ok) {
                el.innerHTML = '<span style="color:#4cd964">✓ 连接成功，' + (res.tools ? res.tools.length : 0) + ' 个工具</span>';
            } else {
                el.innerHTML = '<span style="color:#e74c3c">✗ ' + mcpEscape(res.error || '连接失败') + '</span>';
            }
        })
        .catch(function (e) { el.innerHTML = '<span style="color:#e74c3c">✗ ' + mcpEscape(e.message) + '</span>'; });
}
function mcpViewTools(name) {
    var el = document.getElementById('mcp-tools-' + name);
    if (!el) return;
    if (el.style.display === 'none') {
        el.style.display = 'block';
        if (!el.dataset.loaded) {
            el.innerHTML = '<div class="mcp-empty">加载中…</div>';
            fetch('/api/mcp/' + encodeURIComponent(name) + '/tools')
                .then(function (r) { return r.json(); })
                .then(function (tools) {
                    el.dataset.loaded = '1';
                    var html = '';
                    tools.forEach(function (t) {
                        html += '<div class="mcp-tool"><span class="t-name">' + mcpEscape(t.name) + '</span>'
                            + '<span class="t-desc">' + mcpEscape(t.description || '') + '</span>'
                            + '<button class="t-btn" onclick="mcpCallTool(\'' + mcpQ(name) + '\',\'' + mcpQ(t.name) + '\')">调用</button></div>';
                    });
                    el.innerHTML = html || '<div class="mcp-empty">没有工具</div>';
                })
                .catch(function (e) { el.innerHTML = '<div class="mcp-empty">加载失败：' + mcpEscape(e.message) + '</div>'; });
        }
    } else {
        el.style.display = 'none';
    }
}
function mcpCallTool(name, tool) {
    var argStr = prompt('调用 ' + tool + '\n参数 (JSON，留空则无参数):', '{}');
    if (argStr === null) return;
    var args = {};
    if (argStr.trim()) {
        try { args = JSON.parse(argStr); } catch (e) { alert('参数不是合法的 JSON'); return; }
    }
    fetch('/api/mcp/' + encodeURIComponent(name) + '/call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: tool, args: args }) })
        .then(function (r) { return r.json(); })
        .then(function (res) {
            if (res.error) { alert('调用失败: ' + res.error); return; }
            alert('✓ 调用成功\n\n' + (typeof res.result === 'string' ? res.result : JSON.stringify(res.result, null, 2)));
        })
        .catch(function (e) { alert('调用失败: ' + e.message); });
}
function mcpSaveTimeout() {
    var v = document.getElementById('mcp-global-timeout').value.trim();
    var timeout = parseInt(v, 10);
    if (!timeout || timeout < 1000) { alert('超时至少 1000ms'); return; }
    fetch('/api/mcp/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ globalTimeout: timeout }) })
        .then(function (r) { return r.json(); })
        .then(function (res) {
            if (res.error) throw new Error(res.error);
            alert('✓ 全局超时已保存');
        })
        .catch(function (e) { alert('保存失败: ' + e.message); });
}
