const mongoose = require('mongoose');
const ChatSchema = new mongoose.Schema({
    role: { type: String, enum: ['user','assistant','system','tool'], required: true },
    content: String,
    name: String,
    tool_call_id: String,
    sessionId: { type: String, default: 'default' },
    timestamp: { type: Date, default: Date.now }
});
module.exports = mongoose.model('Chat', ChatSchema);