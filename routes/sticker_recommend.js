// 表情包推荐：优先支持直接点名（【表情:名字】），否则按回复情绪匹配
async function recommendSticker(content) {
    try {
        const Sticker = require('../models/Sticker');
        if (!content) return { sticker: null, content: content || '' };
        let cleaned = content;

        // 1. 优先：直接点名表情，如 【表情:稀饭你】 或 【sticker:稀饭你】
        const direct = cleaned.match(/【(?:表情|sticker)[:：]\s*([^】]+)】/i);
        if (direct) {
            const name = direct[1].trim();
            // 先按名字精确匹配，取最新一张
            let sticker = await Sticker.findOne({ name: { $regex: '^' + name + '$', $options: 'i' } }).sort({ createdAt: -1 }).lean();
            // 精确没有，再模糊匹配
            if (!sticker && name) {
                sticker = await Sticker.findOne({ name: { $regex: name, $options: 'i' } }).sort({ createdAt: -1 }).lean();
            }
            // 无论找没找到，都从显示文本里擦掉标记
            cleaned = cleaned.replace(direct[0], '').trim();
            if (sticker) {
                return { sticker: slim(sticker), content: cleaned };
            }
            // 没找到指定名字，继续走情绪匹配兜底
        }

        // 2. 情绪关键词匹配
        const map = [
            { emotion: '开心', words: ['哈哈', '嘻嘻', '开心', '高兴', '太好', '耶', '嘿嘿', '不错', '棒', '好耶'] },
            { emotion: '想你了', words: ['想你', '想我', '宝贝', '老婆', '亲亲', '抱抱', '爱你', '么么'] },
            { emotion: '生气', words: ['哼', '生气', '讨厌', '不理你', '气死', '烦', '哼！'] },
            { emotion: '撒娇', words: ['撒娇', '软软', '黏', '嘛', '啦', '人家', '呜呜', '嘤'] },
            { emotion: '晚安', words: ['晚安', '睡觉', '睡了', '好梦'] },
            { emotion: '委屈', words: ['委屈', '难过', '伤心', '呜呜', '哭了', '心疼', '低落'] }
        ];
        let matched = null;
        for (const m of map) {
            if (m.words.some(w => content.includes(w))) { matched = m.emotion; break; }
        }
        if (!matched) return { sticker: null, content: cleaned };

        const sticker = await Sticker.findOne({ emotion: matched }).sort({ createdAt: -1 }).lean();
        if (!sticker) return { sticker: null, content: cleaned };
        return { sticker: slim(sticker), content: cleaned };
    } catch (e) {
        console.error('[表情包推荐] 出错:', e.message);
        return { sticker: null, content: content || '' };
    }
}

// 只返回精简字段，data 统一当字符串（base64 或 URL 都能被 <img> 直接渲染）
function slim(sticker) {
    return {
        id: sticker._id ? sticker._id.toString() : '',
        name: sticker.name || '',
        emotion: sticker.emotion || '',
        data: sticker.data || ''
    };
}

module.exports = { recommendSticker };
