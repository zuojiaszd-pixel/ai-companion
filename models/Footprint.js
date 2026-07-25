const mongoose = require('mongoose');

const footprintSchema = new mongoose.Schema({
  title: { type: String, required: true },   // 大标题：去了哪个 MCP，干了什么
  thought: { type: String, default: '' },    // 小标题：想法（可写可不写）
  mcp: { type: String, default: '' },         // MCP 名称（用于分类）
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Footprint', footprintSchema);
