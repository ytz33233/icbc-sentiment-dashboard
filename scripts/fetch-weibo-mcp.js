const fs = require('fs');

async function searchWeibo(keyword, limit = 10) {
    const res = await fetch('http://127.0.0.1:4201/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, limit })
    });
    return res.json();
}

function getTodayBeijing() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const beijing = new Date(utc + (3600000 * 8));
    const yyyy = beijing.getFullYear();
    const mm = String(beijing.getMonth() + 1).padStart(2, '0');
    const dd = String(beijing.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

async function main() {
    const dateStr = getTodayBeijing();
    const keywords = [
        '工行 升金有礼',
        '工银i豆',
        '工行 i豆活动',
        '工行 升金有礼 投诉',
        '工行 i豆 投诉',
        '工行 活动 虚假宣传',
        '工行 谢谢参与',
        '工行 积分 清零'
    ];
    
    const results = {};
    for (const kw of keywords) {
        console.log(`Searching: ${kw}...`);
        try {
            const data = await searchWeibo(kw, 10);
            let items = [];
            if (data.data && data.data.result && Array.isArray(data.data.result)) {
                items = data.data.result;
            } else if (data.data && Array.isArray(data.data)) {
                items = data.data;
            } else if (Array.isArray(data.result)) {
                items = data.result;
            }
            console.log(`  Found ${items.length} results`);
            results[kw] = items.map(item => ({
                id: item.id,
                text: item.text,
                author: item.user?.screen_name,
                created_at: item.created_at,
                likes: item.attitudes_count,
                comments: item.comments_count,
                reposts: item.reposts_count,
                region: item.region_name,
                source: item.source
            }));
        } catch (e) {
            console.error(`  Error: ${e.message}`);
            results[kw] = [];
        }
        await new Promise(r => setTimeout(r, 2000));
    }
    
    // 输出到 ym-daily 目录（兼容 generate-dashboard-data.js）
    const DAILY_DIR = '/root/.openclaw/workspace/ym-daily';
    const fs = require('fs');
    fs.mkdirSync(DAILY_DIR, { recursive: true });
    const outputPath = `${DAILY_DIR}/weibo-${dateStr}.json`;
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`\nSaved to ${outputPath}`);
    
    let total = 0;
    for (const [kw, items] of Object.entries(results)) {
        total += items.length;
        console.log(`${kw}: ${items.length}`);
    }
    console.log(`\nTotal: ${total} posts`);
}

main().catch(console.error);
