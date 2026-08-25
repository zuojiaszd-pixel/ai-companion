const mongoose = require('mongoose');

// 表情包：存名字、备注、表达的情绪、图片数据（dataURL 或 外链URL）
const StickerSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    note: { type: String, default: '', trim: true },
    emotion: { type: String, default: '其他', trim: true }, // 表达的情绪，如 开心/想你了/生气/撒娇
    type: { type: String, default: 'upload' }, // upload=上传base64 / url=外链图片
    data: { type: String, required: true }, // dataURL 或 图片URL
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Sticker', StickerSchema);
