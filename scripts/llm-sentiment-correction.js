#!/usr/bin/env node
/**
 * llm-sentiment-correction.js
 * 独立脚本：用大模型重新判定舆情情感，与规则结果做对比
 * 用法: node llm-sentiment-correction.js [YYYY-MM-DD] [--batch=N]
 *   - 不传日期则自动取最近3天
 *   - --batch=N 表示一次性传入 N 条让模型批量判断（默认 1）
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const WORKSPACE = '/root/.openclaw/workspace';
const DATA_DIR = path.join(WORKSPACE, 'sentiment_monitor', 'data');
const API_KEY = process.env.LLM_API_KEY || 'sk-EUgPbnZS9txUrdvkxKVZRXYIYsxCLRtUgybor8pF2uCkfdMT';
const API_URL = 'https://api.moonshot.cn/v1/chat/completions';
const MODEL = 'moonshot-v1-8k';

// 如果无 API key，降级为本地规则（仅做结构测试）
const HAS_API = !!API_KEY;

function log(...args) {
  console.log(...args);
}

function getDates() {
  const args = process.argv.slice(2);
  const dates = [];
  for (const a of args) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(a)) dates.push(a);
  }
  if (dates.length === 0) {
    const today = new Date();
    for (let i = 0; i < 3; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      dates.push(formatDate(d));
    }
  }
  return dates;
}

function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function loadRecords(dateStr) {
  const f = path.join(DATA_DIR, `${dateStr}.json`);
  if (!fs.existsSync(f)) return [];
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  return data.records || [];
}

async function callLLMSingle(title, content) {
  if (!HAS_API) {
    // 降级：随机返回（仅测试结构）
    return { sentiment: 'neutral', reason: 'no-api-key' };
  }

  const prompt = `请判断以下社交媒体帖子中，作者对"工商银行运营活动"的情感态度。
重点关注：作者是满意、抱怨、还是客观陈述？
只返回一个JSON对象：{"sentiment":"positive|neutral|negative","reason":"简短原因"}

标题：${title || '无'}
内容：${content || '无'}`;

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 60
    });

    const req = https.request(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 30000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const text = json.choices?.[0]?.message?.content?.trim() || '';
          // 尝试从文本中提取 JSON
          const match = text.match(/\{[^}]*\}/);
          if (match) {
            const parsed = JSON.parse(match[0]);
            resolve({
              sentiment: parsed.sentiment || 'neutral',
              reason: parsed.reason || ''
            });
          } else {
            // 直接匹配 sentiment 词
            const s = text.match(/(positive|neutral|negative)/i);
            resolve({ sentiment: (s?.[0] || 'neutral').toLowerCase(), reason: text.slice(0,50) });
          }
        } catch (e) {
          resolve({ sentiment: 'neutral', reason: 'parse-error: ' + text.slice(0,50) });
        }
      });
    });

    req.on('error', e => resolve({ sentiment: 'neutral', reason: 'api-error: ' + e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ sentiment: 'neutral', reason: 'timeout' }); });
    req.write(body);
    req.end();
  });
}

async function callLLMBatch(records) {
  if (!HAS_API) {
    return records.map(() => ({ sentiment: 'neutral', reason: 'no-api-key' }));
  }

  const items = records.map((r, i) => `Item ${i+1}: title="${r.title||''}" content="${(r.content||'').slice(0,150)}"`).join('\n');
  const prompt = `请逐条判断以下帖子中，作者对工商银行运营活动的情感态度。

判断标准：
- positive：作者语气积极、满意、开心、分享好消息
- negative：作者抱怨、不满、愤怒、失望
- neutral：客观陈述、信息分享、无情感倾向

必须返回严格JSON数组，每个元素包含 sentiment 和 reason：
[{"sentiment":"neutral","reason":"..."}, ...]

${items}`;

  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 200 + records.length * 50
    });

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
          console.log('[LLM raw]', text.slice(0, 400));
          
          // 提取 JSON 数组
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
            // Fallback: 逐行匹配
            const lines = text.split('\n');
            for (let i = 0; i < records.length; i++) {
              const line = lines[i] || '';
              const m = line.match(/(positive|neutral|negative)/i);
              results.push({ sentiment: (m?.[0] || 'neutral').toLowerCase(), reason: line.slice(0,80) });
            }
          }
          resolve(results);
        } catch (e) {
          console.log('[Parse error]', e.message);
          resolve(records.map(() => ({ sentiment: 'neutral', reason: 'parse-error' })));
        }
      });
    });

    req.on('error', e => resolve(records.map(() => ({ sentiment: 'neutral', reason: 'api-error' }))));
    req.on('timeout', () => { req.destroy(); resolve(records.map(() => ({ sentiment: 'neutral', reason: 'timeout' }))); });
    req.write(body);
    req.end();
  });
}

async function main() {
  const dates = getDates();
  log('========================================');
  log('📊 舆情情感对比验证（规则 vs 大模型）');
  log('========================================');
  log('分析日期:', dates.join(', '));
  log('API Key:', HAS_API ? '✅ 已配置' : '❌ 未配置（降级为 neutral）');
  log('');

  let allRecords = [];
  for (const d of dates) {
    const records = loadRecords(d);
    log(`${d}: ${records.length} 条记录`);
    allRecords = allRecords.concat(records.map(r => ({ ...r, _date: d })));
  }

  if (allRecords.length === 0) {
    log('❌ 未找到任何记录');
    process.exit(1);
  }

  log(`\n总计: ${allRecords.length} 条记录\n`);

  // 先展示规则情感分布
  const ruleStats = { positive: 0, neutral: 0, negative: 0 };
  allRecords.forEach(r => { ruleStats[r.sentiment || 'neutral'] = (ruleStats[r.sentiment || 'neutral'] || 0) + 1; });
  log('【规则判定分布】', ruleStats);

  // 批量调用大模型（每次 5 条，减少 API 调用次数）
  const BATCH_SIZE = 5;
  const llmResults = [];
  log(`\n开始调用大模型... 共 ${Math.ceil(allRecords.length / BATCH_SIZE)} 批次`);

  for (let i = 0; i < allRecords.length; i += BATCH_SIZE) {
    const batch = allRecords.slice(i, i + BATCH_SIZE);
    process.stdout.write(`  批次 ${Math.floor(i/BATCH_SIZE)+1}/${Math.ceil(allRecords.length/BATCH_SIZE)} ... `);
    const batchRes = await callLLMBatch(batch);
    batchRes.forEach((res, idx) => {
      llmResults.push({ ...batch[idx], llmSentiment: res.sentiment, llmReason: res.reason });
    });
    process.stdout.write('✅\n');
    // 简单限流，避免触发速率限制
    if (i + BATCH_SIZE < allRecords.length) await new Promise(r => setTimeout(r, 500));
  }

  // 对比统计
  const llmStats = { positive: 0, neutral: 0, negative: 0 };
  let diffCount = 0;
  const diffs = [];

  for (const r of llmResults) {
    llmStats[r.llmSentiment] = (llmStats[r.llmSentiment] || 0) + 1;
    if (r.llmSentiment !== r.sentiment) {
      diffCount++;
      diffs.push(r);
    }
  }

  log('\n========================================');
  log('【大模型判定分布】', llmStats);
  log('【差异统计】', `规则→大模型不一致: ${diffCount}/${allRecords.length} (${(diffCount/allRecords.length*100).toFixed(1)}%)`);
  log('========================================\n');

  if (diffs.length > 0) {
    log('📋 差异明细（规则判定 → 大模型判定）：\n');
    diffs.forEach((r, i) => {
      log(`  ${i+1}. [${r._date}] ${r.source || '?'}`);
      log(`     标题: ${r.title?.slice(0,60) || '无'}`);
      log(`     规则: ${r.sentiment || 'neutral'} → 大模型: ${r.llmSentiment} (${r.llmReason})`);
      log('');
    });
  } else {
    log('✅ 规则与大模型判定完全一致（或 API 未返回有效结果）');
  }

  // 保存结果到文件
  const outDir = path.join(WORKSPACE, 'sentiment_monitor', 'reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `llm-sentiment-compare-${formatDate(new Date())}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    generatedAt: new Date().toISOString(),
    dates,
    totalRecords: allRecords.length,
    ruleStats,
    llmStats,
    diffCount,
    diffPct: (diffCount / allRecords.length * 100).toFixed(1),
    records: llmResults.map(r => ({
      date: r._date,
      source: r.source,
      title: r.title,
      content: (r.content || '').slice(0,200),
      ruleSentiment: r.sentiment,
      llmSentiment: r.llmSentiment,
      llmReason: r.llmReason
    }))
  }, null, 2));
  log(`📁 结果已保存: ${outFile}`);
}

main().catch(e => { console.error(e); process.exit(1); });
