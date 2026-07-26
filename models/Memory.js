const mongoose = require('mongoose');

const MemorySchema = new mongoose.Schema({
    sessionId: { type: String, default: 'default' },
    content: String,
    embedding: [Number],
    type: { type: String, enum: ['fact', 'preference', 'experience', 'summary'], default: 'fact' },
    priority: { type: String, enum: ['critical', 'high', 'normal', 'low'], default: 'normal' },
    tags: [String],
    
    // 热度系统
    heat: { type: Number, default: 1.0 },        // 当前热度
    baseHeat: { type: Number, default: 1.0 },    // 基础热度（由priority决定）
    halfLife: { type: Number, default: 30 },      // 半衰期（天）
    lastAccessed: { type: Date, default: Date.now }, // 最后访问时间
    accessCount: { type: Number, default: 0 },    // 被检索命中次数
    
    // 矛盾处理
    supersededBy: { type: mongoose.Schema.Types.ObjectId, default: null }, // 被哪条新记忆取代
    contradicted: { type: Boolean, default: false }, // 是否被标记为矛盾
    
    // 锁定
    locked: { type: Boolean, default: false }, // 锁定的记忆不会被衰减/清理
    
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
    if (this.locked) return this.heat; // 锁定不衰减
    const now = new Date();
    const daysSinceAccess = (now - this.lastAccessed) / (1000 * 60 * 60 * 24);
    if (daysSinceAccess <= 0) return this.heat;
    // 指数衰减: heat = baseHeat * (0.5 ^ (days / halfLife))
    this.heat = this.baseHeat * Math.pow(0.5, daysSinceAccess / this.halfLife);
    return this.heat;
};

// 实例方法：被检索命中时回弹热度
MemorySchema.methods.touch = function() {
    this.accessCount += 1;
    this.lastAccessed = new Date();
    // 回弹到基础热度和当前热度的最大值
    this.heat = Math.max(this.heat, this.baseHeat);
    return this.heat;
};

// 静态方法：根据优先级设置基础热度
MemorySchema.statics.applyPriorityDefaults = function(priority) {
    const config = PRIORITY_MAP[priority] || PRIORITY_MAP.normal;
    return { baseHeat: config.baseHeat, halfLife: config.halfLife, heat: config.baseHeat };
};

module.exports = mongoose.model('Memory', MemorySchema);