#!/usr/bin/env node
/**
 * dedup-history.js
 * 历史数据回溯去重脚本（一次性执行）
 *
 * 遍历 data/ 下所有 YYYY-MM-DD.json，按日期顺序处理，
 * 每天与之前已处理的数据进行去重，原地覆盖更新。
 *
 * 用法: node scripts/dedup-history.js
 */

const fs = require('fs');
const path = require('path');
const dedup = require('./dedup-utils.js');

const DATA_DIR = path.join(__dirname, '..', 'data');

function formatDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function main() {
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();

  console.log(`\n📂 发现 ${files.length} 个日报数据文件`);
  console.log('=' .repeat(50));

  let processedRecords = [];
  let totalBefore = 0;
  let totalAfter = 0;

  for (const file of files) {
    const filePath = path.join(DATA_DIR, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const records = data.records || [];
    totalBefore += records.length;

    // 从已处理记录构建 URL 索引
    const urlIndex = new Map();
    for (const r of processedRecords) {
      if (r.url && r.url.trim()) {
        const norm = dedup.normalizeUrl(r.url);
        if (norm && !urlIndex.has(norm)) {
          urlIndex.set(norm, { record: r });
        }
      }
    }

    // 去重
    const deduped = dedup.deduplicateRecords(records, processedRecords, urlIndex);
    totalAfter += deduped.length;

    // 更新已处理记录池
    processedRecords.push(...deduped);

    // 重写文件
    data.records = deduped;
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    const removed = records.length - deduped.length;
    console.log(`  ${file}: ${String(records.length).padStart(2)} -> ${String(deduped.length).padStart(2)}  ${removed > 0 ? '(去重 ' + removed + ' 条)' : ''}`);
  }

  console.log('=' .repeat(50));
  console.log(`📊 总计: ${totalBefore} 条 -> ${totalAfter} 条 (去重 ${totalBefore - totalAfter} 条)`);
  console.log(`✅ 所有文件已原地更新\n`);
}

main();
