const fs = require('fs');
const path = require('path');

const DATA_DIR = '/root/.openclaw/workspace/sentiment_monitor/data';

// 活动相关产品关键词
const ACTIVITY_PRODUCTS = ['升金有礼', 'i豆活动', '心动有礼', 'i豆乐园'];

function isActivityRecord(record) {
    // 检查 relatedProduct
    if (ACTIVITY_PRODUCTS.includes(record.relatedProduct)) {
        return true;
    }
    // 检查 keywords 中是否包含活动关键词
    const keywords = record.keywords || [];
    if (keywords.some(k => k.includes('升金有礼') || k.includes('i豆') || k.includes('心动有礼') || k.includes('i豆乐园'))) {
        return true;
    }
    // 检查 title/content 中是否明确提及活动
    const title = record.title || '';
    const content = record.content || '';
    if (title.includes('升金有礼') || title.includes('i豆') || title.includes('心动有礼') || title.includes('i豆乐园')) {
        return true;
    }
    if (content.includes('升金有礼') || content.includes('i豆') || content.includes('心动有礼') || content.includes('i豆乐园')) {
        return true;
    }
    return false;
}

function recomputeStats(records) {
    const total = records.length;
    const recentRecords = records.filter(r => r.recency === '24h内');
    const historyRecords = records.filter(r => r.recency === '历史');
    const negativeCount = records.filter(r => r.sentiment === 'negative').length;
    const positiveCount = records.filter(r => r.sentiment === 'positive').length;
    const neutralCount = records.filter(r => r.sentiment === 'neutral').length;
    const negPct = total > 0 ? Math.round((negativeCount / total) * 100) : 0;
    const highRiskCount = records.filter(r => r.riskLevel === 'high').length;
    const channelCount = new Set(records.map(r => r.sourceType)).size;

    const bySource = {};
    const bySentiment = {};
    const byRisk = {};
    
    records.forEach(r => {
        bySource[r.sourceType] = (bySource[r.sourceType] || 0) + 1;
        bySentiment[r.sentiment] = (bySentiment[r.sentiment] || 0) + 1;
        byRisk[r.riskLevel] = (byRisk[r.riskLevel] || 0) + 1;
    });

    return {
        total, recentCount: recentRecords.length, historyCount: historyRecords.length,
        negativeCount, negativePct: negPct, positiveCount, neutralCount,
        channelCount, highRiskCount,
        bySource, bySentiment, byRisk
    };
}

function computeTrend(records, endDateStr) {
    const end = new Date(endDateStr);
    const trend = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(end);
        d.setDate(d.getDate() - i);
        const ds = formatDate(d);
        const dayRecords = records.filter(r => r.date === ds);
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

function formatDate(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function processFile(filename) {
    const filepath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filepath)) {
        console.log(`跳过（不存在）: ${filename}`);
        return;
    }

    const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    const originalCount = data.records ? data.records.length : 0;
    
    // 过滤只保留活动相关记录
    const filteredRecords = (data.records || []).filter(isActivityRecord);
    const removedCount = originalCount - filteredRecords.length;
    
    if (removedCount === 0) {
        console.log(`无需清理: ${filename} (${originalCount}条)`);
        return;
    }

    // 重新计算统计
    const reportDate = data.reportDate || formatDate(new Date());
    const stats = recomputeStats(filteredRecords);
    const trend7d = computeTrend(filteredRecords, reportDate);
    
    // 更新关键词统计
    const keywordCounts = {};
    filteredRecords.forEach(r => {
        (r.keywords || []).forEach(k => {
            keywordCounts[k] = (keywordCounts[k] || 0) + 1;
        });
    });
    const hotKeywords = Object.entries(keywordCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([word, count]) => ({ word, count }));

    const newData = {
        ...data,
        summary: {
            total: stats.total,
            recentCount: stats.recentCount,
            historyCount: stats.historyCount,
            negativeCount: stats.negativeCount,
            negativePct: stats.negativePct,
            positiveCount: stats.positiveCount,
            neutralCount: stats.neutralCount,
            channelCount: stats.channelCount,
            highRiskCount: stats.highRiskCount
        },
        bySource: stats.bySource,
        bySentiment: stats.bySentiment,
        byRisk: stats.byRisk,
        trend7d,
        hotKeywords,
        records: filteredRecords
    };

    fs.writeFileSync(filepath, JSON.stringify(newData, null, 2));
    console.log(`已清理: ${filename} — 原${originalCount}条 → 保留${filteredRecords.length}条 (删除${removedCount}条)`);
}

// 处理所有 JSON 文件
const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
console.log(`开始清理 ${files.length} 个数据文件，只保留活动相关舆情...\n`);
files.forEach(processFile);
console.log('\n清理完成！');
