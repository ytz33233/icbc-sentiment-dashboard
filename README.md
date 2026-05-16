# 运营活动客户舆情雷达

> 全天候追踪微博、小红书、投诉平台等公开渠道，实时捕捉客户对「升金有礼」「i豆」等运营活动的反馈与情绪。

## 在线访问

项目已部署至 **GitHub Pages**：

| 页面 | 地址 |
|---|---|
| 项目介绍 | `https://ytz33233.github.io/icbc-sentiment-dashboard/intro.html` |
| 实时看板 | `https://ytz33233.github.io/icbc-sentiment-dashboard/dashboard.html` |
| 数据 API | `https://ytz33233.github.io/icbc-sentiment-dashboard/data/YYYY-MM-DD.json` |

> 每日 09:00 自动采集更新，看板右上角显示最后更新时间（北京时间）。

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

- **采集层**：Node.js + MCP Adapter（微博/小红书）
- **分析层**：情感推断、关键词提取、风险分级、热度计算
- **存储层**：JSON 数据文件 + Markdown 报告
- **呈现层**：GitHub Pages 静态托管
- **自动化**：GitHub Actions 自动部署 + OpenClaw 定时采集

## 配置说明

### GitHub Pages 部署方式

本项目使用 **GitHub Actions** 自动部署：

1. 仓库 Settings → Pages → Source 选择 **GitHub Actions**
2. 每次 `main` 分支 `sentiment_monitor/` 目录有变更时自动触发部署
3. `sentiment_monitor/` 目录作为 Pages 根目录部署

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
| 微博 | MCP Adapter 实时搜索 | 每日 09:00 | ✅ 运行中 |
| 小红书 | MCP Adapter 实时搜索 | 每日 09:00 | ✅ 运行中 |
| 黑猫投诉 | 网页爬虫 + 人工录入 | 按需 | ✅ 运行中 |
| 论坛/社区 | 网页爬虫 + 人工录入 | 按需 | ✅ 运行中 |
| 微博热搜 | API 定时抓取 | 每日 08:30 | ✅ 运行中 |

## 监测范围

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
