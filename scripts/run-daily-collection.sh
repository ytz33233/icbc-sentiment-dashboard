#!/bin/bash
# run-daily-collection.sh
# 每日舆情监测采集脚本（上午/下午批次）
# 用法: bash run-daily-collection.sh [morning|afternoon|daily]

set -e

DATE="${2:-$(date +%Y-%m-%d)}"
BATCH="${1:-daily}"
WORKSPACE="/root/.openclaw/workspace"
SM="$WORKSPACE/sentiment_monitor"
SCRIPTS="$SM/scripts"

echo "========================================"
echo "📊 舆情监测采集 [$BATCH] : $DATE"
echo "========================================"

# 1. 微博采集
echo ""
echo "🔍 [1/5] 微博舆情采集..."
node "$SCRIPTS/fetch-weibo-mcp.js" "$DATE"

# 2. 小红书采集
echo ""
echo "🔍 [2/5] 小红书舆情采集..."
node "$SCRIPTS/fetch-xhs-mcp.js" "$DATE"

# 3. 生成看板数据
echo ""
echo "📊 [3/5] 生成看板数据..."
node "$SCRIPTS/generate-dashboard-data.js" "$DATE"

# 4. 更新 fallback
echo ""
echo "📊 [4/5] 更新 fallback 数据..."
node "$SCRIPTS/update-fallback.js" "$DATE"

# 5. 推送
echo ""
echo "🚀 [5/5] 推送到 GitHub..."
bash "$SCRIPTS/auto-push.sh" "$DATE" "$BATCH"

echo ""
echo "========================================"
echo "✅ $BATCH 批次采集完成: $DATE"
echo "========================================"
