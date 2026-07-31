#!/usr/bin/env node
/**
 * generate-dashboard-data.js v2.0
 * 每日舆情监测：解析中间 markdown → 合并去重 → 活动筛选 → 热词统计 → 生成标准 JSON + 告警文件
 *
 * 用法: node generate-dashboard-data.js [YYYY-MM-DD]
 * 默认取今天北京时间
 * 输出: sentiment_monitor/data/YYYY-MM-DD.json
 *      sentiment_monitor/alerts/YYYY-MM-DD.json（如有高风险）
 */

const fs = require('fs');
const path = require('path');
const dedup = require('./dedup-utils.js');
const { semanticProcess } = require('./llm-semantic-processing');
const { topicCluster } = require('./llm-topic-cluster');
const { filterBatch } = require('./filter-rules.js');

const WORKSPACE = '/root/.openclaw/workspace';
const DATA_DIR = path.join(WORKSPACE, 'sentiment_monitor', 'data');
const ALERTS_DIR = path.join(WORKSPACE, 'sentiment_monitor', 'alerts');
const DAILY_DIR = path.join(WORKSPACE, 'ym-daily');

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

// ===== Markdown 解析器 =====

const KEYWORD_LIST = [
    '升金有礼', 'i豆', '贬值', '积分', '清零', '立减金', '空奖', '抽奖', '心动有礼', 'i豆乐园',
    '投诉', '维权', '虚假宣传', '谢谢参与', '霸王条款', '美团', '商城',
    '不发货', '优惠券', '代金券', '红包', '冻结', '信用卡', '长辈',
    '河北', '安徽', '吉林', '长宁', '支行', '分行', '客服', '95588',
    '通知', '提醒', '到账', '兑换', '资产达标', '月月升金', '资产提升'
];

function parseDateFromText(text) {
    if (!text) return null;
    const t = text.toString().trim();
    // YYYY-MM-DD / YYYY/MM/DD
    let m = t.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
    // YYYY-MM / YYYY/MM
    m = t.match(/(\d{4})[-\/](\d{1,2})(?!\d)/);
    if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-01`;
    // YYYY年MM月
    m = t.match(/(\d{4})年(\d{1,2})月/);
    if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-01`;
    // YYYY年
    m = t.match(/(\d{4})年/);
    if (m) return `${m[1]}-01-01`;
    // 微博/黑猫投诉 RFC 2822 格式：Wed Mar 05 14:03:30 +0800 2025
    const d = new Date(t);
    if (!isNaN(d.getTime()) && /\d{4}/.test(t)) {
        // 用 UTC 日期避免时区漂移
        return d.toISOString().slice(0, 10);
    }
    return null;
}

function parseSentiment(text) {
    const t = (text || '').toLowerCase();
    if (t.includes('正面') || t.includes('积极') || t.includes('positive')) return 'positive';
    if (t.includes('负面') || t.includes('消极') || t.includes('negative')) return 'negative';
    return 'neutral';
}

function inferSourceType(source, url) {
    // 优先根据 URL 域名判断来源
    const u = (url || '').toLowerCase();
    if (u.includes('weibo.com') || u.includes('m.weibo.cn')) return 'social';
    if (u.includes('xiaohongshu.com')) return 'xiaohongshu';
    if (u.includes('tousu.sina.cn') || u.includes('黑猫投诉')) return 'complaint';
    if (u.includes('zhihu.com')) return 'forum';
    if (u.includes('news') || u.includes('sina.com') || u.includes('163.com') || u.includes('qq.com') || u.includes('sohu.com') || u.includes('ifeng.com')) return 'news';
    
    const s = (source || '').toLowerCase();
    if (s.includes('黑猫投诉')) return 'complaint';
    if (s.includes('微博') || s.includes('博主') || s.includes('twitter')) return 'social';
    if (s.includes('论坛') || s.includes('吧') || s.includes('社区') || s.includes('线报') || s.includes('羊毛') || s.includes('赚客') || s.includes('什么值得买') || s.includes('知乎')) return 'forum';
    if (s.includes('官方') || s.includes('总行') || s.includes('分行') || s.includes('支行') || s.includes('招标')) return 'official';
    if (s.includes('新闻') || s.includes('报') || s.includes('网') || s.includes('财经') || s.includes('媒体') || s.includes('新浪') || s.includes('信网') || s.includes('九派') || s.includes('消费者报')) return 'news';
    if (s.includes('小红书')) return 'xiaohongshu';
    return 'news';
}

function inferRiskLevel(record) {
    const fermentation = (record.fermentation || '').toLowerCase();
    const sentiment = record.sentiment || '';
    const isComplaint = (record.isComplaint || '').toString().toLowerCase();
    const title = (record.title || '').toLowerCase();
    const content = (record.content || '').toLowerCase();

    // 发酵程度包含 "高" 或 内容明确提及媒体集中报道
    const isHighFermentation = fermentation.includes('高') || content.includes('媒体集中报道') || content.includes('十余家') || content.includes('多家媒体');
    const isMediumFermentation = fermentation.includes('中');

    // 热搜相关 → high
    if (record.fromHotSearch) return 'high';

    let risk = 'low';
    if (isHighFermentation && sentiment === 'negative') risk = 'high';
    else if (isMediumFermentation && sentiment === 'negative') risk = 'medium';
    else if (sentiment === 'negative' && (isComplaint.includes('是') || isComplaint.includes('yes'))) risk = 'medium';

    // 应用反馈学习到的风险规则
    return applyRiskRules(record, risk);
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

// ===== 类别推断 =====
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

// ===== 热度计算 =====
function computeHeatScore(record) {
    const likes = Number(record.likes) || 0;
    const comments = Number(record.comments) || 0;
    const favorites = Number(record.favorites) || 0;
    return Math.round(likes * 1 + comments * 2 + favorites * 1.5);
}

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

function extractAmount(content) {
    if (!content) return '-';
    const m = content.match(/(\d+(?:\.\d+)?)\s*(元|i豆|积分|万\s*元|万元)/);
    if (m) return m[0];
    return '-';
}

// 过滤过旧记录（超过30天的历史记录不再纳入当日报表，避免旧闻/回顾性报道混入）
function filterOldRecords(records, fetchDateStr) {
    const fetchDate = new Date(fetchDateStr);
    const maxAgeDays = 30;
    return records.filter(r => {
        let pubDate;
        try {
            pubDate = new Date(r.date || fetchDateStr);
        } catch (e) {
            pubDate = new Date(fetchDateStr);
        }
        // 处理无效日期（如 "昨天 06:02"）
        if (isNaN(pubDate.getTime())) {
            // 相对时间兜底：如果日期字符串包含"昨天/今天/前天"，视为有效
            const dateStr = (r.date || '').toLowerCase();
            if (dateStr.includes('今天') || dateStr.includes('昨天') || dateStr.includes('前天') || dateStr.includes('小时前') || dateStr.includes('分钟前')) {
                return true;
            }
            // 否则使用 fetchDateStr
            pubDate = new Date(fetchDateStr);
        }
        const daysDiff = (fetchDate - pubDate) / (1000 * 60 * 60 * 24);
        return daysDiff <= maxAgeDays;
    });
}

function generateId(dateStr, index) {
    const prefix = dateStr.replace(/-/g, '');
    return `${prefix}-${String(index + 1).padStart(2, '0')}`;
}

// 解析单个 markdown 文件
function parseMdFile(filePath, fetchDateStr) {
    if (!fs.existsSync(filePath)) {
        return [];
    }
    const content = fs.readFileSync(filePath, 'utf8');

    // 判断默认来源类型：weibo/hot 文件默认 social，web 文件由 inferSourceType 推断
    let defaultSourceType = null;
    const basename = path.basename(filePath);
    if (basename.startsWith('weibo-') || basename.startsWith('hot-')) {
        defaultSourceType = 'social';
    }

    // 检查是否无有效舆情（不能仅靠字符串包含，因为文件里可能引用"无有效舆情"但后面有数据）
    // 真正空的文件：没有 #### 或 ### 标题行（排除文件开头的 H1/H2）
    const hasTitleLine = content.split('\n').some(l => {
        const t = l.trim();
        return /^####\s+/.test(t) || /^###\s+\d+/.test(t);
    });
    if (!hasTitleLine) {
        return [];
    }

    const records = [];
    const lines = content.split('\n');
    let current = null;
    let inContent = false;

    for (const rawLine of lines) {
        const line = rawLine.trimEnd();

        // 标题行模式检测
        // web 格式: #### 舆情N：标题（严格匹配）
        // web 格式（新版）: #### N. 标题（数字+点）
        // weibo 格式: ### N. 标题（N为整数，有小数点分隔符）
        const webTitleMatch = line.match(/^####\s+舆情\d+[:：]\s*(.+)$/);
        const webTitleMatch2 = line.match(/^####\s+\d+[\.．]\s+(.+)$/);
        const weiboTitleMatch = line.match(/^###\s+\d+[\.．]\s+(.+)$/);
        // 注意：排除 ### 2.1 升金有礼相关投诉/吐槽 这类章节标题
        // 章节标题的特征：含"相关投诉/吐槽"、"相关投诉/负面"、"中性/正面信息"、"补充信息"
        // 章节标题的特征：含"相关投诉/吐槽"、"相关负面"、"中性/正面信息"、"补充信息"、"舆情总结"、"类"结尾的分类标题
        const isSectionHeader = line.includes('相关投诉') || line.includes('相关负面') || line.includes('中性/正面') || line.includes('补充信息') || line.includes('舆情总结') || /\d+[\.．]\s*\S+类$/.test(line);
        const titleMatch = webTitleMatch || webTitleMatch2 || (weiboTitleMatch && !isSectionHeader ? weiboTitleMatch : null);

        if (titleMatch) {
            if (current) {
                finalizeRecord(current, fetchDateStr, defaultSourceType);
                records.push(current);
            }
            current = { title: titleMatch[1].trim() };
            inContent = false;
            continue;
        }

        if (!current) continue;

        // 字段行: - **字段名**：值
        const fieldMatch = line.match(/^-\s*\*\*(.+?)\*\*[:：]\s*(.*)$/);
        if (fieldMatch) {
            const fieldName = fieldMatch[1].trim();
            const fieldValue = fieldMatch[2].trim();

            switch (fieldName) {
                case '内容摘要':
                    current.content = fieldValue;
                    break;
                case '来源渠道':
                case '来源博主':
                    current.source = fieldValue;
                    break;
                case '发布时间':
                    current.publishTime = fieldValue;
                    break;
                case '情绪倾向':
                    current.sentimentRaw = fieldValue;
                    break;
                case '是否可能成为投诉点':
                    current.isComplaint = fieldValue;
                    break;
                case '发酵程度':
                    current.fermentation = fieldValue;
                    break;
                case '时效性标签':
                    current.recency = fieldValue === '24h内' ? '24h内' : '历史';
                    break;
                case '涉诉金额':
                    current.amount = fieldValue;
                    break;
                case '链接':
                case '原文链接':
                    current.url = fieldValue;
                    break;
            }
        }
    }

    if (current) {
        finalizeRecord(current, fetchDateStr, defaultSourceType);
        records.push(current);
    }

    return records;
}

function finalizeRecord(record, fetchDateStr, defaultSourceType) {
    record.sentiment = parseSentiment(record.sentimentRaw);
    // 优先使用文件类型指定的来源（weibo/hot 文件强制 social），否则由 inferSourceType 推断
    const inferred = inferSourceType(record.source, record.url);
    record.sourceType = defaultSourceType || inferred;
    record.riskLevel = inferRiskLevel(record);
    record.relatedProduct = inferProduct(record.title, record.content);
    record.keywords = extractKeywords(record.title, record.content);
    record.amount = record.amount || extractAmount(record.content);
    if (!record.recency) {
        const rDate = (record.date || '').toString().slice(0, 10);
        record.recency = (rDate === fetchDateStr) ? '24h内' : '历史';
    }
    record.status = '未处理';
    record.fermentation = record.fermentation || 'low';

    // 互动数据：优先从 engagement 对象提取（小红书格式），其次直接字段
    const engagement = record.engagement || {};
    record.likes = Number(engagement.likes || record.likes) || 0;
    record.comments = Number(engagement.comments || record.comments) || 0;
    record.favorites = Number(engagement.collects || record.favorites) || 0;
    record.shares = Number(engagement.shares || record.shares) || 0;

    // 微博数据有 reposts 但 dashboard 用 favorites，做兼容映射
    if (record.reposts && !record.favorites) {
        record.favorites = Number(record.reposts) || 0;
    }

    // date 取发布日期，解析失败则用监测日期
    const parsedDate = parseDateFromText(record.publishTime);
    record.date = parsedDate || fetchDateStr;
    record.publishTime = record.publishTime || record.date;
    record.fetchTime = fetchDateStr;
    record.author = record.source || '未知';
    record.url = record.url || '';
    // content 必须有默认值，避免 undefined 显示；微博/网页摘要缺失时用 title 兜底
    record.content = record.content || record.title || '';
}

// 微博情感推断（基于关键词）
// ===== 反馈规则加载 =====
let FEEDBACK_RULES = null;
function loadFeedbackRules() {
    if (FEEDBACK_RULES) return FEEDBACK_RULES;
    const rulesPath = path.join(WORKSPACE, 'sentiment_monitor', 'feedback-rules.json');
    if (fs.existsSync(rulesPath)) {
        try {
            FEEDBACK_RULES = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
            console.log('[FeedbackRules] 已加载', FEEDBACK_RULES.sentimentAdjustments.length, '条情感调整规则');
        } catch (e) {
            console.warn('[FeedbackRules] 加载失败:', e.message);
            FEEDBACK_RULES = { sentimentAdjustments: [], riskAdjustments: [] };
        }
    } else {
        FEEDBACK_RULES = { sentimentAdjustments: [], riskAdjustments: [] };
    }
    return FEEDBACK_RULES;
}

function applySentimentRules(text, originalSentiment) {
    const rules = loadFeedbackRules();
    const t = (text || '').toLowerCase();
    for (const adj of rules.sentimentAdjustments || []) {
        if (t.includes(adj.keyword.toLowerCase()) && originalSentiment === adj.originalSentiment) {
            console.log('[FeedbackRules] 应用规则:', adj.keyword, originalSentiment, '->', adj.correction, `(置信度${(adj.confidence * 100).toFixed(0)}%)`);
            return adj.correction;
        }
    }
    return originalSentiment;
}

function applyRiskRules(record, originalRisk) {
    const rules = loadFeedbackRules();
    for (const adj of rules.riskAdjustments || []) {
        if (record.sourceType === adj.sourceType) {
            console.log('[FeedbackRules] 应用风险规则:', record.sourceType, `(置信度${(adj.confidence * 100).toFixed(0)}%)`);
            // 风险调整逻辑：根据反馈降低/升高风险等级
            if (adj.reason.includes('误判为高')) return 'medium';
            if (adj.reason.includes('误判为低')) return 'medium';
        }
    }
    return originalRisk;
}

function inferWeiboSentiment(text) {
    const t = (text || '').toLowerCase();
    const negativeWords = ['投诉', '维权', '虚假宣传', '谢谢参与', '空奖', '骗', '坑', '垃圾', '差', '烂', '被骗', '套路', '恶心', '失望', '愤怒', '差评', '吐槽', '坑人', '忽悠', '诈骗', '假货', '不满', '后悔', '坑爹', '坑死', '无语', '气死', '流氓', '黑幕', '曝光'];
    const positiveWords = ['好评', '不错', '推荐', '赞', '满意', '给力', '棒', '好用', '划算', '超值', '完美', '优秀', '惊喜', '开心', '高兴', '愉快', '实惠', '羊毛', '攻略', '必中'];
    let sentiment = 'neutral';
    if (negativeWords.some(w => t.includes(w))) sentiment = 'negative';
    else if (positiveWords.some(w => t.includes(w))) sentiment = 'positive';

    // 特殊规则：对比句式中夸工行的应判定为正面（覆盖"谢谢参与"等负面词）
    // 例："建行...谢谢参与，而工行直接给了我...立减金"
    const contrastPattern = /而\s*工行.*(?:给|送|拿到|获得|中了|抽到|返|得)/i;
    if (sentiment === 'negative' && contrastPattern.test(text)) {
        sentiment = 'positive';
    }

    // 应用反馈学习到的规则
    return applySentimentRules(text, sentiment);
}

// 解析微博 JSON 文件（支持 v2 MCP 格式和旧格式）
function parseWeiboJsonFile(filePath, fetchDateStr) {
    if (!fs.existsSync(filePath)) return [];

    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        let posts = [];

        // v2 格式: all_posts 数组
        if (Array.isArray(data.all_posts)) {
            posts = data.all_posts;
        }
        // 旧格式: results 数组
        else if (Array.isArray(data.results)) {
            posts = data.results;
        }
        // keyword_results 对象格式
        else if (data.keyword_results && typeof data.keyword_results === 'object') {
            for (const kw in data.keyword_results) {
                const arr = data.keyword_results[kw];
                if (Array.isArray(arr)) posts.push(...arr);
            }
        }
        // 直接是数组
        else if (Array.isArray(data)) {
            posts = data;
        }
        // {keyword: [posts...]} 格式（fetch-weibo-mcp.js 保存格式）
        else if (typeof data === 'object' && data !== null) {
            for (const key in data) {
                if (Array.isArray(data[key])) {
                    posts.push(...data[key]);
                }
            }
        }

        if (posts.length === 0) return [];

        const records = [];
        for (const post of posts) {
            // 支持 text（原始 MCP 格式）或 content（fetch-weibo-mcp.js 保存格式）
            const rawText = post.text || post.content || '';
            if (!post || !rawText) continue;

            const text = rawText.trim();
            // 去掉 HTML 标签后再生成 title，避免超话链接类微博的 title 全是 HTML
            const plainText = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            const title = plainText.length > 40 ? plainText.slice(0, 40) + '...' : plainText;

            // 情感推断
            const sentimentRaw = inferWeiboSentiment(text);

            // 日期解析：支持 created_at（原始格式）或 publishTime（保存格式）
            let publishTime = post.created_at || post.publishTime || '';
            let parsedDate = parseDateFromText(publishTime);

            // URL 构建
            let url = post.url || '';
            if (!url && post.id && post.id !== 'unknown') {
                // 微博移动端链接，仅需微博ID
                url = `https://m.weibo.cn/detail/${post.id}`;
            }

            // recency 判断：基于实际时间差（小时），≤24h 才算 24h内
            let recency = '历史';
            const now = new Date();
            if (publishTime && publishTime !== 'unknown') {
                const pubTime = new Date(publishTime);
                if (!isNaN(pubTime)) {
                    const hoursDiff = (now - pubTime) / 3600000;
                    if (hoursDiff >= 0 && hoursDiff <= 24) {
                        recency = '24h内';
                    }
                } else if (parsedDate === fetchDateStr) {
                    recency = '24h内';
                }
            } else if (parsedDate === fetchDateStr) {
                recency = '24h内';
            }

            // 互动数据：支持原始 MCP 字段名（attitudes_count/comments_count/reposts_count）
            // 或保存后的字段名（likes/comments/reposts）
            const likes = post.likes || post.attitudes_count || 0;
            const comments = post.comments || post.comments_count || 0;
            const favorites = post.reposts || post.reposts_count || 0;

            const record = {
                title: title,
                content: text,
                source: post.user || post.author || '微博用户',
                publishTime: publishTime || fetchDateStr,
                sentimentRaw: sentimentRaw,
                url: url,
                likes: likes,
                comments: comments,
                favorites: favorites,
                recency: recency
            };

            finalizeRecord(record, fetchDateStr, 'social');
            records.push(record);
        }

        return records;
    } catch (e) {
        console.log(`⚠️  微博 JSON 解析失败: ${e.message}`);
        return [];
    }
}

// ===== 活动相关筛选 =====
const ACTIVITY_KEYWORDS = ['升金有礼', 'i豆', '资产达标', '月月升金', '立减金', '抽奖', '心动有礼', 'i豆乐园'];

function isActivityRelated(record) {
    const text = ((record.title || '') + ' ' + (record.content || '')).toLowerCase();
    // 先检查是否命中活动关键词
    const hasActivityKw = ACTIVITY_KEYWORDS.some(kw => text.includes(kw.toLowerCase()));
    if (!hasActivityKw) return false;
    // 排除员工个人吐槽/非活动类内容
    const NON_ACTIVITY_KEYWORDS = ['员工出道', '打工人', '银行员工吐槽', '员工辞职', '员工离职', '员工日常'];
    const hasNonActivityKw = NON_ACTIVITY_KEYWORDS.some(kw => text.includes(kw.toLowerCase()));
    if (hasNonActivityKw) return false;
    return true;
}

// ===== 合并去重 =====
function mergeRecords(recordLists, dateStr) {
    const all = recordLists.flat();

    // 1. 加载历史 URL 索引和记录（用于跨天去重）
    const urlIndex = dedup.loadHistoricalUrlIndex(DATA_DIR, dateStr, 30);
    const historicalRecords = [];
    const end = new Date(dateStr);
    for (let i = 1; i <= 30; i++) {
        const d = new Date(end);
        d.setDate(d.getDate() - i);
        const ds = formatDate(d);
        const filePath = path.join(DATA_DIR, `${ds}.json`);
        if (!fs.existsSync(filePath)) continue;
        try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (data.records) historicalRecords.push(...data.records);
        } catch (e) {}
    }

    // 2. 使用 dedup-utils 进行三层去重
    const deduped = dedup.deduplicateRecords(all, historicalRecords, urlIndex);

    // 3. 保留旧的单日内部去重逻辑作为兜底（防止同日多源重复）
    const seen = new Map();
    for (const r of deduped) {
        const key = (r.title || '').slice(0, 20) + '|' + (r.source || '').slice(0, 10);
        if (seen.has(key)) {
            const existing = seen.get(key);
            if ((r.content || '').length > (existing.content || '').length) {
                if (r.source !== existing.source && existing.source.indexOf(r.source) === -1) {
                    existing.source = existing.source + '、' + r.source;
                }
                const mergedKw = new Set([...(existing.keywords || []), ...(r.keywords || [])]);
                existing.keywords = Array.from(mergedKw).slice(0, 5);
                existing.content = r.content;
                // 重新推断合并后的相关字段
                existing.relatedProduct = inferProduct(existing.title, existing.content);
                existing.category = inferCategory(existing.title, existing.content);
                existing.keywords = extractKeywords(existing.title, existing.content);
            }
        } else {
            seen.set(key, { ...r });
        }
    }

    return Array.from(seen.values());
}

// ===== 统计计算 =====
function computeStats(records) {
    const total = records.length;
    const recentCount = records.filter(r => r.recency === '24h内').length;
    const historyCount = records.filter(r => r.recency === '历史').length;
    const negativeCount = records.filter(r => r.sentiment === 'negative').length;
    const positiveCount = records.filter(r => r.sentiment === 'positive').length;
    const neutralCount = records.filter(r => r.sentiment === 'neutral').length;
    const negPct = total > 0 ? Math.round((negativeCount / total) * 100) : 0;
    const highRiskCount = records.filter(r => r.riskLevel === 'high').length;
    const channelCount = new Set(records.map(r => r.sourceType)).size;

    const bySource = {};
    const bySentiment = {};
    const byRisk = {};
    const byProduct = {};
    const byCategory = {};

    records.forEach(r => {
        bySource[r.sourceType] = (bySource[r.sourceType] || 0) + 1;
        bySentiment[r.sentiment] = (bySentiment[r.sentiment] || 0) + 1;
        byRisk[r.riskLevel] = (byRisk[r.riskLevel] || 0) + 1;
        byProduct[r.relatedProduct || '其他'] = (byProduct[r.relatedProduct || '其他'] || 0) + 1;
        byCategory[r.category || '其他'] = (byCategory[r.category || '其他'] || 0) + 1;
    });

    return {
        summary: { total, recentCount, historyCount, negativeCount, negativePct: negPct, positiveCount, neutralCount, channelCount, highRiskCount },
        bySource, bySentiment, byRisk, byProduct, byCategory
    };
}

function computeTrend(records, endDateStr) {
    const end = new Date(endDateStr);
    const trend = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(end);
        d.setDate(d.getDate() - i);
        const ds = formatDate(d);
        // 按发布日期 date 分组（不是 fetchTime）
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
        .slice(0, 10)
        .map(([word, count]) => ({ word, count }));
}

// ===== 每日简报生成 =====
function generateDailyBrief(dateStr, stats, records, hotKeywords) {
    const s = stats.summary;
    const total = s.total;
    const neg = s.negativeCount;
    const pos = s.positiveCount;
    const neu = s.neutralCount;
    const recent = s.recentCount;
    const history = s.historyCount;
    const highRisk = s.highRiskCount;

    // 统计24H内新增（基于 recency，与面板"24H内新增"口径一致）
    const recentRecords = records.filter(r => r.recency === '24h内');
    const recentTotal = recentRecords.length;
    const recentNeg = recentRecords.filter(r => r.sentiment === 'negative').length;
    const recentHighRisk = recentRecords.filter(r => r.riskLevel === 'high').length;

    // 统计今日实际采集的记录（fetchTime === dateStr）
    const todayFetched = records.filter(r => r.fetchTime === dateStr || (r.fetchTime || '').toString().startsWith(dateStr));
    const todayFetchedCount = todayFetched.length;

    const prodMap = {};
    const srcMap = {};
    recentRecords.forEach(r => {
        const p = r.relatedProduct || '其他';
        prodMap[p] = (prodMap[p] || 0) + 1;
        srcMap[r.sourceType] = (srcMap[r.sourceType] || 0) + 1;
    });
    const topProd = Object.entries(prodMap).sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]);
    const topSrc = Object.entries(srcMap).sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => {
        const labels = { social: '微博', news: '新闻媒体', complaint: '投诉平台', forum: '论坛社区', official: '官方', xiaohongshu: '小红书' };
        return labels[x[0]] || x[0];
    });
    const topKw = (hotKeywords || []).slice(0, 3).map(k => k.word);

    let text = '';
    if (total === 0) {
        text = `今日（${dateStr}）暂无相关舆情数据。`;
    } else if (todayFetchedCount > 0) {
        // 今日有新采集
        let baseText = `今日（${dateStr}）共采集 ${todayFetchedCount} 条舆情`;
        if (recentTotal > todayFetchedCount) {
            baseText += `，24H内累计新增 ${recentTotal} 条`;
        } else if (recentTotal > 0) {
            baseText += `，其中24H内新增 ${recentTotal} 条`;
        }
        if (neg > 0) baseText += `，其中负面 ${neg} 条`;
        if (pos > 0) baseText += `，正面 ${pos} 条`;
        if (highRisk > 0) baseText += `，发现 ${highRisk} 条高风险舆情需重点关注`;

        let addonText = '';
        if (topProd.length > 0) addonText += `主要集中在「${topProd.join('、')}」等产品`;
        if (topSrc.length > 0) addonText += (addonText ? '，' : '') + `来源以${topSrc.join('、')}为主`;
        if (topKw.length > 0) addonText += (addonText ? '，' : '') + `热词包括「${topKw.join('、')}」`;

        text = baseText + '。' + (addonText ? addonText + '。' : '');
    } else if (recentTotal > 0) {
        // 无今日采集，但有24H内新增（历史数据中的新发布内容）
        text = `今日（${dateStr}）从历史数据中发现 ${recentTotal} 条24H内新增舆情`;
        if (recentNeg > 0) text += `，其中负面 ${recentNeg} 条`;
        if (recentHighRisk > 0) text += `，高风险 ${recentHighRisk} 条需关注`;
        text += `。当前累计展示 ${total} 条。`;
    } else {
        // 无今日采集，无24H内新增，全是历史
        text = `今日（${dateStr}）无新增舆情，当前展示 ${total} 条历史持续舆情`;
        if (history > 0) text += `（其中历史 ${history} 条）`;
        text += `。`;
    }

    return {
        text: text,
        date: dateStr,
        generatedAt: new Date().toISOString()
    };
}

// ===== 加载历史数据用于趋势回填 =====
function loadHistoricalRecords(endDateStr) {
    const records = [];
    const end = new Date(endDateStr);
    // 加载最近 30 天的数据
    for (let i = 1; i <= 30; i++) {
        const d = new Date(end);
        d.setDate(d.getDate() - i);
        const ds = formatDate(d);
        const filePath = path.join(DATA_DIR, `${ds}.json`);
        if (fs.existsSync(filePath)) {
            try {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                if (data.records && data.records.length > 0) {
                    records.push(...data.records);
                }
            } catch (e) {
                // ignore
            }
        }
    }
    return records;
}

// ===== 告警文件 =====
function generateAlertFile(dateStr, records) {
    const highRisk = records.filter(r => r.riskLevel === 'high');
    const mediumRisk = records.filter(r => r.riskLevel === 'medium');

    if (highRisk.length === 0 && mediumRisk.length === 0) {
        // 清理旧告警文件（如果存在）
        const alertPath = path.join(ALERTS_DIR, `${dateStr}.json`);
        if (fs.existsSync(alertPath)) {
            fs.unlinkSync(alertPath);
        }
        return;
    }

    const alert = {
        alertDate: dateStr,
        generatedAt: new Date().toISOString(),
        summary: {
            high: highRisk.length,
            medium: mediumRisk.length,
            total: highRisk.length + mediumRisk.length
        },
        records: [
            ...highRisk.map(r => ({
                id: r.id,
                title: r.title,
                source: r.source,
                content: (r.content || '').slice(0, 120) + ((r.content || '').length > 120 ? '...' : ''),
                riskLevel: r.riskLevel,
                sentiment: r.sentiment,
                url: r.url,
                relatedProduct: r.relatedProduct
            })),
            ...mediumRisk.map(r => ({
                id: r.id,
                title: r.title,
                source: r.source,
                content: (r.content || '').slice(0, 120) + ((r.content || '').length > 120 ? '...' : ''),
                riskLevel: r.riskLevel,
                sentiment: r.sentiment,
                url: r.url,
                relatedProduct: r.relatedProduct
            }))
        ]
    };

    fs.mkdirSync(ALERTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(ALERTS_DIR, `${dateStr}.json`), JSON.stringify(alert, null, 2));
    console.log(`⚠️  生成告警文件: alerts/${dateStr}.json (high=${highRisk.length}, medium=${mediumRisk.length})`);
}

// ===== Markdown 报告生成 =====
function generateMarkdownReport(dateStr, report) {
  const lines = [
    `# 工行舆情监测日报`,
    ``,
    `**监测日期**: ${dateStr}  `,
    `**生成时间**: ${report.generatedAt}  `,
    `**数据来源**: 微博智搜 / 网络搜索 / 小红书 / 微博热搜`,
    ``,
    `---`,
    ``,
    `## 一、总体概况`,
    ``,
    `- **舆情总数**: ${report.summary.total} 条`,
    `- **24h内新增**: ${report.summary.recentCount} 条`,
    `- **历史持续**: ${report.summary.historyCount} 条`,
    `- **负面**: ${report.summary.negativeCount} 条 (${report.summary.negativePct}%)`,
    `- **正面**: ${report.summary.positiveCount} 条`,
    `- **中性**: ${report.summary.neutralCount} 条`,
    `- **高风险**: ${report.summary.highRiskCount} 条`,
    `- **覆盖渠道**: ${report.summary.channelCount} 个`,
    ``,
    `## 二、渠道分布`,
    ``
  ];

  Object.entries(report.bySource || {}).forEach(([src, count]) => {
    const label = { social: '微博', news: '新闻媒体', complaint: '投诉平台', forum: '论坛社区', official: '官方', xiaohongshu: '小红书' }[src] || src;
    lines.push(`- ${label}: ${count} 条`);
  });
  lines.push('');

  lines.push('## 三、情感分布');
  lines.push('');
  Object.entries(report.bySentiment || {}).forEach(([sent, count]) => {
    const label = { positive: '正面', negative: '负面', neutral: '中性' }[sent] || sent;
    lines.push(`- ${label}: ${count} 条`);
  });
  lines.push('');

  lines.push('## 四、产品分布');
  lines.push('');
  Object.entries(report.byProduct || {}).forEach(([prod, count]) => {
    lines.push(`- ${prod}: ${count} 条`);
  });
  lines.push('');

  const highRisk = (report.records || []).filter(r => r.riskLevel === 'high');
  const mediumRisk = (report.records || []).filter(r => r.riskLevel === 'medium');

  if (highRisk.length > 0 || mediumRisk.length > 0) {
    lines.push('## 五、风险舆情');
    lines.push('');
    if (highRisk.length > 0) {
      lines.push('**高风险:**');
      lines.push('');
      highRisk.forEach((r, i) => {
        lines.push(`${i + 1}. **${r.title}**`);
        lines.push(`   - 来源: ${r.source} | 情感: ${r.sentiment} | 时效: ${r.recency}`);
        lines.push(`   - ${r.content}`);
        lines.push('');
      });
    }
    if (mediumRisk.length > 0) {
      lines.push('**中风险:**');
      lines.push('');
      mediumRisk.forEach((r, i) => {
        lines.push(`${i + 1}. **${r.title}**`);
        lines.push(`   - 来源: ${r.source} | 情感: ${r.sentiment} | 时效: ${r.recency}`);
        lines.push(`   - ${r.content}`);
        lines.push('');
      });
    }
  }

  lines.push('## 六、舆情明细');
  lines.push('');
  (report.records || []).forEach((r, i) => {
    lines.push(`### ${i + 1}. ${r.title}`);
    lines.push(`- **来源**: ${r.source} (${r.sourceType})`);
    lines.push(`- **发布时间**: ${r.date}`);
    lines.push(`- **情感**: ${r.sentiment} | **风险**: ${r.riskLevel} | **时效**: ${r.recency}`);
    lines.push(`- **涉及产品**: ${r.relatedProduct || '其他'}`);
    lines.push(`- **内容**: ${r.content}`);
    if (r.url) lines.push(`- **链接**: ${r.url}`);
    lines.push('');
  });

  lines.push('---');
  lines.push('');
  lines.push('*由 OpenClaw 舆情监测系统自动生成*');

  return lines.join('\n');
}

// ===== 主流程 =====
async function main() {
    const dateStr = process.argv[2] || getTodayBeijing();
    console.log(`\n🔍 生成舆情数据: ${dateStr}`);
    console.log('=' .repeat(40));

    // 1. 解析所有中间文件
    const webFile = path.join(DAILY_DIR, `web-${dateStr}.md`);
    const weiboMdFile = path.join(DAILY_DIR, `weibo-${dateStr}.md`);
    // 微博 JSON 可能在 ym-daily/ 或 data/ 目录
    const weiboJsonFile = path.join(DAILY_DIR, `weibo-${dateStr}.json`);
    const weiboJsonFileAlt = path.join(DATA_DIR, `weibo-${dateStr}.json`);
    const hotFile = path.join(DAILY_DIR, `hot-${dateStr}.md`);

    const webRecords = parseMdFile(webFile, dateStr);
    // 优先尝试 JSON 格式（v2 MCP 版本），fallback 到 Markdown
    let weiboRecords = [];
    if (fs.existsSync(weiboJsonFile)) {
        weiboRecords = parseWeiboJsonFile(weiboJsonFile, dateStr);
    } else if (fs.existsSync(weiboJsonFileAlt)) {
        weiboRecords = parseWeiboJsonFile(weiboJsonFileAlt, dateStr);
    }
    if (weiboRecords.length === 0) {
        weiboRecords = parseMdFile(weiboMdFile, dateStr);
    }
    const hotRecords = parseMdFile(hotFile, dateStr);

    console.log(`📄 web: ${webRecords.length}条`);
    console.log(`📄 weibo: ${weiboRecords.length}条 (JSON优先)`);
    console.log(`📄 hot: ${hotRecords.length}条`);

    // 1.5 拉取小红书数据（如果存在）
    const xhsFile = path.join(DATA_DIR, `xhs-${dateStr}.json`);
    let xhsRecords = [];
    if (fs.existsSync(xhsFile)) {
        try {
            const xhsData = JSON.parse(fs.readFileSync(xhsFile, 'utf8'));
            // 支持直接数组或 {records: [...]} 格式
            xhsRecords = Array.isArray(xhsData) ? xhsData : (xhsData.records || []);
            // 小红书数据缺少 sentiment 推断和 content 字段，需要 finalize
            xhsRecords.forEach(r => {
                // search API 不返回正文，用 title 作为 content 兜底
                r.content = r.content || r.title || '';
                // 基于标题进行情感推断
                r.sentimentRaw = inferWeiboSentiment(r.title);
                finalizeRecord(r, dateStr, 'xiaohongshu');
            });
            // 应用统一噪音过滤
            const { kept: xhsKept, removed: xhsRemoved, stats: xhsStats } = filterBatch(xhsRecords);
            xhsRecords = xhsKept;
            if (xhsStats.removed > 0) {
                console.log(`📕 xhs: ${xhsStats.total}条 → 过滤噪音后 ${xhsKept.length}条 (${Object.entries(xhsStats.byReason).map(([k,v])=>`${k}:${v}`).join(', ')})`);
            } else {
                console.log(`📕 xhs: ${xhsRecords.length}条`);
            }
        } catch (e) {
            console.log(`⚠️  xhs 文件解析失败: ${e.message}`);
        }
    } else {
        console.log(`📕 xhs: 无数据文件`);
    }

    // 2. 合并去重（加入小红书数据，跨30天历史去重）
    let allRecords = mergeRecords([webRecords, weiboRecords, hotRecords, xhsRecords], dateStr);
    console.log(`🔄 合并去重后: ${allRecords.length}条`);

    // 2.5 统一噪音过滤（所有来源）
    const { kept: filteredRecords, removed: noiseRecords, stats: noiseStats } = filterBatch(allRecords);
    if (noiseStats.removed > 0) {
        console.log(`🔇 噪音过滤: 移除${noiseStats.removed}条 (${Object.entries(noiseStats.byReason).map(([k,v])=>`${k}:${v}`).join(', ')})`);
        allRecords = filteredRecords;
    }

    // 2.6 LLM 语义处理（噪音过滤 + 活动筛选）
    const llmSemanticResult = await semanticProcess(allRecords);
    allRecords = llmSemanticResult.kept;
    if (llmSemanticResult.stats.removed > 0) {
        console.log(`🧠 LLM语义过滤: 移除${llmSemanticResult.stats.removed}条`);
    }

    // 3. 活动筛选已改为LLM语义处理，此处跳过兜底过滤
    const activityRecords = allRecords;
    console.log(`🏷️  LLM语义筛选后: ${activityRecords.length}条`);

    // 3.5 【已修改】不再过滤超过30天的旧记录，保留所有数据，由 recency 字段区分时效
    // const recentActivityRecords = filterOldRecords(activityRecords, dateStr);
    // const oldFilteredOut = activityRecords.length - recentActivityRecords.length;
    // if (oldFilteredOut > 0) {
    //     console.log(`📅 过滤过旧记录: 移除${oldFilteredOut}条 (>30天)`);
    // }
    const recentActivityRecords = activityRecords;
    console.log(`📅 保留全部记录: ${activityRecords.length}条（含历史数据）`);

    // 4. 如果今日无数据，从历史数据回填（用于趋势展示）
    let finalRecords = recentActivityRecords;
    let fromHistory = false;

    if (recentActivityRecords.length === 0) {
        console.log('⚠️  今日无新舆情，从历史数据回填...');
        const historical = loadHistoricalRecords(dateStr);
        // 不再过滤30天，保留所有历史数据
        if (historical.length > 0) {
            finalRecords = historical.slice(0, 30);
            fromHistory = true;
            console.log(`📚 回填历史: ${finalRecords.length}条`);
        }
    }

    // 5. 分配 ID、计算类别和热度
    finalRecords.forEach((r, i) => {
        r.id = generateId(dateStr, i);
        r.category = inferCategory(r.title, r.content);
        r.heatScore = computeHeatScore(r);
    });

    // 6. 统计计算
    const stats = computeStats(finalRecords);
    const hotKeywords = computeHotKeywords(finalRecords);

    // 6.5 LLM 语义话题聚类
    const clusterResult = await topicCluster(finalRecords);
    const hotTopics = clusterResult.topics || [];

    // 7. 趋势计算：合并今日记录 + 历史记录（用于7天趋势）
    const historicalForTrend = loadHistoricalRecords(dateStr);
    const allForTrend = [...historicalForTrend, ...finalRecords];
    const trend7d = computeTrend(allForTrend, dateStr);

    // 8. 生成每日简报
    const dailyBrief = generateDailyBrief(dateStr, stats, finalRecords, hotKeywords);

    // 9. 组装 JSON
    const report = {
        reportDate: dateStr,
        generatedAt: `${dateStr} ${new Date().toTimeString().slice(0, 5)}`,
        fromHistory,
        summary: stats.summary,
        bySource: stats.bySource,
        bySentiment: stats.bySentiment,
        byRisk: stats.byRisk,
        byProduct: stats.byProduct,
        byCategory: stats.byCategory,
        trend7d,
        hotKeywords,
        hotTopics,
        dailyBrief,
        records: finalRecords
    };

    // 9. 写入数据文件
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const dataPath = path.join(DATA_DIR, `${dateStr}.json`);
    fs.writeFileSync(dataPath, JSON.stringify(report, null, 2));
    console.log(`✅ 数据文件: data/${dateStr}.json`);

    // 10. 生成告警
    generateAlertFile(dateStr, finalRecords);

    // 11. 生成 Markdown 报告
    const REPORTS_DIR = path.join(WORKSPACE, 'reports');
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    const mdContent = generateMarkdownReport(dateStr, report);
    fs.writeFileSync(path.join(REPORTS_DIR, `ym-report-${dateStr}.md`), mdContent);
    console.log(`✅ 报告文件: reports/ym-report-${dateStr}.md`);

    console.log(`\n📊 统计概览:`);
    console.log(`   总数: ${stats.summary.total}`);
    console.log(`   负面: ${stats.summary.negativeCount} (${stats.summary.negativePct}%)`);
    console.log(`   高风险: ${stats.summary.highRiskCount}`);
    console.log(`   渠道: ${stats.summary.channelCount}个`);
    console.log(`   24h内: ${stats.summary.recentCount} | 历史: ${stats.summary.historyCount}`);
    console.log(`   类别:`, stats.byCategory || {});
    console.log('=' .repeat(40));
}

main().catch(e => { console.error(e); process.exit(1); });
