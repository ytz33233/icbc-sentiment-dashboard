#!/bin/bash
# run-daily-sentiment.sh
# 每日舆情监测采集脚本（上午/下午批次）
# 用法: bash run-daily-sentiment.sh [morning|afternoon]

set -e

BATCH="${1:-morning}"
DATE=$(date +%Y-%m-%d)
WORKSPACE="/root/.openclaw/workspace"
SM="$WORKSPACE/sentiment_monitor"
SCRIPTS="$SM/scripts"
LOG_FILE="/tmp/sentiment_${BATCH}_${DATE}.log"

{
echo "========================================"
echo "📊 舆情监测采集 [$BATCH] : $DATE"
echo "$(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "========================================"

# 1. 检查微博 MCP Adapter 是否运行
echo ""
echo "🔍 [1/6] 检查微博 MCP Adapter..."
if ! curl -s http://127.0.0.1:4201/health > /dev/null 2>&1; then
    echo "⚠️ Adapter 未运行，启动中..."
    cd "$WORKSPACE/skills/xiaohongshu-mcp" && nohup node weibo-mcp-adapter.js >> /tmp/weibo_adapter.log 2>&1 &
    sleep 3
    echo "✅ Adapter 已启动"
else
    echo "✅ Adapter 运行正常"
fi

# 2. 微博采集
echo ""
echo "🔍 [2/6] 微博舆情采集..."
cd "$SCRIPTS"
node fetch-weibo-mcp.js "$DATE"

# 3. 小红书采集
echo ""
echo "🔍 [3/6] 小红书舆情采集..."
node fetch-xhs-repo.js "$DATE"

# 4. 生成看板数据
echo ""
echo "📊 [4/6] 生成看板数据..."
node generate-dashboard-data.js "$DATE"

# 5. 更新 fallback（看板内嵌数据）
echo ""
echo "📊 [5/6] 更新 fallback 数据..."
node update-fallback.js "$DATE"

# 6. 推送到 GitHub
echo ""
echo "🚀 [6/6] 推送到 GitHub..."
bash "$SCRIPTS/auto-push.sh" "$DATE" "$BATCH"

echo ""
echo "========================================"
echo "✅ $BATCH 批次采集完成: $DATE"
echo "========================================"
} | tee -a "$LOG_FILE"
