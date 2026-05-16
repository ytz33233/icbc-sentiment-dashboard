#!/usr/bin/env node
/**
 * collect-feedback.js
 * 每天晚上收集 GitHub Issues 中的舆情反馈，分析误判模式，生成优化规则
 *
 * 用法: node sentiment_monitor/scripts/collect-feedback.js
 * 输出: sentiment_monitor/feedback-rules.json
 * 副作用: 关闭已处理的 feedback Issue
 */

const fs = require('fs');
const path = require('path');

const WORKSPACE = '/root/.openclaw/workspace';
const RULES_FILE = path.join(WORKSPACE, 'sentiment_monitor', 'feedback-rules.json');

// GitHub 配置
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const REPO_OWNER = 'ytz33233';
const REPO_NAME = 'icbc-sentiment-dashboard';

// ===== HTTP 请求工具 =====
function httpRequest(method, url, data = null) {
    return new Promise((resolve, reject) => {
        const https = require('https');
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: method,
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github+json',
                'User-Agent': 'OpenClaw-Feedback-Collector'
            }
        };
        if (data) {
            const body = JSON.stringify(data);
            options.headers['Content-Type'] = 'application/json';
            options.headers['Content-Length'] = Buffer.byteLength(body);
        }
        const req = https.request(options, (res) => {
            let raw = '';
            res.on('data', chunk => raw += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(raw);
                    resolve({ status: res.statusCode, data: parsed });
                } catch (e) {
                    resolve({ status: res.statusCode, data: raw });
                }
            });
        });
        req.on('error', reject);
        if (data) req.write(JSON.stringify(data));
        req.end();
    });
}

// ===== 解析 Issue 内容 =====
function parseFeedbackIssue(issue) {
    const body = issue.body || '';
    const result = {
        id: null,
        accurate: null,
        reason: '',
        originalTitle: '',
        originalContent: '',
        originalSentiment: '',
        originalRisk: '',
        sourceType: '',
        category: '',
        createdAt: issue.created_at,
        issueNumber: issue.number
    };

    // 从标题解析 ID 和准确状态
    const titleMatch = issue.title.match(/\[反馈\]\s*ID=(\S+)\s*\|\s*(准确|不准确)/);
    if (titleMatch) {
        result.id = titleMatch[1];
        result.accurate = titleMatch[2] === '准确';
    }

    // 从 body 解析字段
    const lines = body.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('**原标题**:')) result.originalTitle = trimmed.split('**:')[1]?.trim() || '';
        if (trimmed.startsWith('**原始内容**:')) result.originalContent = trimmed.split('**:')[1]?.trim() || '';
        if (trimmed.startsWith('**系统判断情感**:')) result.originalSentiment = trimmed.split('**:')[1]?.trim() || '';
        if (trimmed.startsWith('**系统判断风险**:')) result.originalRisk = trimmed.split('**:')[1]?.trim() || '';
        if (trimmed.startsWith('**来源类型**:')) result.sourceType = trimmed.split('**:')[1]?.trim() || '';
        if (trimmed.startsWith('**类别**:')) result.category = trimmed.split('**:')[1]?.trim() || '';
        if (trimmed.startsWith('**用户反馈**:')) result.reason = trimmed.split('**:')[1]?.trim() || '';
    }

    return result;
}

// ===== 分析反馈模式 =====
function analyzeFeedback(issues) {
    const feedbacks = issues.map(parseFeedbackIssue).filter(f => f.id !== null);

    const stats = {
        total: feedbacks.length,
        accurate: feedbacks.filter(f => f.accurate).length,
        inaccurate: feedbacks.filter(f => !f.accurate).length,
        falseNegative: [],  // 实际是负面但系统判为中性/正面
        falsePositive: [],  // 实际是中性/正面但系统判为负面
        falseRisk: [],      // 风险等级误判
        keywordPatterns: {},
        sourcePatterns: {},
        categoryPatterns: {}
    };

    for (const f of feedbacks) {
        if (f.accurate) continue;

        const text = (f.originalTitle + ' ' + f.originalContent).toLowerCase();

        // 收集关键词出现频率
        for (const kw of ['谢谢参与', '投诉', '维权', '虚假宣传', '空奖', '骗', '坑', '羊毛', '攻略', 'i豆', '升金有礼', '积分', '清零', '立减金']) {
            if (text.includes(kw)) {
                if (!stats.keywordPatterns[kw]) stats.keywordPatterns[kw] = { count: 0, reasons: [] };
                stats.keywordPatterns[kw].count++;
                if (f.reason) stats.keywordPatterns[kw].reasons.push(f.reason);
            }
        }

        // 收集来源模式
        if (f.sourceType) {
            if (!stats.sourcePatterns[f.sourceType]) stats.sourcePatterns[f.sourceType] = { count: 0, reasons: [] };
            stats.sourcePatterns[f.sourceType].count++;
            if (f.reason) stats.sourcePatterns[f.sourceType].reasons.push(f.reason);
        }

        // 收集类别模式
        if (f.category) {
            if (!stats.categoryPatterns[f.category]) stats.categoryPatterns[f.category] = { count: 0, reasons: [] };
            stats.categoryPatterns[f.category].count++;
            if (f.reason) stats.categoryPatterns[f.category].reasons.push(f.reason);
        }

        // 判断误判类型
        if (f.reason) {
            const r = f.reason.toLowerCase();
            if (r.includes('误判为负面') || r.includes('不是负面') || r.includes('中性')) {
                stats.falsePositive.push(f);
            } else if (r.includes('误判为中性') || r.includes('漏判') || r.includes('应该负面')) {
                stats.falseNegative.push(f);
            } else if (r.includes('风险') || r.includes('高风险') || r.includes('低风险')) {
                stats.falseRisk.push(f);
            }
        }
    }

    return { feedbacks, stats };
}

// ===== 生成优化规则 =====
function generateRules(analysis) {
    const { stats } = analysis;
    const rules = {
        version: new Date().toISOString().slice(0, 10),
        lastUpdated: new Date().toISOString(),
        sentimentAdjustments: [],
        riskAdjustments: [],
        keywordWeightChanges: [],
        correctionPatterns: {
            falseNegative: stats.falseNegative.map(f => ({
                id: f.id,
                reason: f.reason,
                keywords: extractKeywordsFromText(f.originalTitle + ' ' + f.originalContent)
            })),
            falsePositive: stats.falsePositive.map(f => ({
                id: f.id,
                reason: f.reason,
                keywords: extractKeywordsFromText(f.originalTitle + ' ' + f.originalContent)
            })),
            misclassifiedRisk: stats.falseRisk.map(f => ({
                id: f.id,
                reason: f.reason,
                originalRisk: f.originalRisk
            }))
        }
    };

    // 关键词模式 → 情感调整规则
    for (const [kw, data] of Object.entries(stats.keywordPatterns)) {
        if (data.count >= 2) {  // 至少 2 次反馈才生成规则
            const reasons = data.reasons.join(' | ');
            let adjustment = null;

            if (reasons.includes('误判为负面') || reasons.includes('不是负面')) {
                adjustment = { keyword: kw, originalSentiment: 'negative', correction: 'neutral', reason: reasons, confidence: Math.min(0.5 + data.count * 0.1, 0.95), feedbackCount: data.count };
            } else if (reasons.includes('误判为中性')) {
                adjustment = { keyword: kw, originalSentiment: 'neutral', correction: 'negative', reason: reasons, confidence: Math.min(0.5 + data.count * 0.1, 0.95), feedbackCount: data.count };
            }

            if (adjustment && !rules.sentimentAdjustments.find(a => a.keyword === kw)) {
                rules.sentimentAdjustments.push(adjustment);
            }
        }
    }

    // 来源模式 → 风险调整规则
    for (const [source, data] of Object.entries(stats.sourcePatterns)) {
        if (data.count >= 2) {
            const reasons = data.reasons.join(' | ');
            if (reasons.includes('风险')) {
                rules.riskAdjustments.push({
                    sourceType: source,
                    reason: reasons,
                    confidence: Math.min(0.5 + data.count * 0.1, 0.95),
                    feedbackCount: data.count
                });
            }
        }
    }

    return rules;
}

function extractKeywordsFromText(text) {
    const KEYWORDS = ['升金有礼', 'i豆', '积分', '清零', '立减金', '空奖', '抽奖', '心动有礼', 'i豆乐园', '投诉', '维权', '虚假宣传', '谢谢参与', '霸王条款', '不发货', '优惠券', '冻结', '信用卡', '资产达标', '月月升金'];
    const t = (text || '').toLowerCase();
    return KEYWORDS.filter(kw => t.includes(kw.toLowerCase()));
}

// ===== 主流程 =====
async function main() {
    console.log('🔍 开始收集舆情反馈...');
    console.log(`📦 仓库: ${REPO_OWNER}/${REPO_NAME}`);

    // 1. 读取所有 feedback 标签的 open Issue
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues?labels=feedback&state=open&per_page=100`;
    const response = await httpRequest('GET', url);

    if (response.status !== 200) {
        console.error('❌ 读取 Issues 失败:', response.status, response.data);
        process.exit(1);
    }

    const issues = response.data;
    if (!Array.isArray(issues) || issues.length === 0) {
        console.log('✅ 没有新的反馈 Issue，无需处理');
        process.exit(0);
    }

    console.log(`📋 发现 ${issues.length} 条反馈 Issue`);

    // 2. 分析反馈
    const analysis = analyzeFeedback(issues);
    console.log(`📊 统计: 准确=${analysis.stats.accurate}, 不准确=${analysis.stats.inaccurate}`);
    console.log(`   假阴性(漏判负面)=${analysis.stats.falseNegative.length}, 假阳性(误判负面)=${analysis.stats.falsePositive.length}, 风险误判=${analysis.stats.falseRisk.length}`);

    // 3. 生成规则
    const newRules = generateRules(analysis);

    // 4. 读取旧规则并合并
    let existingRules = { version: '2026-01-01', sentimentAdjustments: [], riskAdjustments: [] };
    if (fs.existsSync(RULES_FILE)) {
        try {
            existingRules = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));
        } catch (e) {
            console.warn('⚠️ 旧规则文件读取失败，使用空规则');
        }
    }

    // 合并：保留旧规则中 feedbackCount 更高的，新规则补充
    const merged = mergeRules(existingRules, newRules);
    fs.writeFileSync(RULES_FILE, JSON.stringify(merged, null, 2));
    console.log(`📝 规则已更新: ${RULES_FILE}`);
    console.log(`   情感调整规则: ${merged.sentimentAdjustments.length} 条`);
    console.log(`   风险调整规则: ${merged.riskAdjustments.length} 条`);

    // 5. 关闭已处理的 Issue
    for (const issue of issues) {
        const closeUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues/${issue.number}`;
        await httpRequest('PATCH', closeUrl, { state: 'closed' });
        console.log(`   ✅ 已关闭 Issue #${issue.number}`);
    }

    // 6. 生成分析报告
    const reportPath = path.join(WORKSPACE, 'sentiment_monitor', 'reports', `feedback-report-${newRules.version}.md`);
    const reportDir = path.dirname(reportPath);
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });

    const report = generateReport(analysis, merged);
    fs.writeFileSync(reportPath, report);
    console.log(`📄 分析报告: ${reportPath}`);

    console.log('\n🎯 反馈收集完成！规则已更新，明天采集将自动应用新规则。');
}

function mergeRules(oldRules, newRules) {
    const merged = {
        version: newRules.version,
        lastUpdated: newRules.lastUpdated,
        sentimentAdjustments: [...(oldRules.sentimentAdjustments || [])],
        riskAdjustments: [...(oldRules.riskAdjustments || [])],
        keywordWeightChanges: [...(oldRules.keywordWeightChanges || [])],
        correctionPatterns: newRules.correctionPatterns
    };

    // 合并情感调整：新规则覆盖旧规则，但保留 feedbackCount 更高的
    for (const newAdj of newRules.sentimentAdjustments || []) {
        const existingIndex = merged.sentimentAdjustments.findIndex(a => a.keyword === newAdj.keyword);
        if (existingIndex >= 0) {
            if (newAdj.feedbackCount > (merged.sentimentAdjustments[existingIndex].feedbackCount || 0)) {
                merged.sentimentAdjustments[existingIndex] = newAdj;
            }
        } else {
            merged.sentimentAdjustments.push(newAdj);
        }
    }

    // 合并风险调整
    for (const newAdj of newRules.riskAdjustments || []) {
        const existingIndex = merged.riskAdjustments.findIndex(a => a.sourceType === newAdj.sourceType);
        if (existingIndex >= 0) {
            if (newAdj.feedbackCount > (merged.riskAdjustments[existingIndex].feedbackCount || 0)) {
                merged.riskAdjustments[existingIndex] = newAdj;
            }
        } else {
            merged.riskAdjustments.push(newAdj);
        }
    }

    return merged;
}

function generateReport(analysis, rules) {
    const { stats } = analysis;
    let md = `# 舆情反馈分析报告\n\n**生成时间**: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n**统计周期**: 本次收集\n\n`;
    md += `## 反馈统计\n\n| 指标 | 数量 |\n|---|---|\n`;
    md += `| 总反馈数 | ${stats.total} |\n`;
    md += `| 判断准确 | ${stats.accurate} |\n`;
    md += `| 判断不准确 | ${stats.inaccurate} |\n`;
    md += `| 假阴性(漏判负面) | ${stats.falseNegative.length} |\n`;
    md += `| 假阳性(误判负面) | ${stats.falsePositive.length} |\n`;
    md += `| 风险等级误判 | ${stats.falseRisk.length} |\n\n`;

    md += `## 关键词误判模式\n\n`;
    const sortedKws = Object.entries(stats.keywordPatterns).sort((a, b) => b[1].count - a[1].count);
    for (const [kw, data] of sortedKws) {
        md += `- **${kw}**: ${data.count} 次反馈\n`;
        const uniqueReasons = [...new Set(data.reasons)].slice(0, 3);
        for (const r of uniqueReasons) md += `  - ${r}\n`;
    }

    md += `\n## 已生成的优化规则\n\n### 情感调整规则 (${rules.sentimentAdjustments.length} 条)\n\n`;
    for (const adj of rules.sentimentAdjustments) {
        md += `- **${adj.keyword}**: ${adj.originalSentiment} → ${adj.correction} (置信度: ${(adj.confidence * 100).toFixed(0)}%, 反馈数: ${adj.feedbackCount})\n`;
        md += `  - 原因: ${adj.reason}\n`;
    }

    md += `\n### 风险调整规则 (${rules.riskAdjustments.length} 条)\n\n`;
    for (const adj of rules.riskAdjustments) {
        md += `- **来源: ${adj.sourceType}**: (置信度: ${(adj.confidence * 100).toFixed(0)}%, 反馈数: ${adj.feedbackCount})\n`;
        md += `  - 原因: ${adj.reason}\n`;
    }

    md += `\n---\n*本报告由反馈收集系统自动生成*\n`;
    return md;
}

main().catch(err => {
    console.error('❌ 收集失败:', err.message);
    process.exit(1);
});
