import json
import re

# 读取最新数据
with open('data/2026-05-09.json', 'r', encoding='utf-8') as f:
    new_data = json.load(f)

# 读取 dashboard.html
with open('dashboard.html', 'r', encoding='utf-8') as f:
    html = f.read()

# 找到 fallbackData 的开始和结束位置
start_marker = 'const fallbackData = {'
start_idx = html.find(start_marker)
if start_idx == -1:
    raise ValueError('找不到 fallbackData 开始标记')

end_marker = '// ===================== 状态'
end_idx = html.find(end_marker, start_idx)
if end_idx == -1:
    raise ValueError('找不到 fallbackData 结束标记')

# 过滤 records，只保留前端需要的字段
frontend_fields = [
    'id', 'date', 'publishTime', 'source', 'sourceType', 'sentiment',
    'riskLevel', 'title', 'content', 'keywords', 'url', 'author',
    'status', 'amount', 'relatedProduct', 'recency', 'fermentation',
    'fetchTime'
]

clean_records = []
for r in new_data['records']:
    clean = {k: v for k, v in r.items() if k in frontend_fields}
    clean_records.append(clean)

# 构建新的 fallbackData 字符串
records_str = ',\n'.join(
    '    { ' + ', '.join(
        f'"{k}": ' + (f'[{", ".join(json.dumps(x, ensure_ascii=False) for x in v)}]' if isinstance(v, list) else json.dumps(v, ensure_ascii=False))
        for k, v in r.items()
    ) + ' }'
    for r in clean_records
)

hot_str = ',\n'.join(
    f'    {{ "word": {json.dumps(k["word"])}, "count": {k["count"]} }}'
    for k in new_data['hotKeywords']
)

trend_str = ',\n'.join(
    f'    {{ "date": "{t["date"]}", "total": {t["total"]}, "recent": {t["recent"]}, "history": {t["history"]}, "negative": {t["negative"]} }}'
    for t in new_data['trend7d']
)

new_fallback = f'''const fallbackData = {{
  "reportDate": "{new_data['reportDate']}",
  "generatedAt": "{new_data['generatedAt']}",
  "summary": {{ "total": {new_data['summary']['total']}, "recentCount": {new_data['summary']['recentCount']}, "historyCount": {new_data['summary']['historyCount']}, "negativeCount": {new_data['summary']['negativeCount']}, "negativePct": {new_data['summary']['negativePct']}, "positiveCount": {new_data['summary']['positiveCount']}, "neutralCount": {new_data['summary']['neutralCount']}, "channelCount": {new_data['summary']['channelCount']}, "highRiskCount": {new_data['summary']['highRiskCount']} }},
  "bySource": {{ {', '.join(f'"{k}": {v}' for k, v in new_data['bySource'].items())} }},
  "bySentiment": {{ {', '.join(f'"{k}": {v}' for k, v in new_data['bySentiment'].items())} }},
  "byRisk": {{ {', '.join(f'"{k}": {v}' for k, v in new_data['byRisk'].items())} }},
  "byProduct": {{ {', '.join(f'"{k}": {v}' for k, v in new_data.get('byProduct', {}).items())} }},
  "trend7d": [
{trend_str}
  ],
  "hotKeywords": [
{hot_str}
  ],
  "records": [
{records_str}
  ]
}};'''

# 替换
html = html[:start_idx] + new_fallback + '\n\n' + html[end_idx:]

with open('dashboard.html', 'w', encoding='utf-8') as f:
    f.write(html)

print(f'fallbackData 已更新为 {new_data["reportDate"]} 数据，共 {len(new_data["records"])} 条记录')
