# 运营活动客户舆情雷达

> 全天候追踪微博、小红书、投诉平台等公开渠道，每日两次自动采集客户对「升金有礼」「i豆」等运营活动的反馈与情绪。

## 在线访问

项目已部署至 **GitHub Pages**：

| 页面 | 地址 |
|---|---|
| 项目介绍 | `https://ytz33233.github.io/icbc-sentiment-dashboard/intro.html` |
| 舆情看板 | `https://ytz33233.github.io/icbc-sentiment-dashboard/dashboard.html` |
| 数据 API | `https://ytz33233.github.io/icbc-sentiment-dashboard/data/YYYY-MM-DD.json` |

> 每日 **09:00、15:00** 两次自动采集更新，看板右上角显示最后更新时间（北京时间）。

## 关联仓库

- **数据备份**: [Morning/bank-activities](https://github.com/Morning/bank-activities)（私有仓库，用于历史数据归档）
- **Pages 部署**: [ytz33233/icbc-sentiment-dashboard](https://github.com/ytz33233/icbc-sentiment-dashboard)（public 仓库，用于在线看板）

```
sentiment_monitor/
├── index.html          # 入口页（自动跳转至介绍页）
├── intro.html          # 项目介绍页（演示汇报用）
├── dashboard.html      # 实时看板（数据可视化）
├── data/               # 每日舆情 JSON 数据
├── alerts/             # 高风险告警 JSON
├── reports/            # Markdown 日报
├── scripts/            # 采集与分析脚本
└── README.md           # 本文件
```

## 技术架构

- **采集层**：Node.js + MCP Adapter（微博搜索）/ GitHub 仓库拉取（小红书）
- **分析层**：情感推断、关键词提取、风险分级、热度计算、噪音过滤
- **存储层**：JSON 数据文件 + Markdown 报告
- **呈现层**：GitHub Pages 静态托管
- **自动化**：OpenClaw 定时采集 + `auto-push.sh` 推送两个 GitHub 仓库

## 配置说明

### GitHub Pages 部署方式

本项目通过 `scripts/auto-push.sh` 推送至两个 GitHub 仓库：

1. **数据备份仓库** `Morning/bank-activities`（私有）
   - 保存完整历史数据与采集脚本
2. **Pages 部署仓库** `ytz33233/icbc-sentiment-dashboard`（public）
   - `sentiment_monitor/` 目录作为 Pages 根目录
   - 推送后约 1-2 分钟自动更新

### 定时采集配置

```bash
# crontab - sentiment_monitor/crontab.txt
0 9  * * * bash .../run-daily-sentiment.sh morning
0 15 * * * bash .../run-daily-sentiment.sh afternoon
```

- **上午批次 09:00**：采集前一日 21:00 后更新的数据（含小红书）
- **下午批次 15:00**：补充午间新增内容

### 本地开发

```bash
cd sentiment_monitor
# 直接打开 dashboard.html 或 intro.html 即可预览
# 数据加载需要本地 HTTP 服务器（避免 CORS）
python3 -m http.server 8080
# 访问 http://localhost:8080/dashboard.html
```

## 数据源

| 渠道 | 采集方式 | 更新频率 | 状态 |
|---|---|---|---|
| 微博 | MCP Adapter 搜索（8组关键词） | 每日 09:00 / 15:00 | ✅ 运行中 |
| 小红书 | GitHub 仓库 `ytz33233/xhs_yuqing_data` 拉取 | 每日 09:00 / 15:00（源站 21:00 更新） | ✅ 运行中 |
| 黑猫投诉 / 新闻 | Markdown 文件辅助录入（`web-*.md`） | 按需 | ⚠️ 辅助渠道 |

> **说明**：微博和小红书为主力自动采集渠道；黑猫投诉等需人工/辅助录入补充。所有数据统一经过噪音过滤、活动相关筛选、30天回溯期过滤后入库。

- **活动关键词**：升金有礼、工银 i豆、i豆乐园、心动有礼、立减金
- **风险关键词**：工行投诉、工行维权、工行活动 坑、谢谢参与、积分清零
- **回溯期**：30 天历史数据

## 风险分级规则

| 等级 | 条件 |
|---|---|
| 🔴 高风险 | 投诉平台负面 / 微博热搜命中 / 负面+高发酵 |
| 🟠 中风险 | 普通负面 + 互动量较高 / 负面+中发酵 |
| 🟢 低风险 | 中性 / 正面内容 |

---

© 2026 · 持续迭代中
