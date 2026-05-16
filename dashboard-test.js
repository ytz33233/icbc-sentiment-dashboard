const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, 'dashboard.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// 提取 <script> 内容
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('❌ 未找到 <script> 标签'); process.exit(1); }

// 将 const/let 替换为 var，使变量成为 eval 所在作用域的全局
const script = m[1].replace(/\bconst\b/g, 'var').replace(/\blet\b/g, 'var');

// Mock document for Node.js eval
global.document = {
  getElementById: (id) => ({
    addEventListener: () => {},
    classList: { add: () => {}, remove: () => {} },
    textContent: '',
    innerHTML: '',
    value: '',
    style: {}
  }),
  addEventListener: () => {},
  querySelectorAll: () => []
};

// Mock window
global.window = { open: () => {} };

eval(script);

// ────────────── 测试用例 ──────────────

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else      { fail++; console.log(`  ❌ ${msg}`); }
}

console.log('\n📋 测试 CONFIG 对象');
assert(typeof CONFIG !== 'undefined', 'CONFIG 全局对象已定义');
assert(CONFIG.dataDir === 'data/', 'dataDir 正确');
assert(CONFIG.pageSize === 10, 'pageSize 正确');
assert(CONFIG.labels.source.xiaohongshu === '小红书', 'xiaohongshu 标签映射存在');
assert(CONFIG.colors.source.xiaohongshu === '#ff2442', 'xiaohongshu 颜色映射存在');
assert(CONFIG.labels.sentiment.negative === '负面', 'sentiment 标签映射正确');

console.log('\n📋 测试 fallbackData 完整性');
assert(typeof fallbackData !== 'undefined', 'fallbackData 已定义');
assert(Array.isArray(fallbackData.records), 'fallbackData.records 是数组');
assert(fallbackData.records.length > 0, `fallbackData.records 非空 (实际=${fallbackData.records.length})`);
assert(Array.isArray(fallbackData.hotKeywords), 'fallbackData.hotKeywords 是数组');
assert(fallbackData.hotKeywords.length > 0, `fallbackData.hotKeywords 非空 (实际=${fallbackData.hotKeywords.length})`);
assert(fallbackData.summary && fallbackData.summary.total > 0, 'fallbackData.summary.total > 0');

console.log('\n📋 测试 computeTrend（date 匹配）');
const today = '2026-05-11';
const weekAgo = '2026-05-04';
const testRecords = [
  { id: '1', date: '2026-05-11', sentiment: 'negative', recency: '24h内' },
  { id: '2', date: '2026-05-10', sentiment: 'neutral', recency: '历史' },
  { id: '3', date: '2026-05-11', sentiment: 'positive', recency: '24h内' },
];
const trend = computeTrend(testRecords, weekAgo, today);
assert(trend.length === 8, `趋势返回8天数据 (实际=${trend.length})`);
const todayTrend = trend.find(t => t.date === '2026-05-11');
assert(todayTrend && todayTrend.total === 2, `今天有2条 (date=2026-05-11) (实际=${todayTrend?.total})`);
const yesterdayTrend = trend.find(t => t.date === '2026-05-10');
assert(yesterdayTrend && yesterdayTrend.total === 1, `昨天有1条 (date=2026-05-10) (实际=${yesterdayTrend?.total})`);

console.log('\n📋 测试分页函数');
assert(typeof goToPage === 'function', 'goToPage 函数存在');
assert(typeof changePage === 'function', 'changePage 函数存在');

// 模拟分页场景
filteredData = new Array(25).fill({});
currentPage = 1;
goToPage(2);
assert(currentPage === 2, 'goToPage(2) 正确跳转');
changePage(1);
assert(currentPage === 3, 'changePage(1) 正确前进');
changePage(-1);
assert(currentPage === 2, 'changePage(-1) 正确后退');

console.log('\n📋 测试排序函数');
assert(typeof sortTable === 'function', 'sortTable 函数存在');

// 模拟排序场景
sortState = { field: null, order: 'desc' };
filteredData = [
  { id: '1', sentiment: 'positive', date: '2026-05-09' },
  { id: '2', sentiment: 'negative', date: '2026-05-11' },
  { id: '3', sentiment: 'neutral', date: '2026-05-10' },
];
sortTable('sentiment');
assert(sortState.field === 'sentiment', 'sortTable 设置字段');
// 默认排序：负面 > 中性 > 正面
assert(sortState.order === 'desc', '默认情感排序为 desc（负面在前）');

console.log('\n📋 测试筛选函数');
assert(typeof applyFilters === 'function', 'applyFilters 函数存在');
assert(typeof resetFilters === 'function', 'resetFilters 函数存在');

console.log('\n📋 测试详情弹窗');
assert(typeof showDetail === 'function', 'showDetail 函数存在');
assert(typeof closeModal === 'function', 'closeModal 函数存在');

console.log('\n📋 测试表格列数');
const thMatches = html.match(/<thead>[\s\S]*?<\/thead>/);
const thCount = thMatches ? (thMatches[0].match(/<th[\s>]/g) || []).length : 0;
assert(thCount === 8, `表格应为8列（时间、来源、类别、热度、情感、内容、关键词、操作） (实际=${thCount})`);

console.log('\n📋 测试类别筛选器');
assert(html.includes('id="filter-category"'), '类别筛选器应存在');
assert(html.includes('id="mobile-filter-category"'), '移动端类别筛选器应存在');

console.log('\n📋 测试热度排序');
sortState = { field: null, order: 'desc' };
filteredData = [
  { id: '1', sentiment: 'positive', date: '2026-05-09', heatScore: 50 },
  { id: '2', sentiment: 'negative', date: '2026-05-11', heatScore: 200 },
  { id: '3', sentiment: 'neutral', date: '2026-05-10', heatScore: 100 },
];
sortTable('heatScore');
assert(sortState.field === 'heatScore', 'sortTable 支持 heatScore 字段');
assert(sortState.order === 'desc', '热度默认降序');

console.log('\n📋 测试数据来源脚本存在');
const scriptsDir = path.join(__dirname, 'scripts');
assert(fs.existsSync(path.join(scriptsDir, 'generate-dashboard-data.js')), 'generate-dashboard-data.js 存在');
assert(fs.existsSync(path.join(scriptsDir, 'update-fallback.js')), 'update-fallback.js 存在');
assert(fs.existsSync(path.join(scriptsDir, 'fetch-xhs-data.js')), 'fetch-xhs-data.js 存在');

console.log('\n📋 测试 fallbackData 新字段');
const fb = fallbackData;
assert(typeof fb.byCategory === 'object', 'fallbackData.byCategory 存在');
assert(fb.records.length > 0, 'fallbackData.records 非空');
const firstRecord = fb.records[0];
assert(typeof firstRecord.heatScore === 'number', '记录包含 heatScore');
assert(typeof firstRecord.category === 'string', '记录包含 category');
assert(typeof firstRecord.likes === 'number', '记录包含 likes');
assert(typeof firstRecord.comments === 'number', '记录包含 comments');
assert(typeof firstRecord.favorites === 'number', '记录包含 favorites');

console.log('\n📋 测试关键词趋势函数');
assert(typeof computeKeywordTrend === 'function', 'computeKeywordTrend 函数存在');
assert(typeof showKeywordTrend === 'function', 'showKeywordTrend 函数存在');
assert(typeof renderKeywordTrendChart === 'function', 'renderKeywordTrendChart 函数存在');

const kwTestRecords = [
  { id: '1', date: '2026-05-09', keywords: ['工行', '积分'] },
  { id: '2', date: '2026-05-09', keywords: ['工行'] },
  { id: '3', date: '2026-05-10', keywords: ['工行', '立减金'] },
  { id: '4', date: '2026-05-11', keywords: ['积分'] },
  { id: '5', date: '2026-05-12', keywords: ['工行', '积分', '立减金'] },
];
const kwTrend = computeKeywordTrend('工行', kwTestRecords);
assert(kwTrend.length === 4, `关键词趋势返回4天数据 (实际=${kwTrend.length})`);
assert(kwTrend[0].date === '2026-05-09' && kwTrend[0].count === 2, '5-09 出现2次');
assert(kwTrend[1].date === '2026-05-10' && kwTrend[1].count === 1, '5-10 出现1次');
assert(kwTrend[2].date === '2026-05-11' && kwTrend[2].count === 0, '5-11 出现0次');
assert(kwTrend[3].date === '2026-05-12' && kwTrend[3].count === 1, '5-12 出现1次');

const kwTrend2 = computeKeywordTrend('不存在', kwTestRecords);
assert(kwTrend2.length === 0, '不存在的词返回空数组');

// ────────────── 结果 ──────────────
console.log(`\n${'='.repeat(40)}`);
console.log(`📊 测试完成: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
console.log('🎉 全部通过！');
