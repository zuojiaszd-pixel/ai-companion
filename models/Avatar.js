const mongoose = require('mongoose');

const AvatarSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true }, // 'userAvatar' or 'aiAvatar'
    value: { type: String, required: true }, // emoji character or data URL
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Avatar', AvatarSchema);
