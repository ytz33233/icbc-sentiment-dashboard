#!/usr/bin/env node
/**
 * fetch-xhs-data.js
 * 从 GitHub 仓库拉取小红书舆情数据，转换为本地兼容格式
 * 
 * 数据源: https://github.com/ytz33233/xhs_yuqing_data
 * 更新频率: 每日 21:00
 * 
 * 用法: node fetch-xhs-data.js [YYYY-MM-DD]
 * 默认取今天北京时间
 * 输出: 写入 sentiment_monitor/data/xhs-YYYY-MM-DD.json（中间文件）
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const WORKSPACE = '/root/.openclaw/workspace';
const DATA_DIR = path.join(WORKSPACE, 'sentiment_monitor', 'data');

// GitHub Raw 文件基础 URL (v2 版本数据)
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/ytz33233/xhs_yuqing_data/main/sentiment_monitor_v2/data';

// ===== 工具函数 =====
function formatDate(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function getTodayBeijing() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const beijing = new Date(utc + (3600000 * 8));
    return formatDate(beijing);
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: 30000 }, (res) => {
            if (res.statusCode === 302 || res.statusCode === 301) {
                // 跟随重定向
                fetchJson(res.headers.location).then(resolve).catch(reject);
                return;
            }
            if (res.statusCode !== 200) {
                resolve(null); // 文件不存在或其他错误，返回 null
                return;
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    console.error(`JSON 解析错误: ${url}`, e.message);
                    resolve(null);
                }
            });
        });
        req.on('error', (err) => {
            console.error(`请求错误: ${url}`, err.message);
            resolve(null);
        });
        req.on('timeout', () => {
            req.destroy();
            console.error(`请求超时: ${url}`);
            resolve(null);
        });
    });
}

// ===== 数据转换 =====

const KEYWORD_LIST = [
    '升金有礼', 'i豆', '贬值', '积分', '清零', '立减金', '空奖', '抽奖', '心动有礼', 'i豆乐园',
    '投诉', '维权', '虚假宣传', '谢谢参与', '霸王条款', '美团', '商城',
    '不发货', '优惠券', '代金券', '红包', '冻结', '信用卡', '长辈',
    '河北', '安徽', '吉林', '长宁', '支行', '分行', '客服', '95588',
    '通知', '提醒', '到账', '兑换', '资产达标', '月月升金', '资产提升',
    '薅羊毛', '羊毛', '福利', '奖励', '收益'
];

function extractKeywords(title, content) {
    const text = ((title || '') + ' ' + (content || '')).toLowerCase();
    const found = [];
    for (const kw of KEYWORD_LIST) {
        if (text.includes(kw.toLowerCase()) && !found.includes(kw)) {
            found.push(kw);
        }
    }
    return found.slice(0, 5);
}

function inferProduct(title, content) {
    const t = (title || '').toLowerCase();
    const c = (content || '').toLowerCase();
    if (t.includes('升金有礼') || c.includes('升金有礼')) return '升金有礼';
    if (t.includes('心动有礼') || c.includes('心动有礼')) return '心动有礼';
    if (t.includes('i豆乐园') || c.includes('i豆乐园')) return 'i豆乐园';
    if (t.includes('i豆') || c.includes('i豆')) return 'i豆活动';
    return '其他';
}

// ===== 类别推断（与 generate-dashboard-data.js 保持一致） =====
const CATEGORY_RULES = [
    { name: 'i豆兑换', keywords: ['i豆', '积分', '兑换', '商城', '美团', '立减金'] },
    { name: '薅羊毛', keywords: ['羊毛', '线报', '赚客', '红包', '优惠券', '代金券', '抽奖', '薅'] },
    { name: '资产达标', keywords: ['升金有礼', '资产达标', '月月升金', '资产提升', '分行', '支行', '心动有礼'] },
    { name: '投诉维权', keywords: ['投诉', '维权', '黑猫', '95588', '客服', '不发货', '冻结'] },
    { name: '虚假宣传', keywords: ['虚假宣传', '谢谢参与', '空奖', '奖励不符', '霸王条款'] }
];

function inferCategory(title, content) {
    const text = ((title || '') + ' ' + (content || '')).toLowerCase();
    for (const rule of CATEGORY_RULES) {
        if (rule.keywords.some(kw => text.includes(kw.toLowerCase()))) {
            return rule.name;
        }
    }
    return '其他';
}

function computeHeatScore(record) {
    const likes = Number(record.likes) || 0;
    const comments = Number(record.comments) || 0;
    const favorites = Number(record.favorites) || 0;
    return Math.round(likes * 1 + comments * 2 + favorites * 1.5);
}

function isWithin24h(publishDateStr, fetchDateStr) {
    if (!publishDateStr || !fetchDateStr) return false;
    const pub = new Date(publishDateStr);
    const fetch = new Date(fetchDateStr);
    const diffMs = fetch - pub;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays <= 1 && diffDays >= 0; // 发布日期在采集日期前1天内
}

function transformRecord(record, fetchDateStr) {
    // 判断 recency：如果发布日期就是采集当天，或1天内，标记为 24h内
    const recency = (record.date === fetchDateStr) ? '24h内' : '历史';

    // 提取互动数据（小红书原始字段可能为 likes/comments/favorites/collects/shares）
    const likes = Number(record.likes) || Number(record.likeCount) || 0;
    const comments = Number(record.comments) || Number(record.commentCount) || 0;
    const favorites = Number(record.favorites) || Number(record.collectCount) || Number(record.shareCount) || 0;

    const heatScore = computeHeatScore({ likes, comments, favorites });
    const category = inferCategory(record.title, record.content);

    return {
        id: record.id || '',
        date: record.date || record.publishTime || fetchDateStr,
        publishTime: record.publishTime || record.date || fetchDateStr,
        source: record.source || '小红书',
        sourceType: 'xiaohongshu', // 小红书独立分类
        sentiment: record.sentiment || 'neutral',
        riskLevel: record.riskLevel || 'low',
        title: record.title || '',
        content: record.content || '',
        url: record.url || '',
        author: record.author || record.source || '未知',
        status: record.status || '已发布',
        amount: record.amount || '-',
        relatedProduct: record.relatedProduct || inferProduct(record.title, record.content),
        fetchTime: record.fetchTime || fetchDateStr,
        recency: recency,
        keywords: extractKeywords(record.title, record.content),
        likes,
        comments,
        favorites,
        heatScore,
        category,
        channel: 'xiaohongshu' // 额外标记来源渠道
    };
}

function transformXhsData(v2Data, fetchDateStr) {
    if (!v2Data || !v2Data.records || !Array.isArray(v2Data.records)) {
        return null;
    }

    // v2 仓库提供的是全量合并数据，提取小红书记录
    const xhsRecords = v2Data.records.filter(r => r.sourceType === 'xiaohongshu');

    if (xhsRecords.length === 0) {
        console.log('⚠️  v2 数据中无小红书记录');
        return null;
    }

    // v2 数据已经是处理过的标准格式，只需补充/修正部分字段
    const records = xhsRecords.map(r => ({
        id: r.id || '',
        date: r.date || r.publishTime || fetchDateStr,
        publishTime: r.publishTime || r.date || fetchDateStr,
        source: r.source || '小红书',
        sourceType: 'xiaohongshu',
        sentiment: r.sentiment || 'neutral',
        riskLevel: r.riskLevel || 'low',
        title: r.title || '',
        content: r.content || '',
        url: r.url || '',
        author: r.author || r.source || '未知',
        status: r.status || '已发布',
        amount: r.amount || '-',
        relatedProduct: r.relatedProduct || inferProduct(r.title, r.content),
        fetchTime: r.fetchTime || fetchDateStr,
        recency: r.recency || '历史',
        keywords: r.keywords || extractKeywords(r.title, r.content),
        likes: Number(r.likes) || 0,
        comments: Number(r.comments) || 0,
        favorites: Number(r.favorites) || 0,
        heatScore: r.heatScore || computeHeatScore({ likes: r.likes, comments: r.comments, favorites: r.favorites }),
        category: r.category || inferCategory(r.title, r.content),
        channel: 'xiaohongshu'
    }));

    // 统计
    const total = records.length;
    const recentCount = records.filter(r => r.recency === '24h内').length;
    const historyCount = records.filter(r => r.recency === '历史').length;
    const negativeCount = records.filter(r => r.sentiment === 'negative').length;
    const positiveCount = records.filter(r => r.sentiment === 'positive').length;
    const neutralCount = records.filter(r => r.sentiment === 'neutral').length;
    const highRiskCount = records.filter(r => r.riskLevel === 'high').length;
    const negPct = total > 0 ? Math.round((negativeCount / total) * 100) : 0;

    const bySentiment = { positive: positiveCount, negative: negativeCount, neutral: neutralCount };
    const byRisk = { high: records.filter(r => r.riskLevel === 'high').length, medium: records.filter(r => r.riskLevel === 'medium').length, low: records.filter(r => r.riskLevel === 'low').length };
    const byProduct = {};
    records.forEach(r => {
        byProduct[r.relatedProduct] = (byProduct[r.relatedProduct] || 0) + 1;
    });

    // 热词统计
    const kwCounts = {};
    records.forEach(r => {
        (r.keywords || []).forEach(k => {
            kwCounts[k] = (kwCounts[k] || 0) + 1;
        });
    });
    const hotKeywords = Object.entries(kwCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([word, count]) => ({ word, count }));

    return {
        reportDate: fetchDateStr,
        generatedAt: `${fetchDateStr} ${new Date().toTimeString().slice(0, 5)}`,
        source: 'xiaohongshu',
        summary: {
            total,
            recentCount,
            historyCount,
            negativeCount,
            negativePct: negPct,
            positiveCount,
            neutralCount,
            channelCount: 1,
            highRiskCount
        },
        bySource: { xiaohongshu: total },
        bySentiment,
        byRisk,
        byProduct,
        byCategory: {},
        hotKeywords,
        records
    };
}

// ===== 主流程 =====
async function main() {
    const dateStr = process.argv[2] || getTodayBeijing();
    console.log(`\n📕 拉取小红书舆情数据: ${dateStr}`);
    console.log('='.repeat(40));

    const url = `${GITHUB_RAW_BASE}/${dateStr}.json`;
    console.log(`🌐 请求: ${url}`);

    const xhsData = await fetchJson(url);

    if (!xhsData) {
        console.log('❌ 未获取到数据（仓库可能尚未更新或网络错误）');
        console.log('   提示: 小红书数据每日 21:00 自动更新，请确认时间');
        process.exit(1);
    }

    console.log(`📥 v2 全量数据: ${xhsData.records ? xhsData.records.length : 0}条`);

    // 转换数据
    const transformed = transformXhsData(xhsData, dateStr);

    console.log(`📕 提取小红书记录: ${transformed ? transformed.records.length : 0}条`);

    if (!transformed || transformed.records.length === 0) {
        console.log('⚠️  转换后无有效小红书记录（v2 全量数据中无 sourceType=xiaohongshu 的记录）');
        process.exit(1);
    }

    // 写入中间文件
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const outputPath = path.join(DATA_DIR, `xhs-${dateStr}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(transformed, null, 2));

    console.log(`✅ 已保存: data/xhs-${dateStr}.json`);
    console.log(`\n📊 数据概览:`);
    console.log(`   总数: ${transformed.summary.total}`);
    console.log(`   24h内: ${transformed.summary.recentCount} | 历史: ${transformed.summary.historyCount}`);
    console.log(`   负面: ${transformed.summary.negativeCount} (${transformed.summary.negativePct}%)`);
    console.log(`   高风险: ${transformed.summary.highRiskCount}`);
    console.log(`   产品分布:`, transformed.byProduct);
    console.log('='.repeat(40));
}

main().catch(err => {
    console.error('执行错误:', err);
    process.exit(1);
});
