#!/bin/bash
# auto-push.sh — 舆情监测完成后自动推送 sentiment_monitor 到 GitHub
#
# 用法: bash sentiment_monitor/scripts/auto-push.sh [日期YYYY-MM-DD] [批次morning|afternoon]
# 会自动执行: add → commit → pull --rebase → push
# 目标仓库:
#   - 主仓库: https://github.com/Morning/bank-activities (历史数据归档)
#   - 看板仓库: https://github.com/ytz33233/icbc-sentiment-dashboard (GitHub Pages)

set -e

WORKSPACE="/root/.openclaw/workspace"
DATE="${1:-$(date +%Y-%m-%d)}"
BATCH="${2:-daily}"  # morning / afternoon / daily
BRANCH="sync-main"
REMOTE_MAIN="bank-activities"
REMOTE_DASHBOARD="dashboard"
REMOTE_MAIN_BRANCH="main"
REMOTE_DASHBOARD_BRANCH="main"

echo "🔍 检查工作区变更..."
cd "$WORKSPACE"

# 检查所有变更（包括已跟踪文件修改、暂存区、未跟踪文件）
CHANGED=false

if ! git diff --quiet 2>/dev/null; then
    CHANGED=true
fi

if ! git diff --cached --quiet 2>/dev/null; then
    CHANGED=true
fi

UNTRACKED=$(git ls-files --others --exclude-standard)
if [ -n "$UNTRACKED" ]; then
    CHANGED=true
fi

if [ "$CHANGED" = false ]; then
    echo "✅ 工作区无变更，无需推送"
    exit 0
fi

echo "📦 发现变更，开始提交和推送..."

# 配置 git 用户信息（如未设置）
git config user.email "openclaw-bot@localhost" 2>/dev/null || true
git config user.name "OpenClaw Bot" 2>/dev/null || true

# 构建提交信息
if [ "$BATCH" = "morning" ]; then
    COMMIT_MSG="sentiment_monitor: morning update ${DATE}"
elif [ "$BATCH" = "afternoon" ]; then
    COMMIT_MSG="sentiment_monitor: afternoon update ${DATE}"
else
    COMMIT_MSG="sentiment_monitor: daily update ${DATE}"
fi

# ==== 推送到主仓库（Morning/bank-activities）====
echo "🚀 推送到主仓库: Morning/bank-activities..."

# 先暂存所有变更（避免 rebase 时 unstaged changes 报错）
git add -A
git commit -m "$COMMIT_MSG"

echo "🔄 同步远程最新代码..."
git pull "$REMOTE_MAIN" "$REMOTE_MAIN_BRANCH" --rebase || {
    echo "⚠️  主仓库拉取失败，尝试解决冲突..."
    git rebase --abort 2>/dev/null || true
    exit 1
}

git push "$REMOTE_MAIN" "${BRANCH}:${REMOTE_MAIN_BRANCH}"
echo "✅ 主仓库推送成功！"

# ==== 推送到看板仓库（ytz33233/icbc-sentiment-dashboard）====
echo "🚀 推送到看板仓库: ytz33233/icbc-sentiment-dashboard..."
git add sentiment_monitor/
git commit -m "$COMMIT_MSG" || true

git push "$REMOTE_DASHBOARD" "${BRANCH}:${REMOTE_DASHBOARD_BRANCH}" -f || {
    echo "⚠️  看板仓库推送失败，尝试直接 push..."
    git push "$REMOTE_DASHBOARD" "HEAD:main" -f
}
echo "✅ 看板仓库推送成功！Pages 约 1-2 分钟后更新"

echo ""
echo "🔗 访问地址:"
echo "   主仓库: https://github.com/Morning/bank-activities"
echo "   看板: https://ytz33233.github.io/icbc-sentiment-dashboard/dashboard.html"
echo "   介绍页: https://ytz33233.github.io/icbc-sentiment-dashboard/intro.html"
