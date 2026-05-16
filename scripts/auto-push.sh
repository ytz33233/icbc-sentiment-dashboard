#!/bin/bash
# auto-push.sh — 舆情监测完成后自动推送 sentiment_monitor 到 GitHub
#
# 用法: bash sentiment_monitor/scripts/auto-push.sh [日期YYYY-MM-DD]
# 会自动执行: add → commit → pull --rebase → push
# 目标仓库: https://github.com/Morning/bank-activities

set -e

WORKSPACE="/root/.openclaw/workspace"
DATE="${1:-$(date +%Y-%m-%d)}"
BRANCH="sync-main"
REMOTE="bank-activities"
REMOTE_BRANCH="main"

echo "🔍 检查 sentiment_monitor 变更..."
cd "$WORKSPACE"

# 检查 sentiment_monitor 目录是否有变更（包括未跟踪文件）
UNTRACKED=$(git ls-files --others --exclude-standard sentiment_monitor/)
CHANGED=false

if ! git diff --quiet -- sentiment_monitor/ 2>/dev/null; then
    CHANGED=true
fi

if ! git diff --cached --quiet -- sentiment_monitor/ 2>/dev/null; then
    CHANGED=true
fi

if [ -n "$UNTRACKED" ]; then
    CHANGED=true
fi

if [ "$CHANGED" = false ]; then
    echo "✅ sentiment_monitor 无变更，无需推送"
    exit 0
fi

echo "📦 发现变更，开始提交和推送..."

# 配置 git 用户信息（如未设置）
git config user.email "openclaw-bot@localhost" 2>/dev/null || true
git config user.name "OpenClaw Bot" 2>/dev/null || true

# 1. 暂存所有变更
git add sentiment_monitor/

# 2. 提交
git commit -m "sentiment_monitor: daily update ${DATE}"

# 3. 拉取远程最新变更并 rebase
echo "🔄 同步远程最新代码..."
git pull "$REMOTE" "$REMOTE_BRANCH" --rebase || {
    echo "⚠️  拉取失败，尝试解决冲突..."
    git rebase --abort 2>/dev/null || true
    exit 1
}

# 4. 推送到远程
echo "🚀 推送到 GitHub: Morning/bank-activities..."
git push "$REMOTE" "${BRANCH}:${REMOTE_BRANCH}"

echo "✅ 推送成功！${DATE} 的舆情监测数据已同步到 https://github.com/Morning/bank-activities"
