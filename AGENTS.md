# AGENTS.md — 工行舆情监测项目

> 本文件供 AI Coding Agent 阅读。项目所有注释、文档、日志均以中文为主。

---

## 项目概述

本项目是**工商银行运营活动客户舆情监测系统**，聚焦两个产品：
- **升金有礼**（资产达标营销活动）
- **i豆活动** / 工银i豆（积分体系）

系统每日从微博、小红书、新闻媒体、投诉平台（黑猫投诉）、论坛等渠道采集舆情，经过去重、情感分析、风险分级后，生成结构化 JSON 数据，最终通过 `dashboard.html` 可视化展示。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | 纯 HTML + CSS + JavaScript（单文件 `dashboard.html`，无框架、无构建工具） |
| 数据处理 | Node.js（原生 `fs`/`path`/`https`，无 npm 依赖） |
| 辅助脚本 | Python 3（`update_fallback.py`，用于更新前端内嵌数据） |
| 存储 | 本地 JSON 文件 + Markdown 中间文件 |
| 版本控制 | Git，通过 `auto-push.sh` 自动推送到远程仓库 |

**注意**：本项目没有 `package.json`、`pyproject.toml`、`Cargo.toml` 等包管理文件，也没有传统意义上的构建步骤。所有脚本直接通过 `node` 或 `python` 运行。

---

## 目录结构

```
sentiment_monitor/
├── dashboard.html              # 前端舆情看板（单文件，内嵌 fallbackData）
├── dashboard.html.bak          # 看板备份文件
├── dashboard-test.js           # 看板 JS 逻辑测试（Node.js 运行）
├── update_fallback.py          # Python 版 fallbackData 更新脚本（已弃用，现用 scripts/update-fallback.js）
├── plan.md                     # 监测方案与执行计划
├── keywords.md                 # 搜索关键词矩阵与执行策略
├── data_spec.md                # 数据输出规格（前后端对接契约）
├── DASHBOARD_REVIEW.md         # 看板已修复问题与数据流说明
├── data/                       # 每日标准 JSON 数据文件
│   ├── YYYY-MM-DD.json         # 当日合并后的主数据（由 generate-dashboard-data.js 生成）
│   └── xhs-YYYY-MM-DD.json     # 小红书中间数据（由 fetch-xhs-data.js 拉取）
├── alerts/                     # 高风险/中风险舆情告警文件
│   └── YYYY-MM-DD.json
├── daily/                      # 每日舆情 Markdown 报告
│   └── YYYY-MM-DD.md
└── scripts/                    # 数据处理脚本
    ├── generate-dashboard-data.js   # 核心：合并去重 → 生成标准 JSON + 告警 + Markdown 日报
    ├── fetch-weibo-data.js          # 微博采集参考脚本（含 analyzing 轮询策略说明）
    ├── fetch-xhs-data.js            # 从 GitHub 拉取小红书数据并转换格式
    ├── update-fallback.js           # 合并最近7天数据，写入 dashboard.html 的 fallbackData
    ├── cleanup-non-activity.js      # 清理 data/ 下非活动相关的记录并重新统计
    └── auto-push.sh                 # Git 自动提交推送脚本
```

---

## 数据流架构

```
┌─────────────────────────────────────────────────────────────────┐
│  数据采集层（OpenClaw Agent 手动/定时触发）                        │
│  ├── kimi_search → ym-daily/web-{date}.md                       │
│  ├── weibo_search → ym-daily/weibo-{date}.md                    │
│  ├── weibo_hot_search → ym-daily/hot-{date}.md                  │
│  └── fetch-xhs-data.js → data/xhs-{date}.json                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  数据处理层（Node.js）                                            │
│  generate-dashboard-data.js                                      │
│    1. 解析 web-/weibo-/hot- 中间 Markdown 文件                    │
│    2. 读取 xhs-{date}.json                                       │
│    3. 合并去重（标题+来源前N字为键）                               │
│    4. 活动相关筛选（升金有礼 / i豆）                               │
│    5. 历史回填（当日无数据时取最近30天历史）                        │
│    6. 统计计算 + 热词统计 + 7日趋势计算                             │
│    7. 输出：                                                      │
│       - data/{date}.json      （主数据）                          │
│       - alerts/{date}.json    （高风险告警，如有）                  │
│       - reports/ym-report-{date}.md （Markdown 日报）              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  前端嵌入层                                                        │
│  update-fallback.js                                              │
│    1. 读取最近7天的 data/*.json                                   │
│    2. 去重 + 过滤 + 重新统计                                       │
│    3. 替换 dashboard.html 中的 `const fallbackData = {...}`       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  前端展示层（dashboard.html）                                     │
│  初始化逻辑：                                                      │
│    1. 优先使用 fallbackData（内嵌）渲染页面                       │
│    2. 后台尝试 fetch(data/{date}.json) 加载最新数据               │
│    3. file:// 协议下 fetch 会失败，自动回退 fallbackData          │
│  支持：日期范围查询、关键词/情感/来源筛选、排序、分页、详情弹窗      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 核心脚本使用方式

### 1. 生成每日数据（必须先完成数据采集）

```bash
# 默认取今天北京时间
node scripts/generate-dashboard-data.js

# 指定日期
node scripts/generate-dashboard-data.js 2026-05-12
```

### 2. 拉取小红书数据

```bash
# 默认今天
node scripts/fetch-xhs-data.js

# 指定日期
node scripts/fetch-xhs-data.js 2026-05-12
```

### 3. 更新看板 fallbackData

```bash
# 默认合并最近7天到 dashboard.html
node scripts/update-fallback.js

# 指定基准日期
node scripts/update-fallback.js 2026-05-12
```

### 4. 清理非活动数据

```bash
node scripts/cleanup-non-activity.js
```

### 5. 自动推送 GitHub

```bash
bash scripts/auto-push.sh
# 或指定日期
bash scripts/auto-push.sh 2026-05-12
```

目标仓库：`Morning/bank-activities`，分支 `sync-main` → `main`。

---

## 数据规格

单条舆情记录的必填字段（详见 `data_spec.md`）：

| 字段 | 说明 |
|------|------|
| `id` | 全局唯一编号，格式 `YYYYMMDD-NN` |
| `date` | 发布日期 `YYYY-MM-DD` |
| `source` | 来源名称，如"微博"、"黑猫投诉" |
| `sourceType` | `social`/`news`/`complaint`/`forum`/`official`/`xiaohongshu` |
| `sentiment` | `positive` / `negative` / `neutral` |
| `riskLevel` | `high` / `medium` / `low` |
| `title` | 标题，最长40字 |
| `content` | 摘要，200字以内 |
| `keywords` | 关键词数组，3-5个 |
| `url` | 原文链接 |
| `author` | 发布者 |
| `status` | 处理状态 |
| `recency` | `24h内` 或 `历史` |
| `relatedProduct` | `升金有礼` / `i豆活动` / `其他` |

日报汇总 JSON 包含：`summary`、`bySource`、`bySentiment`、`byRisk`、`byProduct`、`byCategory`、`trend7d`、`hotKeywords`、`records`。

---

## 测试

本项目没有使用 Jest/Mocha 等测试框架，测试脚本为原生 Node.js：

```bash
node dashboard-test.js
```

测试内容：
- 提取 `dashboard.html` 中 `<script>` 代码，用 `eval` 在 Node.js 环境执行
- Mock `document` / `window` 对象以支持 DOM 依赖代码
- 验证 `CONFIG` 对象、`fallbackData` 完整性
- 验证 `computeTrend`、`goToPage`、`sortTable`、`applyFilters` 等核心函数行为
- 验证 HTML 结构（表格列数、筛选器存在性）

**测试通过标准**：最后一行输出 `🎉 全部通过！`，否则返回非零退出码。

---

## 代码风格与约定

### JavaScript
- 使用原生 ES5/ES6，**不引入任何 npm 包**
- `const`/`let` 混用，函数声明优先用 `function`
- 字符串拼接大量使用 `+` 运算符（兼容旧浏览器）
- 工具函数（`formatDate`、`getTodayBeijing`）在多个文件中重复定义，这是有意为之（每个脚本独立可运行）
- 文件头部必须有 JSDoc 风格注释说明用途、用法、输入输出

### 日期处理
- 所有日期以**北京时间（Asia/Shanghai，UTC+8）**为准
- 不使用 `Intl.DateTimeFormat`，而是通过 UTC 偏移手动计算：
  ```js
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const beijing = new Date(utc + (3600000 * 8));
  ```
- 日期字符串格式：`YYYY-MM-DD`

### 文件路径
- 脚本中硬编码了工作区路径：`/root/.openclaw/workspace`
- 本地开发时，部分脚本（如 `update_fallback.py`）使用相对路径，但在生产环境（OpenClaw 容器）中必须使用绝对路径

### 去重规则
- 键值：`(title前20字) + "|" + (source前10字)`
- 冲突时保留 `content` 更长的记录，合并关键词和来源

---

## 前端看板关键逻辑

- **`fallbackData`**：内嵌在 HTML 中的默认数据，用于 `file://` 打开或 fetch 失败时兜底
- **`filterWithin7Days`**：所有展示数据默认只保留最近7天（含今天），这是硬性业务规则
- **趋势图**：`renderTrendLine()` 目前固定展示 5月1日 至今的数据，不是按查询范围动态调整
- **筛选行为**：`applyFilters` / `resetFilters` **只刷新表格**，KPI 卡片和图表始终反映当前加载范围的总体数据（避免"筛选后图表不变"的困惑）
- **排序默认**：热度降序（`heatScore` 高在前），同热度下按日期倒序。用户可通过点击表头切换按时间、来源、类别、热度、情感排序
- **类别筛选栏**：表格上方有横向类别标签快捷筛选，点击后自动设置 `filter-category` 并触发筛选
- **热度计算**：`heatScore = round(likes×1 + comments×2 + favorites×1.5)`，评论权重最高

---

## 已知限制与注意事项

1. **无包管理器**：不要尝试运行 `npm install` 或添加 `package.json`。所有脚本依赖 Node.js 内置模块。
2. **无服务端**：`dashboard.html` 是静态页面。若通过 HTTP 服务器访问，会尝试 `fetch(data/YYYY-MM-DD.json)`；若直接 `file://` 打开，浏览器安全策略会阻止 fetch，自动回退到 `fallbackData`。
3. **小红书数据源依赖外部仓库**：`fetch-xhs-data.js` 从 `https://github.com/ytz33233/xhs_yuqing_data` 拉取 Raw JSON，每日 21:00 更新。仓库未更新时会返回空。
4. **微博 analyzing 状态**：微博智搜 API 可能返回 `analyzing: true`，必须轮询等待（30s → 60s → 90s... 最多5次），不能直接跳过。
5. **历史回填机制**：如果当天没有采集到活动相关舆情，`generate-dashboard-data.js` 会自动从最近30天的历史数据中回填最多30条，并在 JSON 中标记 `fromHistory: true`。
6. ** alert 文件清理**：如果当日无高/中风险舆情，`generate-dashboard-data.js` 会删除旧的 `alerts/YYYY-MM-DD.json`（如果存在）。

---

## 安全与隐私

- 本项目处理的均为**公开网络舆情**（微博、新闻、投诉平台公开页面），不含个人隐私数据
- `url` 字段存储原文链接，需确保链接可公开访问
- Git 提交由 `auto-push.sh` 自动完成，提交者为 `OpenClaw Bot <openclaw-bot@localhost>`
- 不要提交任何包含内部账号、密码、API Token 的文件

---

## 扩展开发建议

- **新增渠道**：在 `generate-dashboard-data.js` 的 `main()` 函数中加入新的中间文件解析逻辑，确保输出字段符合 `data_spec.md`
- **修改前端图表**：所有图表渲染函数集中在 `dashboard.html` 的 `<script>` 中，搜索 `renderSentimentDonut`、`renderSourceBars`、`renderTrendLine`、`renderWordCloud`
- **调整7天限制**：全局搜索 `filterWithin7Days`，该函数在 `dashboard.html` 和 `update-fallback.js` 中均有定义，修改时需要同步
- **新增筛选维度**：需要同时修改 HTML 筛选控件、`applyFilters` 函数、`dashboard-test.js` 测试用例

---

_版本：v1.0 | 基于项目状态 2026-05-12 整理_
