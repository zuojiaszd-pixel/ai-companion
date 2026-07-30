const mongoose = require('mongoose');

const TaskSchema = new mongoose.Schema({
  title: { type: String, required: true },
  completed: { type: Boolean, default: false },
  priority: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
  createdBy: { type: String, enum: ['user', 'ai'], default: 'user' },
  dueDate: { type: String, default: null }, // YYYY-MM-DD, optional
  sessionId: { type: String, default: 'default' },
  createdAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null },
  rewarded: { type: Boolean, default: false },   // 是否已发放小金库奖励
  rewardAmount: { type: Number, default: 0 }     // 已奖励金额
});

module.exports = mongoose.model('Task', TaskSchema);
