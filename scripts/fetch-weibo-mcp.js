#!/usr/bin/env node
/**
 * 微博舆情抓取脚本 - 通过 MCP Adapter 直接搜索
 * 替代原来的 weibo-search.md 手动流程
 *
 * 用法: node fetch-weibo-mcp.js [YYYY-MM-DD]
 * 输出: sentiment_monitor/data/weibo-YYYY-MM-DD.json
 *       ym-daily/weibo-YYYY-MM-DD.md
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const MCP_API_BASE = 'http://127.0.0.1:4201/api';

// 搜索关键词（微博搜索不支持空格多关键词，用短词）
const SEARCH_KEYWORDS = [
  '升金有礼',
  '工银i豆',
  '工行投诉',
  '工商银行维权',
  '工行活动坑',
  '工行谢谢参与',
  '工行积分清零',
  '工行立减金',
  '心动有礼',
  'i豆乐园',
];

// 过滤词
const ICBC_KEYWORDS = ['工行', '工银', '工商银行', '宇宙行'];
const ACTIVITY_KEYWORDS = ['升金有礼', '升金礼', '资产达标', '资产提升', 'i豆', '立减金', '积分', '投诉', '维权', '坑', '骗', '套路', '谢谢参与', '空奖', '心动有礼', 'i豆乐园'];

function isRelevant(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  const hasIcbc = ICBC_KEYWORDS.some(k => lower.includes(k.toLowerCase()));
  const hasActivity = ACTIVITY_KEYWORDS.some(k => lower.includes(k.toLowerCase()));
  return hasIcbc && hasActivity;
}

// 解析微博日期 "Fri Feb 07 09:50:07 +0800 2025" → "2025-02-07"
function parseWeiboDate(dateStr) {
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
  } catch (e) {}
  return null;
}

// HTTP POST
function httpPost(urlStr, body) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const url = new URL(urlStr);
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    const client = url.protocol === 'https:' ? require('https') : require('http');
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// 执行搜索
async function searchWeibo(keyword, limit = 15) {
  const url = `${MCP_API_BASE}/search`;
  try {
    const result = await httpPost(url, { keyword, limit });
    if (result.success && result.data && result.data.result) {
      return result.data.result;
    }
    return [];
  } catch (e) {
    console.error(`❌ 搜索失败 "${keyword}":`, e.message);
    return [];
  }
}

// 情感推断
function inferSentiment(text) {
  const t = (text || '').toLowerCase();
  const negativeWords = ['投诉', '维权', '虚假宣传', '谢谢参与', '空奖', '骗', '坑', '垃圾', '差', '烂', '套路', '恶心', '失望', '愤怒', '差评', '吐槽', '坑人', '忽悠', '不满', '后悔', '无语', '气死', '黑幕', '曝光', '缩水'];
  const positiveWords = ['好评', '不错', '推荐', '赞', '满意', '给力', '棒', '惊喜', '开心', '羊毛', '攻略', '必中', '中奖', '喜提', '薅'];
  if (negativeWords.some(w => t.includes(w))) return 'negative';
  if (positiveWords.some(w => t.includes(w))) return 'positive';
  return 'neutral';
}

// 主函数
async function main() {
  const dateStr = process.argv[2] || new Date().toISOString().split('T')[0];
  console.log(`🔍 微博舆情抓取 (MCP) : ${dateStr}`);
  console.log('='.repeat(50));

  // 检查MCP状态
  try {
    const health = await new Promise((resolve, reject) => {
      http.get(`${MCP_API_BASE}/health`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
      }).on('error', reject);
    });
    console.log(`✅ 微博 MCP adapter 连接正常 (${health.sessionId})`);
  } catch (e) {
    console.error('❌ 无法连接微博 MCP adapter (http://127.0.0.1:4201)');
    process.exit(1);
  }

  const allPosts = [];
  const seenIds = new Set();

  for (const keyword of SEARCH_KEYWORDS) {
    console.log(`🔍 搜索: "${keyword}"`);
    const posts = await searchWeibo(keyword, 15);
    console.log(`   → ${posts.length} 条结果`);

    for (const post of posts) {
      const id = post.id;
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);

      const text = (post.text || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');

      if (!isRelevant(text)) continue;

      const pubDate = parseWeiboDate(post.created_at);
      if (!pubDate) continue;

      const user = post.user || {};

      allPosts.push({
        id: String(id),
        title: text.substring(0, 60) + (text.length > 60 ? '...' : ''),
        content: text,
        author: user.screen_name || '',
        authorId: String(user.id || ''),
        likes: post.attitudes_count || 0,
        comments: post.comments_count || 0,
        reposts: post.reposts_count || 0,
        publishTime: pubDate,
        fetchTime: dateStr,
        url: `https://weibo.com/${user.id || ''}/${id}`,
        source: user.verified_reason || user.source || '微博',
        sourceType: 'weibo',
        sentiment: inferSentiment(text),
        region: post.region_name || '',
      });
    }

    await new Promise(r => setTimeout(r, 800)); // 避免请求过快
  }

  console.log(`\n📊 去重后共 ${allPosts.length} 条相关微博`);

  // 按点赞数排序
  allPosts.sort((a, b) => b.likes - a.likes);

  // 保存 JSON（追加模式：合并已有数据，去重）
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const jsonPath = path.join(dataDir, `weibo-${dateStr}.json`);

  // 如果已有数据，读取并合并
  let existingPosts = [];
  if (fs.existsSync(jsonPath)) {
    try {
      existingPosts = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      if (!Array.isArray(existingPosts)) existingPosts = [];
      console.log(`📦 已存在 ${existingPosts.length} 条数据，将合并新采集...`);
    } catch (e) {
      console.warn('⚠️ 读取已有数据失败，使用空数据');
      existingPosts = [];
    }
  }

  // 合并并去重（按 id 或 url）
  const mergedMap = new Map();
  for (const p of existingPosts) {
    const key = p.id || p.url || p.title;
    if (key) mergedMap.set(key, p);
  }
  for (const p of allPosts) {
    const key = p.id || p.url || p.title;
    if (key) mergedMap.set(key, p);
  }
  const mergedPosts = Array.from(mergedMap.values());
  mergedPosts.sort((a, b) => (b.likes || 0) - (a.likes || 0));

  fs.writeFileSync(jsonPath, JSON.stringify(mergedPosts, null, 2), 'utf8');
  console.log(`💾 JSON 已保存: ${jsonPath} (共 ${mergedPosts.length} 条，本次新增 ${mergedPosts.length - existingPosts.length} 条)`);

  // 保存 Markdown
  const ymDailyDir = '/root/.openclaw/workspace/ym-daily';
  if (fs.existsSync(ymDailyDir)) {
    const mdPath = path.join(ymDailyDir, `weibo-${dateStr}.md`);
    let md = `# 微博舆情 — ${dateStr}\n\n> 来源：微博 MCP 实时搜索\n> 采集时间：${dateStr} ${new Date().toTimeString().slice(0, 5)}\n\n`;

    if (allPosts.length === 0) {
      md += '当日微博渠道无有效舆情。\n';
    } else {
      allPosts.forEach((item, i) => {
        md += `### ${i + 1}. ${item.title}\n`;
        md += `- **作者**: ${item.author}\n`;
        md += `- **发布时间**: ${item.publishTime}\n`;
        md += `- **互动**: ${item.likes}赞 / ${item.comments}评 / ${item.reposts}转发\n`;
        md += `- **情绪**: ${item.sentiment === 'negative' ? '负面' : item.sentiment === 'positive' ? '正面' : '中性'}\n`;
        md += `- **链接**: ${item.url}\n`;
        if (item.region) md += `- **地区**: ${item.region}\n`;
        md += '\n';
      });
    }
    fs.writeFileSync(mdPath, md, 'utf8');
    console.log(`📝 Markdown 已保存: ${mdPath}`);
  }

  console.log('\n✅ 微博舆情抓取完成');
}

main().catch(e => {
  console.error('❌ 脚本异常:', e);
  process.exit(1);
});
