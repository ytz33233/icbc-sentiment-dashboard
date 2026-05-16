#!/usr/bin/env node
/**
 * collect-feedback.js
 * 每天晚上收集本地反馈数据，分析误判模式，生成优化规则
 *
 * 用法: node sentiment_monitor/scripts/collect-feedback.js
 * 数据源: sentiment_monitor/feedback/*.json（从浏览器 localStorage 导出的反馈）
 * 输出: sentiment_monitor/feedback-rules.json
 */

const fs = require('fs');
const path = require('path');

const WORKSPACE = '/root/.openclaw/workspace';
const FEEDBACK_DIR = path.join(WORKSPACE, 'sentiment_monitor', 'feedback');
const RULES_FILE = path.join(WORKSPACE, 'sentiment_monitor', 'feedback-rules.json');
const REPORTS_DIR = path.join(WORKSPACE, 'sentiment_monitor', 'reports');

function getTodayBeijing() {
    const d = new Date(Date.now() + 8 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
}

// ===== 加载本地反馈文件 =====
function loadLocalFeedback() {
    const feedbacks = [];
    if (!fs.existsSync(FEEDBACK_DIR)) {
        console.log('[Feedback] 反馈目录不存在:', FEEDBACK_DIR);
        return feedbacks;
    }
    const files = fs.readdirSync(FEEDBACK_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
        const fp = path.join(FEEDBACK_DIR, file);
        try {
            const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
            if (Array.isArray(data)) {
                feedbacks.push(...data);
            } else if (data && typeof data === 'object') {
                // 可能是 {id: {...}} 格式
                for (const [id, entry] of Object.entries(data)) {
                    feedbacks.push({ id, ...entry });
                }
            }
            console.log(`[Feedback] 加载 ${file}: ${Array.isArray(data) ? data.length : Object.keys(data).length} 条`);
        } catch (e) {
            console.warn('[Feedback] 解析失败:', file, e.message);
        }
    }
    return feedbacks;
}

// ===== 分析误判模式 =====
function analyzePatterns(feedbacks) {
    const patterns = {
        sentiment: { falsePositive: [], falseNegative: [] },
        risk: { overHigh: [], underHigh: [] },
        keywords: {}
    };

    for (const fb of feedbacks) {
        if (fb.accurate === true) continue; // 只分析不准确的

        const reason = (fb.reason || '').toLowerCase();
        const title = (fb.title || '').toLowerCase();
        const text = reason + ' ' + title;

        // 情感误判
        if (reason.includes('情感') || reason.includes('sentiment') || reason.includes('正面') || reason.includes('负面')) {
            if (reason.includes('误判为负面') || reason.includes('不是负面')) {
                patterns.sentiment.falseNegative.push(fb);
            } else if (reason.includes('误判为正面') || reason.includes('不是正面')) {
                patterns.sentiment.falsePositive.push(fb);
            } else if (reason.includes('应该为中性')) {
                patterns.sentiment.falseNegative.push(fb);
            }
        }

        // 风险误判
        if (reason.includes('风险') || reason.includes('高风险') || reason.includes('应该为')) {
            if (reason.includes('不应该为高风险') || reason.includes('误判为高')) {
                patterns.risk.overHigh.push(fb);
            } else if (reason.includes('应该是高风险') || reason.includes('误判为低')) {
                patterns.risk.underHigh.push(fb);
            }
        }

        // 关键词统计
        const words = (fb.title || '').split(/\s+/).filter(w => w.length >= 2);
        for (const w of words) {
            patterns.keywords[w] = (patterns.keywords[w] || 0) + 1;
        }
    }

    return patterns;
}

// ===== 生成规则 =====
function generateRules(feedbacks) {
    const patterns = analyzePatterns(feedbacks);
    const rules = {
        generatedAt: new Date().toISOString(),
        totalFeedback: feedbacks.length,
        inaccurateCount: feedbacks.filter(f => f.accurate === false).length,
        sentimentAdjustments: [],
        riskAdjustments: [],
        version: 1
    };

    // 情感调整规则（出现 ≥2 次的误判才生成规则）
    const sentimentKeywords = {};
    for (const fb of patterns.sentiment.falseNegative) {
        const kw = extractKeyPhrase(fb.title || fb.reason || '');
        if (kw) {
            sentimentKeywords[kw] = sentimentKeywords[kw] || { count: 0, correction: 'neutral', reason: '' };
            sentimentKeywords[kw].count++;
        }
    }
    for (const [kw, info] of Object.entries(sentimentKeywords)) {
        if (info.count >= 2) {
            rules.sentimentAdjustments.push({
                keyword: kw,
                originalSentiment: 'negative',
                correction: 'neutral',
                confidence: Math.min(0.95, 0.6 + info.count * 0.1),
                count: info.count
            });
        }
    }

    // 风险调整规则
    if (patterns.risk.overHigh.length >= 2) {
        rules.riskAdjustments.push({
            sourceType: 'social',
            reason: '误判为高风险',
            confidence: Math.min(0.95, 0.6 + patterns.risk.overHigh.length * 0.1),
            count: patterns.risk.overHigh.length
        });
    }

    return rules;
}

function extractKeyPhrase(text) {
    if (!text) return '';
    // 提取 2-6 字的关键短语
    const candidates = [
        '谢谢参与', '空奖', '积分清零', '虚假宣传', '投诉', '维权',
        '不发货', '客服', '活动', '抽奖', '立减金', 'i豆', '升金有礼'
    ];
    for (const c of candidates) {
        if (text.includes(c)) return c;
    }
    return '';
}

// ===== 生成报告 =====
function generateReport(feedbacks, rules) {
    const today = getTodayBeijing();
    const inaccurate = feedbacks.filter(f => f.accurate === false);
    let md = `# 舆情反馈分析报告 — ${today}\n\n`;
    md += `> 生成时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n\n`;
    md += `## 概览\n\n`;
    md += `- 总反馈数: ${feedbacks.length}\n`;
    md += `- 不准确反馈: ${inaccurate.length}\n`;
    md += `- 准确率: ${feedbacks.length > 0 ? Math.round((feedbacks.length - inaccurate.length) / feedbacks.length * 100) : 0}%\n\n`;

    if (inaccurate.length > 0) {
        md += `## 不准确反馈详情\n\n`;
        for (const fb of inaccurate.slice(0, 20)) {
            md += `### ${fb.id || '未知ID'}\n`;
            md += `- 原因: ${fb.reason || '未填写'}\n`;
            md += `- 时间: ${fb.time || '未知'}\n\n`;
        }
    }

    if (rules.sentimentAdjustments.length > 0 || rules.riskAdjustments.length > 0) {
        md += `## 生成的优化规则\n\n`;
        for (const r of rules.sentimentAdjustments) {
            md += `- **情感调整**: 含「${r.keyword}」的负面内容 → 改为 ${r.correction}（置信度 ${(r.confidence * 100).toFixed(0)}%，基于 ${r.count} 次反馈）\n`;
        }
        for (const r of rules.riskAdjustments) {
            md += `- **风险调整**: ${r.sourceType} 来源高风险误判 → 降为 medium（基于 ${r.count} 次反馈）\n`;
        }
    } else {
        md += `## 优化规则\n\n暂无足够反馈生成规则（需要 ≥2 次同类误判）。\n`;
    }

    md += `\n---\n`;
    md += `*自动生成于 ${today}*\n`;
    return md;
}

// ===== 主函数 =====
async function main() {
    const today = getTodayBeijing();
    console.log(`\n📥 收集本地反馈数据: ${today}`);
    console.log('='.repeat(40));

    const feedbacks = loadLocalFeedback();
    console.log(`📊 共加载 ${feedbacks.length} 条反馈`);

    if (feedbacks.length === 0) {
        console.log('⚠️ 无反馈数据，跳过规则生成');
        // 保留旧规则
        if (fs.existsSync(RULES_FILE)) {
            console.log('✅ 保留现有规则');
        } else {
            // 生成空规则
            const emptyRules = { generatedAt: new Date().toISOString(), totalFeedback: 0, inaccurateCount: 0, sentimentAdjustments: [], riskAdjustments: [], version: 1 };
            fs.writeFileSync(RULES_FILE, JSON.stringify(emptyRules, null, 2));
            console.log('✅ 已生成空规则文件');
        }
        return;
    }

    const rules = generateRules(feedbacks);
    fs.writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2));
    console.log(`✅ 规则文件已更新: ${RULES_FILE}`);
    console.log(`   情感调整: ${rules.sentimentAdjustments.length} 条`);
    console.log(`   风险调整: ${rules.riskAdjustments.length} 条`);

    // 生成报告
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    const report = generateReport(feedbacks, rules);
    fs.writeFileSync(path.join(REPORTS_DIR, `feedback-report-${today}.md`), report);
    console.log(`✅ 报告已生成: reports/feedback-report-${today}.md`);

    console.log('='.repeat(40));
}

main().catch(e => {
    console.error('❌ 脚本异常:', e);
    process.exit(1);
});
