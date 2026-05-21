#!/usr/bin/env node
// 单条调试：测试 Kimi API 对情感判断的响应
const https = require('https');

const API_KEY = 'sk-EUgPbnZS9txUrdvkxKVZRXYIYsxCLRtUgybor8pF2uCkfdMT';
const API_URL = 'https://api.moonshot.cn/v1/chat/completions';

const testCases = [
  { title: '工行的立减金真的谁抽谁沉默，转一圈出现谢谢参与😠', expected: 'negative' },
  { title: '5月！工行11r立减金，可以重复薅！！', expected: 'positive' },
  { title: '5月20日上海工行抽i豆', expected: 'neutral' }
];

async function callLLM(title) {
  const prompt = `请判断以下社交媒体帖子中，作者对工商银行运营活动的情感态度。

判断标准：
- positive：作者语气积极、满意、开心、分享好消息（如"薅到了""抽到立减金""推荐"）
- negative：作者抱怨、不满、愤怒、失望（如"谢谢参与""坑""抠搜""被骗"）
- neutral：客观陈述、信息分享、无情感倾向（如"工行抽i豆""活动更新"）

只返回一个词（positive / neutral / negative），不要解释。

帖子标题：${title}`;

  const body = JSON.stringify({
    model: 'moonshot-v1-8k',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    max_tokens: 50
  });

  return new Promise((resolve, reject) => {
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
        console.log('  [Raw response]', data.slice(0, 500));
        try {
          const json = JSON.parse(data);
          const text = json.choices?.[0]?.message?.content?.trim() || '';
          resolve(text);
        } catch (e) {
          resolve('ERROR: ' + data.slice(0, 100));
        }
      });
    });

    req.on('error', e => resolve('ERROR: ' + e.message));
    req.on('timeout', () => { req.destroy(); resolve('TIMEOUT'); });
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('=== Kimi 情感判断单条调试 ===\n');
  for (const tc of testCases) {
    console.log(`标题: ${tc.title}`);
    console.log(`期望: ${tc.expected}`);
    const result = await callLLM(tc.title);
    console.log(`结果: ${result}`);
    console.log(`匹配: ${result.toLowerCase().includes(tc.expected) ? '✅' : '❌'}`);
    console.log('---');
    await new Promise(r => setTimeout(r, 500));
  }
}

main();
