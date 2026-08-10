const mongoose = require('mongoose');

const CalendarSchema = new mongoose.Schema({
  date: { type: String, index: true }, // YYYY-MM-DD（备忘录可不填，填了当截止日期）
  title: { type: String, required: true },
  color: { type: String, default: '#f5a0b8' },
  done: { type: Boolean, default: false },       // 是否已完成（备忘录打勾）
  doneAt: { type: Date, default: null },          // 完成时间
  type: { type: String, default: 'event', enum: ['event', 'memo'] }, // event=日历事件 memo=备忘录任务
  sessionId: { type: String, default: 'default' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Calendar', CalendarSchema);
