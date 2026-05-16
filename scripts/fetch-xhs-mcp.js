#!/usr/bin/env node
/**
 * 小红书舆情抓取脚本 - 通过 MCP Adapter 直接搜索
 * 替代原来的 fetch-xhs-data.js（从GitHub拉取）
 *
 * 用法: node fetch-xhs-mcp.js [YYYY-MM-DD]
 * 输出: sentiment_monitor/data/xhs-YYYY-MM-DD.json
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const MCP_API_BASE = 'http://127.0.0.1:3000/api';

// 搜索关键词列表（覆盖工行活动、i豆、立减金等）
const SEARCH_KEYWORDS = [
  '工行 升金有礼',
  '工行 i豆',
  '工行 立减金',
  '工商银行 升金礼',
  '工行 资产提升',
  '工行 活动 坑',
  '工行 抽奖 空奖',
  '工行 谢谢参与',
  '工行 心动有礼',
  '工行 i豆乐园',
];

// 过滤条件：标题必须同时包含工行相关词和目标活动词
const ICBC_KEYWORDS = ['工行', '工银', '工商银行', '宇宙行'];
const ACTIVITY_KEYWORDS = ['升金有礼', '升金礼', '资产达标', '资产提升', 'i豆', '立减金', '豆', '心动有礼', 'i豆乐园'];

function isRelevantTitle(title) {
  if (!title) return false;
  const lower = title.toLowerCase();
  const hasIcbc = ICBC_KEYWORDS.some(k => lower.includes(k.toLowerCase()));
  const hasActivity = ACTIVITY_KEYWORDS.some(k => lower.includes(k.toLowerCase()));
  return hasIcbc && hasActivity;
}

// 从 note ID 提取时间戳（前8位hex转unix秒）
function extractDateFromNoteId(noteId) {
  try {
    const hexTs = noteId.substring(0, 8);
    const unixSec = parseInt(hexTs, 16);
    if (!isNaN(unixSec) && unixSec > 1600000000 && unixSec < 2000000000) {
      return new Date(unixSec * 1000);
    }
  } catch (e) {}
  return null;
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

// HTTP GET 请求
function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

// 执行单次搜索
async function searchXhs(keyword) {
  const encoded = encodeURIComponent(keyword);
  const url = `${MCP_API_BASE}/search?keyword=${encoded}`;
  try {
    const result = await httpGet(url);
    if (result.success && result.data && result.data.feeds) {
      return result.data.feeds;
    }
    return [];
  } catch (e) {
    console.error(`❌ 搜索失败 "${keyword}":`, e.message);
    return [];
  }
}

// 主函数
async function main() {
  const dateStr = process.argv[2] || new Date().toISOString().split('T')[0];
  console.log(`📕 小红书舆情抓取 (MCP) : ${dateStr}`);
  console.log('='.repeat(50));

  // 检查MCP adapter状态
  try {
    const health = await httpGet(`${MCP_API_BASE}/health`);
    if (health.status !== 'ok') {
      console.error('❌ MCP adapter 未就绪:', health);
      process.exit(1);
    }
    console.log(`✅ MCP adapter 连接正常 (${health.tools} 个工具)`);
  } catch (e) {
    console.error('❌ 无法连接 MCP adapter (http://127.0.0.1:3000)');
    console.error('   请确认: node /tmp/xiaohongshu-skill/adapter-mcp.js 已启动');
    process.exit(1);
  }

  // 执行所有关键词搜索
  const allFeeds = [];
  const seenIds = new Set();

  for (const keyword of SEARCH_KEYWORDS) {
    console.log(`🔍 搜索: "${keyword}"`);
    const feeds = await searchXhs(keyword);
    console.log(`   → ${feeds.length} 条结果`);

    for (const feed of feeds) {
      // 跳过推荐查询(rec_query)
      if (feed.modelType === 'rec_query') continue;

      const noteId = feed.id;
      if (seenIds.has(noteId)) continue;
      seenIds.add(noteId);

      const card = feed.noteCard || {};
      const title = card.displayTitle || '';
      const user = card.user || {};
      const interact = card.interactInfo || {};

      // 过滤相关性
      if (!isRelevantTitle(title)) {
        continue;
      }

      // 提取发布时间
      const pubDate = extractDateFromNoteId(noteId);
      if (!pubDate) continue;

      allFeeds.push({
        id: noteId,
        xsecToken: feed.xsecToken || '',
        title,
        author: user.nickname || user.nickName || '',
        authorId: user.userId || '',
        likes: parseInt(interact.likedCount) || 0,
        comments: parseInt(interact.commentCount) || 0,
        favorites: parseInt(interact.collectedCount) || 0,
        shares: parseInt(interact.sharedCount) || 0,
        publishTime: formatDate(pubDate),
        fetchTime: dateStr,
        url: `https://www.xiaohongshu.com/explore/${noteId}`,
        source: '小红书',
        sourceType: 'xiaohongshu',
      });
    }

    // 短暂延迟避免请求过快
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n📊 去重后共 ${allFeeds.length} 条相关笔记`);

  // 按点赞数排序
  allFeeds.sort((a, b) => b.likes - a.likes);

  // 保存数据
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const outputPath = path.join(dataDir, `xhs-${dateStr}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(allFeeds, null, 2), 'utf8');
  console.log(`💾 已保存: ${outputPath}`);

  // 同时写入 ym-daily 的 markdown（兼容旧流程）
  const ymDailyDir = '/root/.openclaw/workspace/ym-daily';
  if (fs.existsSync(ymDailyDir)) {
    const mdPath = path.join(ymDailyDir, `xhs-${dateStr}.md`);
    let md = `# 小红书舆情 — ${dateStr}\n\n> 来源：小红书 MCP 实时搜索\n> 采集时间：${dateStr} ${new Date().toTimeString().slice(0, 5)}\n\n`;

    if (allFeeds.length === 0) {
      md += '当日小红书渠道无有效舆情。\n';
    } else {
      allFeeds.forEach((item, i) => {
        md += `### ${i + 1}. ${item.title}\n`;
        md += `- **作者**: ${item.author}\n`;
        md += `- **发布时间**: ${item.publishTime}\n`;
        md += `- **互动**: ${item.likes}赞 / ${item.comments}评 / ${item.favorites}收藏\n`;
        md += `- **链接**: ${item.url}\n\n`;
      });
    }
    fs.writeFileSync(mdPath, md, 'utf8');
    console.log(`📝 Markdown 已保存: ${mdPath}`);
  }

  console.log('\n✅ 小红书舆情抓取完成');
}

main().catch(e => {
  console.error('❌ 脚本异常:', e);
  process.exit(1);
});
