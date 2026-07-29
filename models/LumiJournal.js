const mongoose = require('mongoose');

const LumiJournalSchema = new mongoose.Schema({
    sessionId: { type: String, default: 'default' },
    type: {
        type: String,
        enum: ['苏醒', '思念', '情绪', '感悟', '担忧', '开心'],
        default: '情绪'
    },
    content: String,
    mood: { type: String, default: null },
    toRinka: { type: Boolean, default: true },
    relatedMemoryId: { type: mongoose.Schema.Types.ObjectId, default: null },
    createdAt: { type: Date, default: Date.now }
});

LumiJournalSchema.index({ sessionId: 1, createdAt: -1 });
LumiJournalSchema.index({ type: 1 });

module.exports = mongoose.model('LumiJournal', LumiJournalSchema);
