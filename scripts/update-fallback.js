const fs = require('fs');
const path = require('path');

const DATA_DIR = '/root/.openclaw/workspace/sentiment_monitor/data';
const DASHBOARD_HTML = '/root/.openclaw/workspace/sentiment_monitor/dashboard.html';

// 加载最近 7 天的数据（从今天往前 6 天）
const endDate = new Date();
const startDate = new Date(endDate);
startDate.setDate(startDate.getDate() - 6);

let allRecords = [];
let allHotKeywords = [];

for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const ds = d.toISOString().slice(0, 10);
    const filePath = path.join(DATA_DIR, `${ds}.json`);
    if (!fs.existsSync(filePath)) {
        console.log(`跳过: ${ds}.json (不存在)`);
        continue;
    }
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (data.records) {
            allRecords = allRecords.concat(data.records);
        }
        if (data.hotKeywords) {
            data.hotKeywords.forEach(k => {
                const existing = allHotKeywords.find(x => x.word === k.word);
                if (existing) {
                    existing.count += k.count;
                } else {
                    allHotKeywords.push({ word: k.word, count: k.count });
                }
            });
        }
        console.log(`加载: ${ds}.json (${data.records?.length || 0} 条)`);
    } catch (e) {
        console.log(`错误: ${ds}.json - ${e.message}`);
    }
}

// 去重
const seen = new Set();
const uniqueRecords = [];
for (const r of allRecords) {
    const key = r.id || r.url || r.title;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueRecords.push(r);
}

// 排序：负面优先 → 热度降序 → 时间倒序
const sentimentOrder = { negative: 3, neutral: 2, positive: 1 };
uniqueRecords.sort((a, b) => {
    const sa = sentimentOrder[a.sentiment] || 0;
    const sb = sentimentOrder[b.sentiment] || 0;
    if (sa !== sb) return sb - sa;
    const ha = Number(a.heatScore) || 0;
    const hb = Number(b.heatScore) || 0;
    if (ha !== hb) return hb - ha;
    const da = new Date(a.date || a.publishTime || 0).getTime();
    const db = new Date(b.date || b.publishTime || 0).getTime();
    return db - da;
});

// 重新计算统计
function computeStats(records) {
    const total = records.length;
    const recentCount = records.filter(r => r.recency === '24h内').length;
    const historyCount = records.filter(r => r.recency === '历史').length;
    const negativeCount = records.filter(r => r.sentiment === 'negative').length;
    const pos = records.filter(r => r.sentiment === 'positive').length;
    const neu = records.filter(r => r.sentiment === 'neutral').length;
    const channelCount = new Set(records.map(r => r.sourceType)).size;
    const highRiskCount = records.filter(r => r.riskLevel === 'high').length;
    const negPct = total > 0 ? Math.round((negativeCount / total) * 100) : 0;

    const bySource = {}, bySentiment = {}, byRisk = {}, byProduct = {}, byCategory = {};
    records.forEach(r => {
        bySource[r.sourceType] = (bySource[r.sourceType] || 0) + 1;
        bySentiment[r.sentiment] = (bySentiment[r.sentiment] || 0) + 1;
        byRisk[r.riskLevel] = (byRisk[r.riskLevel] || 0) + 1;
        byProduct[r.relatedProduct || '其他'] = (byProduct[r.relatedProduct || '其他'] || 0) + 1;
        byCategory[r.category || '其他'] = (byCategory[r.category || '其他'] || 0) + 1;
    });

    return {
        summary: { total, recentCount, historyCount, negativeCount, negativePct: negPct, positiveCount: pos, neutralCount: neu, channelCount, highRiskCount },
        bySource, bySentiment, byRisk, byProduct, byCategory
    };
}

function computeTrend(records, endDateStr) {
    const end = new Date(endDateStr);
    const trend = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(end);
        d.setDate(d.getDate() - i);
        const ds = d.toISOString().slice(0, 10);
        const dayRecords = records.filter(r => (r.date || '').startsWith(ds));
        trend.push({
            date: ds,
            total: dayRecords.length,
            recent: dayRecords.filter(r => r.recency === '24h内').length,
            history: dayRecords.filter(r => r.recency === '历史').length,
            negative: dayRecords.filter(r => r.sentiment === 'negative').length
        });
    }
    return trend;
}

function computeHotKeywords(records) {
    const counts = {};
    records.forEach(r => {
        (r.keywords || []).forEach(k => {
            counts[k] = (counts[k] || 0) + 1;
        });
    });
    return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([word, count]) => ({ word, count }));
}

const stats = computeStats(uniqueRecords);
const endDateStr = endDate.toISOString().slice(0, 10);
const trend = computeTrend(uniqueRecords, endDateStr);
const hotKeywords = computeHotKeywords(uniqueRecords);

const fallbackData = {
    reportDate: `${startDate.toISOString().slice(0, 10)} ~ ${endDateStr}`,
    dateRangeStart: startDate.toISOString().slice(0, 10),
    dateRangeEnd: endDateStr,
    records: uniqueRecords,
    summary: stats.summary,
    bySentiment: stats.bySentiment,
    bySource: stats.bySource,
    byRisk: stats.byRisk,
    byProduct: stats.byProduct,
    byCategory: stats.byCategory,
    trend7d: trend,
    hotKeywords: hotKeywords,
    dailyBrief: {
        text: `当前展示 ${uniqueRecords.length} 条历史舆情数据（${startDate.toISOString().slice(0, 10)} 至 ${endDateStr}）。`,
        date: endDateStr,
        generatedAt: new Date().toISOString()
    }
};

// 生成 JSON 字符串（格式化，与原来风格一致）
const jsonStr = JSON.stringify(fallbackData, null, 2);

// 读取 dashboard.html
let html = fs.readFileSync(DASHBOARD_HTML, 'utf8');

// 找到 fallbackData 的位置并替换
const startMarker = 'const fallbackData = {';
const startIdx = html.indexOf(startMarker);
if (startIdx === -1) {
    console.error('找不到 fallbackData');
    process.exit(1);
}

// 找到结束位置（匹配第一个出现的 "};" 在行首）
let braceCount = 0;
let inString = false;
let stringChar = '';
let endIdx = -1;

for (let i = startIdx + startMarker.length - 1; i < html.length; i++) {
    const ch = html[i];
    
    if (inString) {
        if (ch === '\\') {
            i++; // 跳过转义字符
            continue;
        }
        if (ch === stringChar) {
            inString = false;
        }
        continue;
    }
    
    if (ch === '"' || ch === "'" || ch === '`') {
        inString = true;
        stringChar = ch;
        continue;
    }
    
    if (ch === '{') braceCount++;
    if (ch === '}') {
        braceCount--;
        if (braceCount === 0) {
            endIdx = i;
            break;
        }
    }
}

if (endIdx === -1) {
    console.error('找不到 fallbackData 结束位置');
    process.exit(1);
}

// 替换
const newHtml = html.slice(0, startIdx) + 'const fallbackData = ' + jsonStr + ';' + html.slice(endIdx + 1);
fs.writeFileSync(DASHBOARD_HTML, newHtml);

console.log(`✅ fallbackData 已更新`);
console.log(`   记录数: ${uniqueRecords.length}`);
console.log(`   热词数: ${hotKeywords.length}`);
console.log(`   日期范围: 2026-05-12 ~ 2026-05-18`);
console.log(`   HTML 大小变化: ${html.length} → ${newHtml.length} (${newHtml.length - html.length > 0 ? '+' : ''}${newHtml.length - html.length} bytes)`);
