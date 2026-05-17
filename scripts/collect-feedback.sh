#!/bin/bash
# collect-feedback.sh
# 每日反馈收集与规则生成

set -e

WORKSPACE="/root/.openclaw/workspace"
SM="$WORKSPACE/sentiment_monitor"

echo "========================================"
echo "📥 反馈收集与规则生成"
echo "========================================"

cd "$SM/scripts"
node collect-feedback.js

echo "========================================"
echo "✅ 反馈处理完成"
echo "========================================"
