# -*- coding: utf-8 -*-
# 修复 services/memory.js 的 recall 链路超时问题
import io

path = 'services/memory.js'
src = io.open(path, 'r', encoding='utf-8').read()
orig = src

# ========== 1. 替换整个 recallMemories 函数 ==========
start_marker = 'async function recallMemories('
end_marker = '// ============ 分层注入 ============'

start_idx = src.index(start_marker)
end_idx = src.index(end_marker)

patch = io.open('recall_patch.js', 'r', encoding='utf-8').read()

src = src[:start_idx] + patch + '\n' + src[end_idx:]

# ========== 2. keywordSearchArchived：排除 embedding ==========
old = """    const archived = await Memory.find({
        sessionId,
        archived: true,
        supersededBy: null
    }).limit(100).lean();"""
new = """    const archived = await Memory.find({
        sessionId,
        archived: true,
        supersededBy: null
    }).select('-embedding').limit(100).lean();"""
assert old in src, 'keywordSearchArchived 未找到'
src = src.replace(old, new, 1)

# ========== 3. findRelatedByTags：排除 embedding ==========
old = """        relatedTags: { $in: tagSet },
        _id: { $nin: excludeIds }
    }).limit(8).lean();"""
new = """        relatedTags: { $in: tagSet },
        _id: { $nin: excludeIds }
    }).select('-embedding').limit(8).lean();"""
assert old in src, 'findRelatedByTags 未找到'
src = src.replace(old, new, 1)

# ========== 4. getRelevantMemories 的 resident 查询：排除 embedding ==========
old = """            }).sort({ updatedAt: -1 }).limit(10).maxTimeMS(3000).lean(),"""
new = """            }).select('-embedding').sort({ updatedAt: -1 }).limit(10).maxTimeMS(3000).lean(),"""
assert old in src, 'resident 查询未找到'
src = src.replace(old, new, 1)

# ========== 5. getChatMemories 的 baseline/recent/mood 查询：排除 embedding ==========
old = """            priority: 'critical'
        }).limit(10).lean();"""
new = """            priority: 'critical'
        }).select('-embedding').limit(10).lean();"""
assert old in src, 'baselineMemories 未找到'
src = src.replace(old, new, 1)

old = """        }).sort({ createdAt: -1 }).limit(5).lean();"""
new = """        }).select('-embedding').sort({ createdAt: -1 }).limit(5).lean();"""
assert old in src, 'recentMemories 未找到'
src = src.replace(old, new, 1)

old = """        }).sort({ createdAt: -1 }).limit(20).lean();"""
new = """        }).select('-embedding').sort({ createdAt: -1 }).limit(20).lean();"""
assert old in src, 'moodMemories 未找到'
src = src.replace(old, new, 1)

io.open(path, 'w', encoding='utf-8').write(src)
print('替换完成，文件已保存')
print('原长度:', len(orig), '新长度:', len(src))
