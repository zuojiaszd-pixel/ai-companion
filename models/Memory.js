const mongoose = require('mongoose');
const MemorySchema = new mongoose.Schema({
    sessionId: { type: String, default: 'default' },
    content: String,
    embedding: [Number],
    type: { type: String, enum: ['fact', 'preference', 'experience', 'summary'], default: 'fact' },
    priority: { type: String, enum: ['critical', 'high', 'normal', 'low'], default: 'normal' },
    tags: [{ type: String }],
    lastAccessed: { type: Date, default: Date.now },
    accessCount: { type: Number, default: 0 },
    timestamp: { type: Date, default: Date.now }
});
module.exports = mongoose.model('Memory', MemorySchema);
