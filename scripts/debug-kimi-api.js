#!/usr/bin/env node
// 调试 Kimi API 调用
const https = require('https');

const API_KEY = process.env.KIMI_API_KEY || process.env.KIMI_PLUGIN_API_KEY;
const API_URL = 'https://api.moonshot.cn/v1/chat/completions';

const prompt = `请判断以下帖子的情感倾向（positive / neutral / negative），只返回一个词：positive / neutral / negative。

标题：工行的立减金真的谁抽谁沉默，转一圈出现谢谢参与😠`;

const body = JSON.stringify({
  model: 'moonshot-v1-8k',
  messages: [{ role: 'user', content: prompt }],
  temperature: 0.1,
  max_tokens: 20
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
    console.log('Status:', res.statusCode);
    console.log('Response:', data);
    try {
      const json = JSON.parse(data);
      console.log('Parsed:', JSON.stringify(json, null, 2));
    } catch (e) {
      console.log('Parse error');
    }
  });
});

req.on('error', e => console.error('Error:', e.message));
req.on('timeout', () => { req.destroy(); console.log('Timeout'); });
req.write(body);
req.end();
