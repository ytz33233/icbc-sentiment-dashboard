const https = require('https');

const API_KEY = process.env.LLM_API_KEY || 'sk-EUgPbnZS9txUrdvkxKVZRXYIYsxCLRtUgybor8pF2uCkfdMT';
const API_URL = 'https://api.moonshot.cn/v1/chat/completions';
const MODEL = 'moonshot-v1-8k';
const BATCH_SIZE = 5;

function log(...args) {
  console.log(...args);
}

async function callLLMBatch(records) {
  const items = records.map((r, i) => 
    `Item ${i+1}: title="${r.title||''}" content="${(r.content||'').slice(0,200)}" source="${r.source||''}"`
  ).join('\n\n');
  
  const prompt = `请逐条判断以下社交媒体帖子，是否应该保留到"工商银行舆情监测看板"中。

判断标准：
- 保留：与工行活动相关（升金有礼、i豆、立减金、抽奖、资产达标、任务中心攻略等），或用户对工行服务的真实反馈（投诉、好评、中奖分享、使用体验）
- 丢弃：互助帖（互点互赞求关注组队）、广告营销、其他银行内容、员工日常吐槽（非活动相关）、与工行无关的闲聊

注意：
- "攻略分享"类（如"工行任务中心攻略""工行i豆兑换方法"）属于活动相关，保留
- "中奖分享"类（如"抽到2000工银i豆""工行立减金到手"）属于活动相关，保留
- "用户吐槽/投诉"类（如"工行谢谢参与是空奖""虚假宣传"）属于真实反馈，保留
- "互助帖"（互点、互赞、求关注、组队、搭子、互助）→ 丢弃
- "广告营销"（推广、代运营、接单、商务合作）→ 丢弃
- 明显是其他银行（不含工行/工银/工商银行关键词）的内容 → 丢弃
- 员工日常吐槽（打工人、辞职、出道等，非活动相关）→ 丢弃

必须返回严格JSON数组：
[{"keep":true/false,"reason":"简短原因","isNoise":true/false,"noiseType":null或"互助帖"/"广告"/"无关银行"/"非活动闲聊"/"员工吐槽"}, ...]

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
              results.push({
                keep: item.keep !== false,
                reason: item.reason || '',
                isNoise: item.isNoise === true,
                noiseType: item.noiseType || null
              });
            }
          } else {
            results = records.map(() => ({ keep: true, reason: 'parse-error', isNoise: false, noiseType: null }));
          }
          resolve(results);
        } catch (e) {
          log('[LLM Semantic Error]', e.message);
          resolve(records.map(() => ({ keep: true, reason: 'error', isNoise: false, noiseType: null })));
        }
      });
    });

    req.on('error', e => {
      log('[LLM Semantic API Error]', e.message);
      resolve(records.map(() => ({ keep: true, reason: 'api-error', isNoise: false, noiseType: null })));
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(records.map(() => ({ keep: true, reason: 'timeout', isNoise: false, noiseType: null })));
    });
    req.write(body);
    req.end();
  });
}

/**
 * LLM 语义处理：噪音过滤 + 活动筛选
 * 替代 generate-dashboard-data.js 中的 filterBatch + isActivityRelated
 */
async function semanticProcess(records) {
  if (records.length === 0) {
    return { kept: [], removed: [], stats: { total: 0, kept: 0, removed: 0 } };
  }

  log('\n========================================');
  log('🧠 LLM 语义处理（噪音过滤 + 活动筛选）');
  log('========================================');
  log(`输入: ${records.length} 条`);

  const startTime = Date.now();
  const kept = [];
  const removed = [];

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    process.stdout.write(`  批次 ${Math.floor(i/BATCH_SIZE)+1}/${Math.ceil(records.length/BATCH_SIZE)} ... `);
    
    const results = await callLLMBatch(batch);
    
    batch.forEach((r, idx) => {
      const res = results[idx];
      if (res.keep) {
        kept.push(r);
      } else {
        removed.push({ ...r, _filtered: true, _filterReason: res.reason, _filterMethod: 'llm-semantic', _noiseType: res.noiseType });
      }
    });
    
    process.stdout.write('✅\n');
    if (i + BATCH_SIZE < records.length) await new Promise(r => setTimeout(r, 500));
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  
  log('========================================');
  log('【语义处理完成】');
  log(`  耗时: ${elapsed}s`);
  log(`  保留: ${kept.length} 条`);
  log(`  移除: ${removed.length} 条`);
  log('========================================\n');

  return {
    kept,
    removed,
    stats: { total: records.length, kept: kept.length, removed: removed.length, elapsed }
  };
}

module.exports = { semanticProcess };

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
  semanticProcess(data.records || []).then(result => {
    data.records = result.kept;
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
    log(`✅ 已保存: ${dataFile}`);
  }).catch(e => {
    console.error(e);
    process.exit(1);
  });
}
