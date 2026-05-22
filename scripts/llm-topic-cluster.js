const https = require('https');

const API_KEY = process.env.LLM_API_KEY || 'sk-EUgPbnZS9txUrdvkxKVZRXYIYsxCLRtUgybor8pF2uCkfdMT';
const API_URL = 'https://api.moonshot.cn/v1/chat/completions';
const MODEL = 'moonshot-v1-8k';

function log(...args) {
  console.log(...args);
}

async function callLLMTopicCluster(records) {
  if (records.length === 0) {
    return { topics: [] };
  }

  const items = records.map((r, i) =>
    `Index ${i}: [${r.sourceType || r.source || 'unknown'}] "${(r.title || '').slice(0, 80)}" sentiment=${r.sentiment || 'neutral'} heat=${r.heatScore || 0}`
  ).join('\n');

  const prompt = `请分析以下社交媒体帖子，将它们按讨论话题进行聚类分组。每个帖子已经标注了来源、标题、情感和热度。

聚类要求：
- 语义相似的帖子归为同一话题（比如"工行答题"和"519工行答题"是同一话题）
- 话题名称要简洁、明确（10字以内）
- 每个话题给出简短描述（20字以内）
- 按帖子索引号（Index）归入对应话题

帖子列表：
${items}

必须返回严格JSON格式：
{
  "topics": [
    {
      "topic": "话题名称",
      "summary": "简短描述",
      "postIndices": [0, 2, 5],
      "keywords": ["关键词1", "关键词2"],
      "sentiment": {"positive": 2, "neutral": 1, "negative": 0}
    }
  ]
}

注意：
- postIndices 使用帖子的 Index 编号
- 不要遗漏任何帖子，尽量把所有帖子都归入某个话题
- 如果某条帖子无法归入已有话题，可以单独成为一个话题
- 话题数量建议 3-8 个`;

  const body = JSON.stringify({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    max_tokens: 2000
  });

  return new Promise((resolve) => {
    const req = https.request(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 120000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const text = json.choices?.[0]?.message?.content?.trim() || '';
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            resolve(result);
          } else {
            resolve({ topics: [] });
          }
        } catch (e) {
          log('[LLM Topic Error]', e.message);
          resolve({ topics: [] });
        }
      });
    });

    req.on('error', e => {
      log('[LLM Topic API Error]', e.message);
      resolve({ topics: [] });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ topics: [] });
    });
    req.write(body);
    req.end();
  });
}

/**
 * LLM 语义话题聚类
 * 返回 enriched topics（含统计信息）
 */
async function topicCluster(records) {
  if (records.length === 0) {
    return { topics: [], stats: { totalTopics: 0, totalPosts: 0 } };
  }

  log('\n========================================');
  log('🔥 LLM 语义话题聚类');
  log('========================================');
  log(`输入: ${records.length} 条`);

  const startTime = Date.now();
  const llmResult = await callLLMTopicCluster(records);

  // 丰富话题信息：补全 heat、sources 等统计
  const topics = (llmResult.topics || []).map(t => {
    const postIndices = t.postIndices || [];
    const posts = postIndices.map(idx => records[idx]).filter(Boolean);

    const totalHeat = posts.reduce((sum, p) => sum + (p.heatScore || 0), 0);
    const sources = {};
    posts.forEach(p => {
      const src = p.sourceType || p.source || 'unknown';
      sources[src] = (sources[src] || 0) + 1;
    });

    // 校验 sentiment 与帖子实际情感
    const actualSentiment = { positive: 0, neutral: 0, negative: 0 };
    posts.forEach(p => {
      const s = p.sentiment || 'neutral';
      if (actualSentiment[s] !== undefined) actualSentiment[s]++;
    });

    return {
      topic: t.topic || '未命名话题',
      summary: t.summary || '',
      postCount: posts.length,
      postIndices: postIndices,
      keywords: t.keywords || [],
      sentiment: actualSentiment,
      sources,
      totalHeat,
      // 代表性帖子（热度最高的3条）
      topPosts: posts
        .sort((a, b) => (b.heatScore || 0) - (a.heatScore || 0))
        .slice(0, 3)
        .map(p => ({ id: p.id, title: p.title, heatScore: p.heatScore, sentiment: p.sentiment }))
    };
  }).filter(t => t.postCount > 0);

  // 按总热度排序
  topics.sort((a, b) => b.totalHeat - a.totalHeat);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  log('========================================');
  log('【话题聚类完成】');
  log(`  耗时: ${elapsed}s`);
  log(`  话题数: ${topics.length}`);
  topics.forEach((t, i) => {
    const sent = `+${t.sentiment.positive}/=${t.sentiment.neutral}/-${t.sentiment.negative}`;
    log(`  ${i + 1}. ${t.topic} (${t.postCount}条, 热度${t.totalHeat}, ${sent})`);
  });
  log('========================================\n');

  return {
    topics,
    stats: { totalTopics: topics.length, totalPosts: records.length, elapsed }
  };
}

module.exports = { topicCluster };

// CLI 模式
if (require.main === module) {
  const fs = require('fs');
  const path = require('path');

  const dateStr = process.argv[2] || new Date().toISOString().slice(0, 10);
  const dataFile = path.join('/root/.openclaw/workspace/sentiment_monitor/data', `${dateStr}.json`);

  if (!fs.existsSync(dataFile)) {
    log(`❌ 文件不存在: ${dataFile}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  topicCluster(data.records || []).then(result => {
    data.hotTopics = result.topics;
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
    log(`✅ 已保存话题聚类: ${dataFile}`);
  }).catch(e => {
    console.error(e);
    process.exit(1);
  });
}
