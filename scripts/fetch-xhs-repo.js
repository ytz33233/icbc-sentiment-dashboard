/**
 * fetch-xhs-from-repo.js
 * 从 GitHub 仓库 ytz33233/xhs_yuqing_data 拉取小红书数据
 * 并转换成 dashboard 所需的看板格式
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { filterBatch } = require('./filter-rules.js');

const REPO_RAW = 'https://raw.githubusercontent.com/ytz33233/xhs_yuqing_data/main/sentiment_monitor';
const DATA_DIR = path.join(__dirname, '..', 'data');
const DAILY_DIR = path.join(__dirname, '..', '..', 'ym-daily');

/**
 * 获取今天日期字符串 YYYY-MM-DD
 */
function getTodayStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * HTTP GET 请求
 */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return httpGet(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject).on('timeout', () => reject(new Error('Request timeout')));
  });
}

/**
 * 下载文件
 */
async function downloadFile(remotePath, localPath) {
  const url = `${REPO_RAW}/${remotePath}`;
  console.log(`[Download] ${url}`);
  const content = await httpGet(url);
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, content);
  console.log(`[Saved] ${localPath} (${content.length} bytes)`);
  return content;
}

/**
 * 转换小红书数据为看板格式
 */
function transformToDashboard(xhsData, dateStr) {
  // 转换记录格式
  let records = (xhsData.records || []).map((r, idx) => {
    // 补充缺失字段
    const recency = '24h内'; // 小红书的都是最新采集的
    const category = detectCategory(r.title, r.content);
    const heatScore = calculateHeatScore(r);
    const keywords = extractKeywords(r.title, r.content);
    
    return {
      ...r,
      id: r.id || `${dateStr.replace(/-/g, '')}-${String(idx + 1).padStart(2, '0')}`,
      date: r.date || r.publishTime || dateStr,
      publishTime: r.publishTime || r.date || dateStr,
      sourceType: 'xiaohongshu', // 明确标记为小红书
      recency,
      category,
      heatScore,
      keywords,
      // 互动数据：优先从 engagement 对象提取，原始字段可能是字符串需转数字
      likes: parseInt((r.engagement && r.engagement.likes) || r.likes || 0, 10),
      comments: parseInt((r.engagement && r.engagement.comments) || r.comments || 0, 10),
      favorites: parseInt((r.engagement && r.engagement.collects) || r.favorites || 0, 10),
      shares: parseInt((r.engagement && r.engagement.shares) || r.shares || 0, 10),
      status: r.status || '未处理',
      amount: r.amount || '-',
      fetchTime: r.fetchTime || dateStr
    };
  });

  // 应用噪音过滤（互助帖、广告、非工行内容）
  const { kept, removed, stats } = filterBatch(records);
  records = kept;
  if (stats.removed > 0) {
    console.log(`[Filter] 过滤噪音: ${stats.removed}条 (${Object.entries(stats.byReason).map(([k,v])=>`${k}:${v}`).join(', ')})`);
  }

  // 计算统计
  const total = records.length;
  const negativeCount = records.filter(r => r.sentiment === 'negative').length;
  const positiveCount = records.filter(r => r.sentiment === 'positive').length;
  const neutralCount = records.filter(r => r.sentiment === 'neutral').length;
  const highRiskCount = records.filter(r => r.riskLevel === 'high').length;

  const bySentiment = { positive: positiveCount, negative: negativeCount, neutral: neutralCount };
  const bySource = { xiaohongshu: total };
  const byRisk = {};
  const byProduct = {};
  const byCategory = {};
  records.forEach(r => {
    byRisk[r.riskLevel] = (byRisk[r.riskLevel] || 0) + 1;
    byProduct[r.relatedProduct || '其他'] = (byProduct[r.relatedProduct || '其他'] || 0) + 1;
    byCategory[r.category || '其他'] = (byCategory[r.category || '其他'] || 0) + 1;
  });

  // 热词
  const kwMap = {};
  records.forEach(r => {
    (r.keywords || []).forEach(kw => {
      if (kw) kwMap[kw] = (kwMap[kw] || 0) + 1;
    });
  });
  const hotKeywords = Object.entries(kwMap)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return {
    reportDate: dateStr,
    generatedAt: `${dateStr} ${new Date().toTimeString().slice(0, 5)}`,
    fromHistory: false,
    source: 'xhs_repo',
    summary: {
      total,
      recentCount: total,
      historyCount: 0,
      negativeCount,
      negativePct: total > 0 ? Math.round((negativeCount / total) * 100) : 0,
      positiveCount,
      neutralCount,
      channelCount: 1,
      highRiskCount
    },
    bySource,
    bySentiment,
    byRisk,
    byProduct,
    byCategory,
    trend7d: [],
    hotKeywords,
    dailyBrief: {
      text: `今日（${dateStr}）采集到 ${total} 条小红书舆情，负面 ${negativeCount} 条，高风险 ${highRiskCount} 条。`,
      date: dateStr,
      generatedAt: new Date().toISOString()
    },
    records
  };
}

/**
 * 检测分类
 */
function detectCategory(title, content) {
  const text = `${title || ''} ${content || ''}`;
  if (/升金有礼|资产提升|资产达标/.test(text)) return '资产达标';
  if (/i豆|i豆乐园|豆豆|积分/.test(text)) return 'i豆兑换';
  if (/立减金|红包|优惠券/.test(text)) return '优惠活动';
  if (/投诉|避雷|失望|垃圾|坑/.test(text)) return '投诉建议';
  return '其他';
}

/**
 * 计算热度分
 */
function calculateHeatScore(r) {
  const likes = r.likes || 0;
  const comments = r.comments || 0;
  const favorites = r.favorites || 0;
  const shares = r.shares || 0;
  // 评论权重最高，因为互动最能反映舆情热度
  return likes + comments * 2 + favorites + shares * 3;
}

/**
 * 提取关键词
 */
function extractKeywords(title, content) {
  const text = `${title || ''} ${content || ''}`;
  const keywords = [];
  if (/工行|工银|工商银行/.test(text)) keywords.push('工行');
  if (/i豆|豆豆/.test(text)) keywords.push('i豆');
  if (/升金有礼|资产提升|资产达标/.test(text)) keywords.push('升金有礼');
  if (/立减金/.test(text)) keywords.push('立减金');
  if (/投诉|避雷/.test(text)) keywords.push('投诉');
  if (/互助|搭子/.test(text)) keywords.push('互助');
  return keywords;
}

/**
 * 生成 Markdown 报告
 */
function generateMarkdown(dashboardData, dateStr) {
  const { summary, records } = dashboardData;
  let md = `# 小红书舆情 — ${dateStr}

> 来源：ytz33233/xhs_yuqing_data（小红书实时采集）
> 采集时间：${dashboardData.generatedAt}

## 统计概览

| 指标 | 数值 |
|------|------|
| 总数 | ${summary.total} |
| 负面 | ${summary.negativeCount} (${summary.negativePct}%) |
| 高风险 | ${summary.highRiskCount} |
| 来源 | 小红书 |

## 舆情列表

`;

  records.forEach((r, i) => {
    const sentimentEmoji = r.sentiment === 'negative' ? '🔴' : r.sentiment === 'positive' ? '🟢' : '⚪';
    const riskEmoji = r.riskLevel === 'high' ? '🔥' : '';
    md += `### ${i + 1}. ${sentimentEmoji}${riskEmoji} ${r.title}\n`;
    md += `- **作者**: ${r.author}\n`;
    md += `- **发布时间**: ${r.publishTime}\n`;
    md += `- **情感**: ${r.sentiment} | **风险**: ${r.riskLevel}\n`;
    md += `- **分类**: ${r.category}\n`;
    md += `- **互动**: ${r.likes}赞 / ${r.comments}评 / ${r.favorites}收藏\n`;
    md += `- **链接**: ${r.url}\n\n`;
  });

  return md;
}

/**
 * 主流程
 */
async function main() {
  const dateStr = process.argv[2] || getTodayStr();
  console.log(`[XHS Repo] 拉取 ${dateStr} 数据...`);

  try {
    // 1. 下载数据文件
    const remotePath = `data/${dateStr}.json`;
    const localJsonPath = path.join(DATA_DIR, `xhs-${dateStr}.json`);
    
    let xhsData;
    try {
      const content = await downloadFile(remotePath, localJsonPath);
      xhsData = JSON.parse(content);
    } catch (e) {
      console.error(`[Error] 下载失败: ${e.message}`);
      // 尝试下载 Markdown 版本作为备选
      try {
        const mdPath = `daily/${dateStr}.md`;
        const localMdPath = path.join(DAILY_DIR, `xhs-${dateStr}.md`);
        await downloadFile(mdPath, localMdPath);
        console.log(`[Fallback] 已下载 Markdown 版本`);
      } catch (e2) {
        console.error(`[Error] Markdown 也下载失败: ${e2.message}`);
      }
      return;
    }

    // 2. 转换为看板格式
    const dashboardData = transformToDashboard(xhsData, dateStr);
    
    // 3. 保存看板数据
    const dashboardPath = path.join(DATA_DIR, `${dateStr}-xhs.json`);
    fs.writeFileSync(dashboardPath, JSON.stringify(dashboardData, null, 2));
    console.log(`[Dashboard] 已保存: ${dashboardPath}`);

    // 4. 生成 Markdown 报告
    const mdContent = generateMarkdown(dashboardData, dateStr);
    const mdPath = path.join(DAILY_DIR, `xhs-${dateStr}.md`);
    fs.mkdirSync(path.dirname(mdPath), { recursive: true });
    fs.writeFileSync(mdPath, mdContent);
    console.log(`[Report] 已保存: ${mdPath}`);

    console.log(`\n✅ 小红书数据采集完成！`);
    console.log(`   记录数: ${dashboardData.summary.total}`);
    console.log(`   负面: ${dashboardData.summary.negativeCount}`);
    console.log(`   高风险: ${dashboardData.summary.highRiskCount}`);

  } catch (err) {
    console.error(`[Fatal] ${err.message}`);
    process.exit(1);
  }
}

main();
