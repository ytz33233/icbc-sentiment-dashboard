#!/usr/bin/env node
/**
 * llm-sentiment-enhance.js
 * 混合策略情感增强脚本：规则 + 大模型协同判定
 * 
 * 策略逻辑：
 * - 规则判定 negative → 保留（规则对"谢谢参与"等负面关键词敏感）
 * - 规则判定 positive/neutral → 采用大模型结果（大模型对语气、表情、上下文理解更好）
 * 
 * 用法: node llm-sentiment-enhance.js [YYYY-MM-DD]
 *   - 不传日期则自动取当天
 * 
 * 接入方式：在 run-daily-sentiment.sh 中，generate-dashboard-data.js 之后调用
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const WORKSPACE = '/root/.openclaw/workspace';
const DATA_DIR = path.join(WORKSPACE, 'sentiment_monitor', 'data');
const API_KEY = process.env.LLM_API_KEY || 'sk-0274e33f7183414ca3d9c751ae310a05';
const API_URL = 'https://api.deepseek.com/v1/chat/completions';
const MODEL = 'deepseek-chat';
const BATCH_SIZE = 5;

function getTargetDate() {
  const args = process.argv.slice(2);
  for (const a of args) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(a)) return a;
  }
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function log(...args) {
  console.log(...args);
}

async function callLLMBatch(records) {
  const items = records.map((r, i) => 
    `Item ${i+1}: title="${r.title||''}" content="${(r.content||'').slice(0,150)}"`
  ).join('\n');
  
  const prompt = `请逐条判断以下帖子中，作者对工商银行运营活动的情感态度。

判断标准：
- positive：作者语气积极、满意、开心、分享好消息
- negative：作者抱怨、不满、愤怒、失望（注意表情符号如😓😠😡也表达不满）
- neutral：客观陈述、信息分享、无情感倾向

必须返回严格JSON数组：
[{"sentiment":"neutral","reason":"..."}, ...]

${items}`;

  const body = JSON.stringify({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    max_tokens: 200 + records.length * 50
  });

  return new Promise((resolve) => {
    const req = https.request(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 60000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const text = json.choices?.[0]?.message?.content?.trim() || '';
          const arrayMatch = text.match(/\[[\s\S]*\]/);
          let results = [];
          if (arrayMatch) {
            const arr = JSON.parse(arrayMatch[0]);
            for (let i = 0; i < records.length; i++) {
              const item = arr[i] || {};
              const sentiment = (item.sentiment || '').toLowerCase();
              results.push({
                sentiment: ['positive','neutral','negative'].includes(sentiment) ? sentiment : 'neutral',
                reason: item.reason || ''
              });
            }
          } else {
            // Fallback
            const lines = text.split('\n');
            for (let i = 0; i < records.length; i++) {
              const line = lines[i] || '';
              const m = line.match(/(positive|neutral|negative)/i);
              results.push({ sentiment: (m?.[0] || 'neutral').toLowerCase(), reason: line.slice(0,80) });
            }
          }
          resolve(results);
        } catch (e) {
          log('[LLM Parse Error]', e.message);
          resolve(records.map(() => ({ sentiment: 'neutral', reason: 'parse-error' })));
        }
      });
    });

    req.on('error', e => {
      log('[LLM API Error]', e.message);
      resolve(records.map(() => ({ sentiment: 'neutral', reason: 'api-error' })));
    });
    req.on('timeout', () => { 
      req.destroy(); 
      resolve(records.map(() => ({ sentiment: 'neutral', reason: 'timeout' })));
    });
    req.write(body);
    req.end();
  });
}

async function main() {
  const dateStr = getTargetDate();
  const filePath = path.join(DATA_DIR, `${dateStr}.json`);
  
  if (!fs.existsSync(filePath)) {
    log(`❌ 文件不存在: ${filePath}`);
    process.exit(1);
  }

  log('========================================');
  log('🧠 LLM 情感增强（混合策略）');
  log('========================================');
  log('日期:', dateStr);
  
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const records = data.records || [];
  
  if (records.length === 0) {
    log('⚠️  无记录需要处理');
    process.exit(0);
  }

  log(`总记录: ${records.length} 条`);

  // 分类：negative 保留规则，positive/neutral 调大模型
  const ruleNegative = records.filter(r => r.sentiment === 'negative');
  const toEnhance = records.filter(r => r.sentiment !== 'negative');
  
  log(`规则判定 negative: ${ruleNegative.length} 条（保留）`);
  log(`需要大模型增强: ${toEnhance.length} 条`);

  let llmResults = [];
  
  if (toEnhance.length > 0) {
    log(`\n开始调用大模型... 共 ${Math.ceil(toEnhance.length / BATCH_SIZE)} 批次`);
    
    for (let i = 0; i < toEnhance.length; i += BATCH_SIZE) {
      const batch = toEnhance.slice(i, i + BATCH_SIZE);
      process.stdout.write(`  批次 ${Math.floor(i/BATCH_SIZE)+1}/${Math.ceil(toEnhance.length/BATCH_SIZE)} ... `);
      const batchRes = await callLLMBatch(batch);
      batchRes.forEach((res, idx) => {
        llmResults.push({ ...batch[idx], llmSentiment: res.sentiment, llmReason: res.reason });
      });
      process.stdout.write('✅\n');
      if (i + BATCH_SIZE < toEnhance.length) await new Promise(r => setTimeout(r, 500));
    }
  }

  // 合并结果
  const enhancedRecords = [
    ...ruleNegative.map(r => ({ ...r, sentimentMethod: 'rule-negative' })),
    ...llmResults.map(r => ({ 
      ...r, 
      sentiment: r.llmSentiment,
      sentimentMethod: 'llm' 
    }))
  ];

  // 统计对比
  const beforeStats = { positive: 0, neutral: 0, negative: 0 };
  const afterStats = { positive: 0, neutral: 0, negative: 0 };
  records.forEach(r => { beforeStats[r.sentiment || 'neutral']++; });
  enhancedRecords.forEach(r => { afterStats[r.sentiment || 'neutral']++; });

  log('\n========================================');
  log('【情感分布对比】');
  log('  规则判定:', beforeStats);
  log('  混合策略:', afterStats);
  
  const diffCount = records.filter((r, i) => r.sentiment !== enhancedRecords[i].sentiment).length;
  log(`  变化数: ${diffCount}/${records.length}`);
  log('========================================\n');

  // 更新数据
  data.records = enhancedRecords;
  data.summary.negativeCount = afterStats.negative;
  data.summary.positiveCount = afterStats.positive;
  data.summary.neutralCount = afterStats.neutral;
  data.summary.negativePct = records.length > 0 ? (afterStats.negative / records.length * 100).toFixed(1) : '0.0';
  
  // 更新 bySentiment
  data.bySentiment = { 
    positive: afterStats.positive, 
    neutral: afterStats.neutral, 
    negative: afterStats.negative 
  };
  
  // 标记增强时间
  data.llmEnhancedAt = new Date().toISOString();
  data.llmEnhancedMethod = 'rule-negative-preserved + llm-for-others';

  // 写回文件
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  log(`✅ 已保存: ${filePath}`);

  // 同时保存对比报告
  const reportDir = path.join(WORKSPACE, 'sentiment_monitor', 'reports');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  
  const changes = records.map((r, i) => ({
    title: r.title,
    before: r.sentiment,
    after: enhancedRecords[i].sentiment,
    method: enhancedRecords[i].sentimentMethod,
    reason: enhancedRecords[i].llmReason || ''
  })).filter(c => c.before !== c.after);

  const report = {
    date: dateStr,
    generatedAt: new Date().toISOString(),
    totalRecords: records.length,
    beforeStats,
    afterStats,
    diffCount: changes.length,
    changes: changes
  };
  
  const reportPath = path.join(reportDir, `sentiment-enhance-${dateStr}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  log(`📁 对比报告: ${reportPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
