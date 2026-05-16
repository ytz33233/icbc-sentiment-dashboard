#!/usr/bin/env node
/**
 * fetch-weibo-data.js (v2)
 * 微博舆情数据采集脚本（微博 MCP 版本）
 * 通过本地 MCP Adapter 采集微博搜索数据
 * 
 * 用法: node fetch-weibo-data.js [YYYY-MM-DD]
 * 输出: ym-daily/weibo-YYYY-MM-DD.json
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

// 自动适配工作目录：优先使用环境变量，其次检测当前路径
const WORKSPACE = process.env.WORKSPACE || (() => {
    const cwd = process.cwd().replace(/\\/g, '/');
    // 如果在 sentiment_monitor 目录内，使用上级目录
    if (cwd.includes('sentiment_monitor')) {
        return path.resolve(cwd, '..').replace(/\\/g, '/');
    }
    return cwd;
})();

const DAILY_DIR = path.join(WORKSPACE, 'ym-daily');
const ADAPTER_URL = process.env.WEIBO_ADAPTER_URL || 'http://127.0.0.1:4201';

const WEIBO_KEYWORDS = [
    '工行 升金有礼',
    '工银i豆',
    '工行 i豆活动',
    '工行 心动有礼',
    '工行 i豆乐园',
    '工行 升金有礼 投诉',
    '工行 i豆 投诉',
    '工行 活动 虚假宣传',
    '工行 谢谢参与',
    '工行 积分 清零'
];

function formatDate(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function getTodayBeijing() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const beijing = new Date(utc + (3600000 * 8));
    return formatDate(beijing);
}

async function searchWeibo(keyword, limit = 10) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({ keyword, limit });
        const url = new URL(ADAPTER_URL);
        const options = {
            hostname: url.hostname,
            port: url.port || 80,
            path: '/api/search',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.success && parsed.data && Array.isArray(parsed.data.result)) {
                        resolve(parsed.data.result);
                    } else {
                        resolve([]);
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

async function main() {
    const dateStr = process.argv[2] || getTodayBeijing();
    
    console.log(`\n📱 微博舆情采集 (MCP 版本): ${dateStr}`);
    console.log('='.repeat(60));
    console.log(`   工作目录: ${WORKSPACE}`);
    console.log(`   Adapter:  ${ADAPTER_URL}`);
    
    // 检查 MCP Adapter 状态
    try {
        await new Promise((resolve, reject) => {
            const url = new URL(ADAPTER_URL + '/health');
            http.get(url, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.status === 'ok') {
                            console.log(`✅ MCP Adapter 正常: ${ADAPTER_URL}`);
                            resolve();
                        } else {
                            reject(new Error('MCP Adapter 未就绪'));
                        }
                    } catch (e) {
                        reject(e);
                    }
                });
            }).on('error', reject);
        });
    } catch (e) {
        console.error(`❌ MCP Adapter 连接失败: ${e.message}`);
        console.log('请确保微博 MCP 服务已启动:');
        console.log('  cd /root/.openclaw/workspace/skills/mcp-server-weibo && . .venv/bin/activate && mcp-server-weibo http');
        console.log('  cd /root/.openclaw/workspace/skills/xiaohongshu-mcp && node weibo-mcp-adapter.js');
        process.exit(1);
    }

    const allResults = [];
    const keywordResults = {};

    for (const keyword of WEIBO_KEYWORDS) {
        try {
            console.log(`\n🔍 搜索: ${keyword}`);
            const results = await searchWeibo(keyword, 5);
            console.log(`   获取 ${results.length} 条结果`);
            
            const processed = results.map(r => ({
                id: String(r.id || ''),
                text: r.text || '',
                user: r.user ? r.user.screen_name : '',
                user_id: r.user ? String(r.user.id) : '',
                likes: r.attitudes_count || 0,
                comments: r.comments_count || 0,
                reposts: r.reposts_count || 0,
                created_at: r.created_at || '',
                source_type: r.source || '',
                region: r.region_name || '',
                keyword: keyword,
                url: r.user && r.user.profile_url ? r.user.profile_url : ''
            }));

            keywordResults[keyword] = processed;
            allResults.push(...processed);
            
            // 避免请求过快
            await new Promise(r => setTimeout(r, 500));
        } catch (e) {
            console.error(`   ❌ 搜索失败: ${e.message}`);
            keywordResults[keyword] = [];
        }
    }

    // 生成报告
    const report = {
        date: dateStr,
        source: 'weibo-mcp',
        total_keywords: WEIBO_KEYWORDS.length,
        total_posts: allResults.length,
        keywords_searched: WEIBO_KEYWORDS,
        keyword_results: keywordResults,
        all_posts: allResults,
        generated_at: new Date().toISOString()
    };

    // 写入文件
    fs.mkdirSync(DAILY_DIR, { recursive: true });
    const outputPath = path.join(DAILY_DIR, `weibo-${dateStr}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    
    console.log('\n' + '='.repeat(60));
    console.log(`✅ 采集完成！`);
    console.log(`   总帖子数: ${allResults.length}`);
    console.log(`   关键词数: ${WEIBO_KEYWORDS.length}`);
    console.log(`   输出文件: ${outputPath}`);
    console.log('='.repeat(60));

    return report;
}

main().catch(e => {
    console.error('错误:', e);
    process.exit(1);
});
