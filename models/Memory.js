const mongoose = require('mongoose');
const MemorySchema = new mongoose.Schema({
    sessionId: { type: String, default: 'default' },
    content: String,
    embedding: [Number],
    type: { type: String, enum: ['fact','summary'], default: 'fact' },
    timestamp: { type: Date, default: Date.now }
});
module.exports = mongoose.model('Memory', MemorySchema);