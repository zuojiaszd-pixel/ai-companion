const mongoose = require('mongoose');

const MemorySchema = new mongoose.Schema({
    sessionId: { type: String, default: 'default' },
    content: String,
    embedding: [Number],
    type: { type: String, enum: ['fact', 'preference', 'experience', 'summary', 'state'], default: 'fact' },
    priority: { type: String, enum: ['critical', 'high', 'normal', 'low'], default: 'normal' },
    tags: [String],

    // 情绪层 - Rinka的情绪
    mood: { type: String, default: null },  // positive | negative | neutral | anxious | sad | happy | frustrated | tired | touched | excited | etc.
    // 情绪强度 0-1
    moodIntensity: { type: Number, default: null },
    // Lumi记录这个记忆时的情绪
    lumiMood: { type: String, default: null },
    
    // 热度系统
    heat: { type: Number, default: 1.0 },
    baseHeat: { type: Number, default: 1.0 },
    halfLife: { type: Number, default: 30 },
    lastAccessed: { type: Date, default: Date.now },
    accessCount: { type: Number, default: 0 },
    
    // 矛盾处理
    supersededBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    contradicted: { type: Boolean, default: false },
    
    // 锁定
    locked: { type: Boolean, default: false },
    
    // 归档（替代删除）
    archived: { type: Boolean, default: false },
    archivedAt: { type: Date, default: null },
    embeddingArchived: { type: Boolean, default: false },
    
    // 关联
    relatedTags: { type: [String], default: [] },
    relatedIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// 优先级映射基础热度和半衰期
const PRIORITY_MAP = {
    critical: { baseHeat: 3.0, halfLife: 365 },
    high: { baseHeat: 2.0, halfLife: 90 },
    normal: { baseHeat: 1.0, halfLife: 30 },
    low: { baseHeat: 0.5, halfLife: 7 }
};

// 实例方法：衰减热度
MemorySchema.methods.decayHeat = function() {
    if (this.locked) return this.heat;
    const now = new Date();
    const daysSinceAccess = (now - this.lastAccessed) / (1000 * 60 * 60 * 24);
    if (daysSinceAccess <= 0) return this.heat;
    this.heat = this.baseHeat * Math.pow(0.5, daysSinceAccess / this.halfLife);
    return this.heat;
};

// 实例方法：被检索命中时回弹热度
MemorySchema.methods.touch = function() {
    this.accessCount += 1;
    this.lastAccessed = new Date();
    this.heat = Math.max(this.heat, this.baseHeat);
    return this.heat;
};

// 静态方法：根据优先级设置基础热度
MemorySchema.statics.applyPriorityDefaults = function(priority) {
    const config = PRIORITY_MAP[priority] || PRIORITY_MAP.normal;
    return { baseHeat: config.baseHeat, halfLife: config.halfLife, heat: config.baseHeat };
};

module.exports = mongoose.model('Memory', MemorySchema);
