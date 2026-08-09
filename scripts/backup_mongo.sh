#!/bin/bash
# =============================================================
# Lumi 回忆库定期备份脚本 v3
# 数据源: Atlas 云端 (应用真正连接的库)
# - 记忆等小集合 (memories/lumijournals/...): 全量备份，永不丢弃
# - chats: 只保留近14天 (timestamp 为 Date 类型，用 $date 严格JSON过滤)
# - 每周日 03:00 由 cron 触发；检测到新增(chats或memories数量变化)才备份
# - 本地只保留最近 4 个批次，自动清理更旧的
# 用法: ./backup_mongo.sh [--force]   # --force 强制备份
# =============================================================

set -euo pipefail

BACKUP_ROOT="$HOME/ai-companion/backups/mongo"
MARKER="$BACKUP_ROOT/.last_counts"
LOG="$BACKUP_ROOT/backup.log"
KEEP=4
DAYS_KEEP_CHATS=14
STAMP=$(date +%Y%m%d-%H%M%S)

# ---- 从 .env 读取 Atlas 连接串 ----
ENV_FILE="$HOME/ai-companion/.env"
URI=""
if [ -f "$ENV_FILE" ]; then
  URI=$(grep '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"')
fi
if [ -z "$URI" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 错误: 找不到 DATABASE_URL (.env)" >> "$LOG"
  exit 1
fi

mkdir -p "$BACKUP_ROOT"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"
}

# ---- 读取所有库的 chats / memories 总数 ----
get_counts() {
  mongosh --quiet "$URI" --eval '
    const names = ["ai-companion", "lumi", "ai_companion"];
    let c = 0, m = 0;
    for (const n of names) {
      try {
        const dbx = db.getSiblingDB(n);
        c += dbx.chats.countDocuments();
      } catch(e) {}
      try {
        const dbx = db.getSiblingDB(n);
        m += dbx.memories.countDocuments();
      } catch(e) {}
    }
    print("COUNTS " + c + " " + m);
  ' 2>/dev/null | grep '^COUNTS ' | tail -1 | awk '{print $2, $3}'
}
read CHATS_NOW MEM_NOW <<< "$(get_counts)"
CHATS_NOW=${CHATS_NOW:-0}
MEM_NOW=${MEM_NOW:-0}

log "===== 备份检查 ====="
log "当前 chats=$CHATS_NOW, memories=$MEM_NOW"

# ---- 检测是否有新增 ----
LAST_LINE=$(cat "$MARKER" 2>/dev/null || echo "0 0")
LAST_CHATS=$(echo "$LAST_LINE" | awk '{print $1}')
LAST_MEM=$(echo "$LAST_LINE" | awk '{print $2}')

if [ "${1:-}" != "--force" ] && \
   [ "$CHATS_NOW" = "${LAST_CHATS:-x}" ] && [ "$MEM_NOW" = "${LAST_MEM:-x}" ] && \
   [ -n "$LAST_CHATS" ] && [ -n "$LAST_MEM" ]; then
  log "无新增数据，跳过本次备份 (上次 chats=$LAST_CHATS, memories=$LAST_MEM)"
  exit 0
fi

log "检测到新增 (上次 chats=$LAST_CHATS, memories=$LAST_MEM)，开始备份..."
OK_MEM=0
OK_CHATS=0

for DB in ai-companion lumi ai_companion; do
  # 确认库存在且有集合
  EXISTS=$(mongosh --quiet "$URI" --eval "print(db.getSiblingDB('$DB').getCollectionNames().length)" 2>/dev/null | grep -E '^[0-9]+$' | tail -1 || echo "0")
  [ "${EXISTS:-0}" = "0" ] && log "库 $DB 不存在或为空，跳过" && continue

  # ---- 1) 记忆等小集合: 全量备份 (排除 chats) ----
  if mongodump --uri="$URI" --db "$DB" \
    --excludeCollection=chats \
    --archive="$BACKUP_ROOT/${DB}-${STAMP}.memory.gz" --gzip 2>>"$LOG"; then
    log "[$DB] 记忆全量备份成功"
    OK_MEM=$((OK_MEM+1))
  else
    log "[$DB] 记忆备份失败!"
  fi

  # ---- 2) chats: 只保留近14天 ----
  SINCE=$(date -u -d "$DAYS_KEEP_CHATS days ago" +%Y-%m-%dT%H:%M:%S.000Z)
  QUERY="{\"timestamp\":{\"\$gte\":{\"\$date\":\"$SINCE\"}}}"
  if mongodump --uri="$URI" --db "$DB" --collection chats \
    --query="$QUERY" \
    --archive="$BACKUP_ROOT/${DB}-${STAMP}.chats.gz" --gzip 2>>"$LOG"; then
    log "[$DB] chats 近${DAYS_KEEP_CHATS}天备份成功 (since $SINCE)"
    OK_CHATS=$((OK_CHATS+1))
  else
    log "[$DB] chats 备份失败!"
  fi
done

# ---- 记录本次数量 ----
echo "$CHATS_NOW $MEM_NOW" > "$MARKER"

# ---- 清理: 按批次(STAMP)保留最近 KEEP 份 ----
# 每个批次会有 <db>-<stamp>.memory.gz 和 .chats.gz，按 stamp 分组统计
TMP_LIST=$(ls -1 "$BACKUP_ROOT"/*.memory.gz 2>/dev/null | sed -E 's/.*-([0-9]{8}-[0-9]{6})\.memory\.gz$/\1/' | sort -u)
COUNT=$(echo "$TMP_LIST" | grep -c . || true)
if [ "$COUNT" -gt "$KEEP" ]; then
  OLD_STAMPS=$(echo "$TMP_LIST" | sort | head -n $((COUNT-KEEP)))
  for S in $OLD_STAMPS; do
    rm -f "$BACKUP_ROOT"/*-"$S".*.gz
    log "已清理旧批次 $S"
  done
fi

SIZE=$(du -sh "$BACKUP_ROOT" 2>/dev/null | cut -f1)
log "备份目录总大小: $SIZE (记忆备份 $OK_MEM 库, chats备份 $OK_CHATS 库)"
log "===== 备份完成 ====="
