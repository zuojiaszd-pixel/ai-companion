const mongoose = require('mongoose');

const CalendarSchema = new mongoose.Schema({
  date: { type: String, required: true, index: true }, // YYYY-MM-DD
  title: { type: String, required: true },
  color: { type: String, default: '#f5a0b8' },
  sessionId: { type: String, default: 'default' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Calendar', CalendarSchema);
