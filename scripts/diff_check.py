a = open('/tmp/index_head.html').read()
b = open('/home/ubuntu/ai-companion/frontend/index.html').read()
print('HEAD长度:', len(a))
print('当前长度:', len(b))

# 找第一个不同位置
first_diff = None
for i in range(min(len(a), len(b))):
    if a[i] != b[i]:
        first_diff = i
        break

if first_diff is not None:
    print('第一个差异位置:', first_diff)
    print('HEAD上下文:', repr(a[max(0, first_diff-150):first_diff+250]))
    print()
    print('当前上下文:', repr(b[max(0, first_diff-150):first_diff+250]))

# 找所有差异位置
import difflib
sm = difflib.SequenceMatcher(None, a, b)
print('\n=== 所有差异块 ===')
for tag, i1, i2, j1, j2 in sm.get_opcodes():
    if tag != 'equal':
        print(f'\n[{tag}] HEAD[{i1}:{i2}] vs 当前[{j1}:{j2}]')
        print('HEAD内容:', repr(a[i1:i2][:300]))
        print('当前内容:', repr(b[j1:j2][:300]))
