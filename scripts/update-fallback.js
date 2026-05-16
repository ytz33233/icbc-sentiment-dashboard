const fs = require('fs');
const path = require('path');

const WORKSPACE = '/root/.openclaw/workspace';
const SM = path.join(WORKSPACE, 'sentiment_monitor');
const DATA_DIR = path.join(SM, 'data');

// ── 日期工具 ───────────────────────────
function getTodayBeijing() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function getDateStrBefore(baseStr, days) {
  const [yyyy, mm, dd] = baseStr.split('-').map(Number);
  const d = new Date(yyyy, mm - 1, dd);
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDateTs(dstr) {
  if (!dstr) return 0;
  const s = dstr.toString().slice(0, 10);
  if (!/\d{4}-\d{2}-\d{2}/.test(s)) return 0;
  return new Date(s + 'T00:00:00+08:00').getTime();
}

// ── 合并最近7天数据 ─────────────────────
const todayStr = process.argv[2] || getTodayBeijing();
const weekAgoStr = getDateStrBefore(todayStr, 6);

const allRecords = [];
let allHotKeywords = [];

for (let i = 0; i <= 6; i++) {
  const d = new Date(weekAgoStr + 'T00:00:00+08:00');
  d.setDate(d.getDate() + i);
  const ds = d.toISOString().slice(0, 10);
  const fp = path.join(DATA_DIR, `${ds}.json`);
  if (!fs.existsSync(fp)) continue;

  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const recs = raw.records || [];
    allRecords.push(...recs);

    // 合并热词
    (raw.hotKeywords || []).forEach(k => {
      const existing = allHotKeywords.find(x => x.word === k.word);
      if (existing) {
        existing.count += k.count;
      } else {
        allHotKeywords.push({ word: k.word, count: k.count });
      }
    });
  } catch (e) {
    console.warn('  跳过:', ds, e.message);
  }
}

// 去重（按 id）
const seen = new Set();
const uniqueRecords = allRecords.filter(r => {
  if (seen.has(r.id)) return false;
  seen.add(r.id);
  return true;
});

// 过滤掉 date 超过一周的记录
const weekAgoTs = new Date(weekAgoStr + 'T00:00:00+08:00').getTime();
const filteredRecords = uniqueRecords.filter(r => {
  const d = (r.date || '').toString().slice(0, 10);
  if (!/\d{4}-\d{2}-\d{2}/.test(d)) return false;
  const ts = new Date(d + 'T00:00:00+08:00').getTime();
  return ts >= weekAgoTs;
});

// 按日期排序（新在前）
filteredRecords.sort((a, b) => parseDateTs(b.date) - parseDateTs(a.date));

// 热词排序取前20
allHotKeywords.sort((a, b) => b.count - a.count);
allHotKeywords = allHotKeywords.slice(0, 20);

// ── 统计计算 ────────────────────────────
const total = filteredRecords.length;
const negativeCount = filteredRecords.filter(r => r.sentiment === 'negative').length;
const positiveCount = filteredRecords.filter(r => r.sentiment === 'positive').length;
const neutralCount = filteredRecords.filter(r => r.sentiment === 'neutral').length;
const negPct = total > 0 ? Math.round((negativeCount / total) * 100) : 0;
const highRiskCount = filteredRecords.filter(r => r.riskLevel === 'high').length;
const channelCount = new Set(filteredRecords.map(r => r.sourceType)).size;
const recentCount = filteredRecords.filter(r => r.recency === '24h内').length;
const historyCount = filteredRecords.filter(r => r.recency === '历史').length;

const bySentiment = { positive: positiveCount, negative: negativeCount, neutral: neutralCount };
const bySource = {};
const byRisk = {};
const byProduct = {};
const byCategory = {};
filteredRecords.forEach(r => {
  bySource[r.sourceType] = (bySource[r.sourceType] || 0) + 1;
  byRisk[r.riskLevel] = (byRisk[r.riskLevel] || 0) + 1;
  byProduct[r.relatedProduct || '其他'] = (byProduct[r.relatedProduct || '其他'] || 0) + 1;
  byCategory[r.category || '其他'] = (byCategory[r.category || '其他'] || 0) + 1;
});

// 趋势（最近7天）
const trend7d = [];
for (let i = 0; i <= 6; i++) {
  const d = new Date(weekAgoStr + 'T00:00:00+08:00');
  d.setDate(d.getDate() + i);
  const ds = d.toISOString().slice(0, 10);
  const dayRecs = filteredRecords.filter(r => (r.date || '').toString().slice(0, 10) === ds);
  trend7d.push({
    date: ds,
    total: dayRecs.length,
    recent: dayRecs.filter(r => r.recency === '24h内').length,
    history: dayRecs.filter(r => r.recency === '历史').length,
    negative: dayRecs.filter(r => r.sentiment === 'negative').length
  });
}

// 前端需要的字段
const frontendFields = [
  'id', 'date', 'publishTime', 'source', 'sourceType', 'sentiment',
  'riskLevel', 'title', 'content', 'keywords', 'url', 'author',
  'status', 'amount', 'relatedProduct', 'recency', 'fermentation',
  'fetchTime', 'likes', 'comments', 'favorites', 'heatScore', 'category'
];

const cleanRecords = filteredRecords.map(r => {
  const clean = {};
  for (const f of frontendFields) {
    if (r[f] !== undefined) clean[f] = r[f];
  }
  return clean;
});

// ── 构建 fallbackData ──────────────────
const fallbackObj = {
  reportDate: weekAgoStr + ' ~ ' + todayStr,
  generatedAt: new Date().toISOString(),
  summary: { total, recentCount, historyCount, negativeCount, negativePct: negPct, positiveCount, neutralCount, channelCount, highRiskCount },
  bySource,
  bySentiment,
  byRisk,
  byProduct,
  byCategory,
  trend7d,
  hotKeywords: allHotKeywords,
  records: cleanRecords
};

// ── 自定义 JSON stringify，不转义中文 ─────
function safeStringify(obj, indent = 2) {
  const space = ' '.repeat(indent);
  if (obj === null) return 'null';
  if (typeof obj === 'string') return JSON.stringify(obj);
  if (typeof obj === 'number') return String(obj);
  if (typeof obj === 'boolean') return String(obj);
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    const items = obj.map(item => safeStringify(item, indent)).join(',\n' + space);
    return '[\n' + space + items + '\n' + ' '.repeat(indent - 2) + ']';
  }
  const entries = Object.entries(obj);
  if (entries.length === 0) return '{}';
  const items = entries.map(([k, v]) => {
    return `"${k}": ${safeStringify(v, indent + 2)}`;
  }).join(',\n' + space);
  return '{\n' + space + items + '\n' + ' '.repeat(indent - 2) + '}';
}

const newFallback = 'const fallbackData = ' + safeStringify(fallbackObj, 2) + ';';

// ── 写入 dashboard.html ─────────────────
const htmlPath = path.join(SM, 'dashboard.html');
let html = fs.readFileSync(htmlPath, 'utf8');

const startMarker = 'const fallbackData = {';
const startIdx = html.indexOf(startMarker);
if (startIdx === -1) throw new Error('找不到 fallbackData 开始标记');

const endMarker = 'const CONFIG = {';
const endIdx = html.indexOf(endMarker, startIdx);
if (endIdx === -1) throw new Error('找不到 fallbackData 结束标记');

html = html.slice(0, startIdx) + newFallback + '\n\n' + html.slice(endIdx);

fs.writeFileSync(htmlPath, html);
console.log(`✅ fallbackData 已更新为 ${weekAgoStr} ~ ${todayStr} 合并数据，共 ${cleanRecords.length} 条记录`);
console.log(`   来源: ${Object.entries(bySource).map(([k,v])=>k+' '+v).join(', ')}`);
console.log(`   负面: ${negativeCount} (${negPct}%) | 24h内: ${recentCount} | 历史: ${historyCount}`);
console.log(`   类别:`, byCategory);
