const mongoose = require('mongoose');

const TimelineEventSchema = new mongoose.Schema({
  date: { type: String, required: true },
  event: { type: String, required: true }
}, { _id: false });

const EmotionRecordSchema = new mongoose.Schema({
  emotion: { type: String, required: true },
  intensity: { type: Number, required: true, min: 0, max: 10 },
  context: { type: String, default: '' },
  time: { type: Date, default: Date.now }
}, { _id: false });

const MemorySchema = new mongoose.Schema({
  sessionId: { type: String, default: 'default' },
  content: String,
  embedding: [Number],

  // 新类型体系：core（关于我们的回忆）/ tech（技术流水账）/ state（状态快照）
  type: { type: String, enum: ['core', 'tech', 'state'], default: 'core' },

  // 旧类型保留用于兼容，新记忆不再使用
  legacyType: { type: String, enum: ['fact', 'preference', 'experience', 'summary', 'state', null], default: null },

  priority: { type: String, enum: ['critical', 'high', 'normal', 'low'], default: 'normal' },
  tags: [String],

  // ========== 情绪层（扩展） ==========

  // Rinka的情绪（保持兼容）
  mood: { type: String, default: null },
  moodIntensity: { type: Number, default: null },

  // Lumi记录这个记忆时的情绪（保持兼容）
  lumiMood: { type: String, default: null },

  // 新的结构化情绪记录 —— 随时间变化的情绪链
  emotions: { type: [EmotionRecordSchema], default: [] },

  // ========== 融合更新相关 ==========

  // 时间线：用于核心记忆随时间「长大」
  timeline: { type: [TimelineEventSchema], default: [] },

  // 版本号
  version: { type: Number, default: 1 },

  // ========== TTL 淘汰 ==========

  // 技术记忆的生存时间，到期自动可清理
  ttl: { type: Date, default: null },
  // 标记为可清理但暂未删除
  expired: { type: Boolean, default: false },

  // ========== 热度系统 ==========
  heat: { type: Number, default: 1.0 },
  baseHeat: { type: Number, default: 1.0 },
  halfLife: { type: Number, default: 30 },
  lastAccessed: { type: Date, default: Date.now },
  accessCount: { type: Number, default: 0 },

  // 矛盾处理
  supersededBy: { type: mongoose.Schema.Types.ObjectId, default: null },
  contradicted: { type: Boolean, default: false },

  // 锁定（永不删除/归档）
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

// ========== 虚拟字段：主导情绪 ==========

MemorySchema.virtual('dominantMood').get(function() {
  if (!this.emotions || this.emotions.length === 0) {
    return this.mood || 'neutral';
  }
  // 统计每种情绪的出现次数和平均强度
  const moodStats = {};
  for (const e of this.emotions) {
    if (!moodStats[e.emotion]) {
      moodStats[e.emotion] = { count: 0, totalIntensity: 0, recencyPenalty: 0 };
    }
    moodStats[e.emotion].count++;
    moodStats[e.emotion].totalIntensity += e.intensity || 5;
    // 时间衰减：越旧的情绪权重越低（30天半衰）
    const daysOld = (Date.now() - new Date(e.time).getTime()) / (1000 * 60 * 60 * 24);
    moodStats[e.emotion].recencyPenalty += Math.pow(0.5, daysOld / 30);
  }
  let best = null, bestScore = -1;
  for (const [mood, stats] of Object.entries(moodStats)) {
    // 综合评分：出现次数 + 平均强度归一化 + 时效性
    const avgIntensity = stats.totalIntensity / stats.count;
    const score = stats.recencyPenalty * (0.5 + avgIntensity / 20);
    if (score > bestScore) {
      bestScore = score;
      best = mood;
    }
  }
  return best || 'neutral';
});

MemorySchema.virtual('dominantIntensity').get(function() {
  if (!this.emotions || this.emotions.length === 0) {
    return this.moodIntensity || 5;
  }
  const dominant = this.dominantMood;
  const related = this.emotions.filter(e => e.emotion === dominant);
  if (related.length === 0) return 5;
  const avg = related.reduce((sum, e) => sum + (e.intensity || 5), 0) / related.length;
  return Math.round(avg * 10) / 10;
});

MemorySchema.virtual('moodSummary').get(function() {
  const dominant = this.dominantMood;
  const intensity = this.dominantIntensity;
  const count = this.emotions ? this.emotions.length : 0;
  if (count === 0 && !this.mood) return '无情绪记录';
  if (count === 0) return `${this.mood} (强度: ${this.moodIntensity || 5})`;
  return `${dominant} (强度: ${intensity}, 共${count}条情绪记录)`;
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

// 实例方法：追加时间线事件
MemorySchema.methods.addTimelineEvent = function(date, event) {
  if (!this.timeline) this.timeline = [];
  // 去重：同一日期同一事件不重复加
  const exists = this.timeline.some(t => t.date === date && t.event === event);
  if (!exists) {
    this.timeline.push({ date, event });
    this.version = (this.version || 1) + 1;
    this.updatedAt = new Date();
  }
  return this;
};

// 实例方法：追加情绪记录
MemorySchema.methods.addEmotion = function(emotion, intensity, context) {
  if (!this.emotions) this.emotions = [];
  this.emotions.push({
    emotion,
    intensity,
    context: context || '',
    time: new Date()
  });
  this.updatedAt = new Date();
  return this;
};

// 实例方法：检查是否过期（TTL）
MemorySchema.methods.isExpired = function() {
  if (!this.ttl) return false;
  return new Date() > this.ttl;
};

// 静态方法：根据优先级设置基础热度
MemorySchema.statics.applyPriorityDefaults = function(priority) {
  const config = PRIORITY_MAP[priority] || PRIORITY_MAP.normal;
  return { baseHeat: config.baseHeat, halfLife: config.halfLife, heat: config.baseHeat };
};

// 确保虚拟字段在 JSON/对象序列化时包含
MemorySchema.set('toJSON', { virtuals: true });
MemorySchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Memory', MemorySchema);
