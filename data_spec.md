# 工行舆情监测 — 每日数据输出规格

> 本文件定义每日舆情监测任务完成后，必须输出的结构化数据。
> 前端 dashboard.html 依赖以下数据渲染全部图表、表格和详情弹窗。
> 更新日期：2026-05-08 — 取消24小时时效性过滤，改为标记制。

---

## 一、单条舆情记录字段（必填 + 选填）

每条舆情必须输出以下字段，JSON 或 Markdown 表格均可：

| 字段 | 类型 | 必填 | 说明 | 前端对应 |
|------|------|------|------|----------|
| id | number/string | 是 | 全局唯一编号，建议日期+序号，如 `20260507-01` | 表格 ID 列、详情页 |
| date | string | 是 | 发布日期，格式 `YYYY-MM-DD` | 表格时间列、趋势图、详情页 |
| source | string | 是 | 来源名称，如 `微博`、`黑猫投诉`、`潮新闻` | 表格来源列、详情页 |
| sourceType | string | 是 | 来源分类：`social`(微博)、`news`(新闻媒体)、`complaint`(投诉平台)、`forum`(论坛社区)、`official`(官方) | 筛选器、来源分布图、表格 |
| sentiment | string | 是 | 情感倾向：`positive`(正面)、`negative`(负面)、`neutral`(中性) | 情感分布图、表格标签、筛选器 |
| riskLevel | string | 是 | 风险等级：`high`(高)、`medium`(中)、`low`(低) | 高风险预警区、详情页 |
| title | string | 是 | 舆情标题/一句话概括，最长 40 字 | 详情弹窗标题 |
| content | string | 是 | 内容摘要，保留核心事实，200 字以内 | 表格摘要列、详情页正文 |
| keywords | string[] | 是 | 关键词数组，3-5 个，如 `["虚假宣传","谢谢参与"]` | 表格关键词列、筛选匹配、详情页 |
| url | string | 是 | 原文链接，不可为空字符串 | 详情页原文链接 |
| author | string | 是 | 发布者/作者/投诉人昵称 | 详情页 |
| status | string | 是 | 处理状态，如 `用户吐槽`、`已发布`、`投诉已完成`、`活跃讨论` | 详情页时间线 |
| amount | string | 否 | 涉诉金额，投诉类必填，无则填 `"-"` | 详情页（投诉类高亮） |
| relatedProduct | string | 否 | 涉及产品/活动：`升金有礼`、`i豆活动`、`其他` | 可按产品筛选（预留） |
| **recency** | **string** | **是** | **时效性标签：`24h内`（过去24小时）或 `历史`（更早）** | **表格时效列、筛选器、详情页** |
| fermentation | string | 否 | 发酵程度：`low`/`medium`/`high` | 详情页、排序参考 |
| publishTime | string | 否 | 精确发布时间，如 `2026-05-07 14:30` | 详情页、时间线 |
| fetchTime | string | 否 | 采集时间，如 `2026-05-07 10:54` | 内部追溯用 |
| rawData | string | 否 | 原始抓取文本/截图链接 | 内部存档 |

---

## 二、日报汇总数据结构

每日监测结束后，必须输出一份汇总对象，供前端 KPI 卡片和图表使用：

```json
{
  "reportDate": "2026-05-08",
  "generatedAt": "2026-05-08 09:32",
  "summary": {
    "total": 0,
    "recentCount": 0,
    "historyCount": 0,
    "negativeCount": 0,
    "negativePct": 0,
    "positiveCount": 0,
    "neutralCount": 0,
    "channelCount": 0,
    "highRiskCount": 0
  },
  "bySource": {
    "social": 0,
    "news": 0,
    "complaint": 0,
    "forum": 0,
    "official": 0
  },
  "bySentiment": {
    "positive": 0,
    "negative": 0,
    "neutral": 0
  },
  "byRisk": {
    "high": 0,
    "medium": 0,
    "low": 0
  },
  "byProduct": {
    "升金有礼": 0,
    "i豆活动": 0,
    "其他": 0
  },
  "trend7d": [
    { "date": "2026-05-02", "total": 0, "recent": 0, "history": 0, "negative": 0 },
    { "date": "2026-05-03", "total": 0, "recent": 0, "history": 0, "negative": 0 },
    { "date": "2026-05-04", "total": 0, "recent": 0, "history": 0, "negative": 0 },
    { "date": "2026-05-05", "total": 0, "recent": 0, "history": 0, "negative": 0 },
    { "date": "2026-05-06", "total": 0, "recent": 0, "history": 0, "negative": 0 },
    { "date": "2026-05-07", "total": 0, "recent": 0, "history": 0, "negative": 0 },
    { "date": "2026-05-08", "total": 0, "recent": 0, "history": 0, "negative": 0 }
  ],
  "hotKeywords": [
    { "word": "虚假宣传", "count": 2 },
    { "word": "奖励不符", "count": 2 }
  ],
  "records": []
}
```

---

## 三、数据输出文件格式

### 推荐方式：每日一个 JSON 文件

文件路径：`sentiment_monitor/data/YYYY-MM-DD.json`

内容即上述汇总 JSON，`records` 数组内填入当日所有单条舆情。

### 备选方式：追加到总数据文件

文件路径：`sentiment_monitor/data/all_records.jsonl`

每行一条 JSON（JSON Lines 格式），便于增量追加：

```jsonl
{"id":"20260508-01","date":"2026-05-08","source":"微博","sourceType":"social","sentiment":"negative","riskLevel":"high","title":"...","content":"...","keywords":["..."],"url":"...","author":"...","status":"...","amount":"-","relatedProduct":"升金有礼","recency":"24h内","fermentation":"high","likes":128,"comments":45,"favorites":12,"heatScore":263,"category":"虚假宣传"}
{"id":"20260508-02","date":"2024-03-21","source":"黑猫投诉","sourceType":"complaint","sentiment":"negative","riskLevel":"high","title":"...","content":"...","keywords":["..."],"url":"...","author":"...","status":"...","amount":"100元","relatedProduct":"升金有礼","recency":"历史","fermentation":"low","likes":0,"comments":8,"favorites":0,"heatScore":16,"category":"投诉维权"}
```

日报汇总单独存为 `sentiment_monitor/daily/YYYY-MM-DD.json`。

---

## 四、时效性标记规则

### `recency` 字段判定标准

- **`24h内`**：发布时间或讨论时间在当前日期倒推24小时内
- **`历史`**：发布时间超过24小时，但内容仍与监测主题相关

### 输出要求

- 不再丢弃历史舆情，所有相关舆情均保留
- 必须在记录中明确标注 `recency` 字段
- 日报报告中需区分展示：先列24h内，再列历史
- 看板表格中可增加「时效」列用于筛选

---

## 五、前端对接说明

当前 `dashboard.html` 的 `mockData` 数组结构与上述单条记录字段基本对齐。

替换步骤：

1. 把硬编码的 `mockData` 改为从 `data/YYYY-MM-DD.json` 读取。
2. 汇总数据（KPI、情感分布、来源分布、趋势）从 JSON 的 `summary`、`bySentiment`、`bySource`、`trend7d` 字段取，不再实时计算。
3. 若当日无数据，`total: 0`，前端应显示"当日无有效舆情"而非空白。
4. **新增**：表格中增加「时效」列显示 `recency` 值，支持按 `24h内`/`历史` 筛选。

---

## 六、当前痛点对照

| 痛点 | 数据规格解决方式 |
|------|------------------|
| 微博数据未接入 | 微博监测结果按本规格字段整理后写入 `records` |
| 图表是死图标 | 汇总数据 `bySentiment`、`bySource`、`trend7d` 驱动动态图表 |
| 吐槽未转化为预警 | `riskLevel: high` + `status: 用户吐槽` 明确标记 |
| 涉诉金额缺失 | `amount` 字段投诉类必填，详情页高亮 |
| **历史舆情遗漏** | **取消24h过滤，`recency: 历史` 标记保留** |

---

## 七、执行建议

1. **先输出一次真实数据**：用当前已有的微博/全网监测结果，按本规格整理成 `2026-05-08.json`，替换 `mockData`，验证前端渲染。
2. **自动化**：后续每日监测任务完成后，脚本自动追加记录到 `all_records.jsonl`，并覆盖生成当日 `YYYY-MM-DD.json` 汇总。
3. **历史回填**：已有 4-28 的 6 条舆情和 5-7/5-8 的空结果，按规格补录。

---

_版本：v2.0 | 更新日期：2026-05-08 | 变更：取消24h时效性过滤，改为 `recency` 标记制_
