import sys, re
sys.stdout.reconfigure(encoding='utf-8')
with open('index.html', 'r', encoding='utf-8') as f:
    html = f.read()

idx_start = html.find('<style>') + len('<style>')
idx_end = html.find('</style>')
css = html[idx_start:idx_end]

# 1. Root colors - macaron
root_new = ':root {\\n    --bg: #fdf6f8;\\n    --bg2: #fff9fb;\\n    --surface: rgba(255,255,255,0.75);\\n    --surface2: #fff0f3;\\n    --accent: #e38a98;\\n    --accent2: #ed9eb0;\\n    --accent-dark: #d67886;\\n    --text: #3a2c32;\\n    --text2: #8a7080;\\n    --text3: #c0a8b2;\\n    --border: rgba(232,148,160,0.14);\\n    --shadow: 0 2px 12px rgba(232,148,160,0.06);\\n    --radius: 12px;\\n    --radius-sm: 8px;\\n    --font: -apple-system, FontName, sans-serif;\\n}'

# Find and replace root
old_root_marker = ':root {'
root_start = css.find(old_root_marker)
root_end = css.find('[data-theme=', root_start)
if root_start >= 0 and root_end > root_start:
    css = css[:root_start] + root_new + css[root_end:]

# 2. Dark theme update
dark_idx = css.find('[data-theme="dark"]')
if dark_idx >= 0:
    dark_end = css.find('}', dark_idx) + 1
    old_dark = css[dark_idx:dark_end]
    new_dark_css = '[data-theme="dark"] {\\n    --bg: #1a1417; --bg2: #22181d; --surface: rgba(37,28,33,0.85);\\n    --accent: #d67890; --accent2: #e892a8;\\n    --text: #f0e6ea; --text2: #c4aeb6; --text3: #7f6670;\\n    --border: rgba(208,106,134,0.15);\\n}'
    css = css.replace(old_dark, new_dark_css)

# 3. Delete old body::before if exists (to re-add)
css = re.sub(r'body::before\\{[^}]+\\}', '', css)

# 4. Add background polka dots pattern before body display
body_display = css.find('body{display:flex')
if body_display >= 0:
    bg_dots = 'body::before{content:\\"\\";position:fixed;width:100%;height:100%;background-image:radial-gradient(circle,rgba(232,148,160,0.1) 1.5px,transparent 1.5px);background-size:24px 24px;pointer-events:none;z-index:0}'
    css = css[:body_display] + bg_dots + css[body_display:]

# 5. Header frosted glass
old_h = 'header{padding:8px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;background:var(--bg2);z-index:10;flex-shrink:0;min-height:52px}'
new_h = 'header{padding:8px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.65);-webkit-backdrop-filter:blur(24px);backdrop-filter:blur(24px);z-index:10;flex-shrink:0;min-height:50px}'
css = css.replace(old_h, new_h)

# 6. Input area frosted glass
old_ia = '#input-area{padding:10px 14px;border-top:1px solid var(--border);background:var(--bg);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);flex-shrink:0}'
new_ia = '#input-area{padding:10px 14px;border-top:1px solid var(--border);background:rgba(255,255,255,0.65);-webkit-backdrop-filter:blur(24px);backdrop-filter:blur(24px);flex-shrink:0}'
css = css.replace(old_ia, new_ia)

# 7. Dark mode header/input
css = css.replace('[data-theme="dark"] header{background:rgba(23,17,21,.9)}[data-theme="dark"] #input-area{background:rgba(23,17,21,.9)}',
'[data-theme="dark"] header{background:rgba(26,20,23,0.8)}[data-theme="dark"] #input-area{background:rgba(26,20,23,0.8)}')

html = html[:idx_start] + css + html[idx_end:]
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(html)
print('Applied!')
