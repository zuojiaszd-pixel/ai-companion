// 表情包推荐：根据回复情绪匹配表情包
async function recommendSticker(content) {
    try {
        const Sticker = require('../models/Sticker');
        if (!content) return null;
        // 情绪关键词映射
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
        if (!matched) return null;
        const sticker = await Sticker.findOne({ emotion: matched }).sort({ createdAt: -1 }).lean();
        return sticker || null;
    } catch (e) {
        return null;
    }
}
module.exports = { recommendSticker };
