# 舆情监测关键词矩阵

> 聚焦：**升金有礼** 与 **i豆活动**
> 执行方式：OpenClaw agent 按矩阵逐条搜索，结果写入 `ym-daily/` 中间文件，再由 `scripts/generate-dashboard-data.js` 合并去重生成最终 JSON。

---

## A组：核心活动精准搜索（每日必搜）

| 编号 | 关键词 | 工具 | 说明 | 优先级 |
|------|--------|------|------|--------|
| A1 | 工行 升金有礼 | kimi_search, weibo_search | 活动核心词 | P0 |
| A2 | 工商银行 升金有礼 | kimi_search, weibo_search | 全称版本 | P0 |
| A3 | 工银i豆 | kimi_search, weibo_search | i豆核心词 | P0 |
| A4 | 工行 i豆活动 | kimi_search, weibo_search | i豆活动词 | P0 |
| A5 | 工行 资产达标礼 | kimi_search | 活动别名 | P1 |
| A6 | 工行 月月升金礼 | kimi_search | 活动别名 | P1 |

## B组：投诉维权（负面挖掘，每日必搜）

| 编号 | 关键词 | 工具 | 说明 | 优先级 |
|------|--------|------|------|--------|
| B1 | 工行 升金有礼 投诉 | kimi_search, weibo_search | 活动投诉 | P0 |
| B2 | 工行 i豆 投诉 | kimi_search, weibo_search | i豆投诉 | P0 |
| B3 | 工行 活动 虚假宣传 | kimi_search, weibo_search | 虚假宣传 | P0 |
| B4 | 工行 活动 骗 | weibo_search | 用户口语化 | P1 |
| B5 | 工行 谢谢参与 | weibo_search | 空奖吐槽 | P1 |
| B6 | 工行 积分 清零 | kimi_search, weibo_search | 清零投诉 | P1 |
| B7 | 工行 维权 | weibo_search | 维权讨论 | P2 |
| B8 | 工商银行 投诉 最新 | kimi_search | 通用投诉 | P2 |

## C组：扩展挖掘（隔日或按需搜索）

| 编号 | 关键词 | 工具 | 说明 | 优先级 |
|------|--------|------|------|--------|
| C1 | 工行 积分 贬值 | kimi_search, weibo_search | 积分贬值 | P2 |
| C2 | 工行 立减金 不到账 | kimi_search | 奖励发放问题 | P2 |
| C3 | 工行 抽奖 空 | weibo_search | 抽奖空奖 | P2 |
| C4 | 工行 活动 规则 争议 | kimi_search | 规则争议 | P2 |
| C5 | 工行 长辈客户 活动 | kimi_search | 长辈活动 | P2 |
| C6 | 工行 黑猫投诉 | kimi_search | 黑猫平台 | P2 |
| C7 | 工行 商城 不发货 | kimi_search | i豆商城问题 | P2 |
| C8 | 工行 美团 优惠券 | weibo_search | 美团兑换问题 | P2 |

## D组：竞品/行业参照（周度搜索）

| 编号 | 关键词 | 工具 | 说明 | 优先级 |
|------|--------|------|------|--------|
| D1 | 建行 升金 | kimi_search | 建行同类活动 | P3 |
| D2 | 招行 资产提升礼 | kimi_search | 招行同类活动 | P3 |
| D3 | 银行 积分 贬值 | kimi_search | 行业趋势 | P3 |

---

## 搜索执行建议

### 每日标准流程（约 15-20 分钟）
1. **A组**（6个关键词）：kimi_search 3个 + weibo_search 3个 → 约 6-8 分钟
2. **B组**（8个关键词）：kimi_search 4个 + weibo_search 4个 → 约 8-10 分钟
3. 结果保存为 `ym-daily/web-{date}.md` 和 `ym-daily/weibo-{date}.md`
4. 执行 `node sentiment_monitor/scripts/generate-dashboard-data.js {date}` 生成 JSON
5. 执行 `sentiment_monitor/scripts/auto-push.sh` 推送到 GitHub

### 热搜盯盘（每日 2 次）
- 09:00：weibo_hot_search("主榜") + weibo_hot_search("社会榜")
- 20:00：weibo_hot_search("主榜") + weibo_hot_search("生活榜")
- 检测规则：热搜词包含 "工行" / "工商" / "升金" / "i豆" / "积分" / "银行 投诉"
- 命中则记录到 `ym-daily/hot-{date}.md`，风险等级直接标为 **high**

### 周末/节假日
- 可降级为只搜 A1-A4 + B1-B3 + 热搜盯盘

---

## 去重规则

`generate-dashboard-data.js` 已接入 `dedup-utils.js` 自动去重，合并时按以下层级处理（跨30天历史比对）：

### 第一层：URL 归一化精确去重
- 去掉 `?` 参数、`#` 锚点、末尾 `/`，统一转小写
- 与过去30天历史数据中的 URL 比对
- 命中则合并（保留最早发布日期，合并来源/关键词/风险等级）

### 第二层：标题清洗后精确匹配
- 清洗规则：去掉所有标点/空格，统一转小写
- 清洗后标题完全相同 → 视为同一舆情
- 适用于：无 URL 的微博/小红书帖子、标题完全一致的新闻转载

### 合并策略
| 字段 | 规则 |
|------|------|
| `id` / `date` | 保留最早出现的 |
| `fetchTime` | 保留最新的 |
| `source` | 不同则拼接为 "来源A / 来源B" |
| `author` | 保留更具体的（排除平台泛化名） |
| `content` | 保留更长的 |
| `keywords` | 取并集，去重，截断至5个 |
| `url` | 优先保留非空的 |
| `recency` | 任一标记为"24h内"则保留 |
| `riskLevel` / `sentiment` | 取更严重的（high > medium > low；negative > neutral > positive） |

### 历史回溯
已提供一次性脚本清洗已有数据：
```bash
node scripts/dedup-history.js
```
按日期顺序处理，每天与之前所有数据去重，原地覆盖更新。

---

## 输出文件命名

| 搜索类型 | 中间文件 | 说明 |
|----------|----------|------|
| 全网搜索 | `ym-daily/web-{date}.md` | kimi_search 结果 |
| 微博搜索 | `ym-daily/weibo-{date}.md` | weibo_search 结果 |
| 热搜盯盘 | `ym-daily/hot-{date}.md` | weibo_hot_search 命中记录 |
| 小红书 | `sentiment_monitor/data/xhs-{date}.json` | 自动拉取的小红书数据 |
| 最终数据 | `sentiment_monitor/data/{date}.json` | 合并去重后的标准 JSON |
| 告警文件 | `sentiment_monitor/alerts/{date}.json` | 高风险舆情告警（如有） |

---

## 小红书数据源

**仓库地址**: https://github.com/ytz33233/xhs_yuqing_data

**自动采集命令**:
```bash
node sentiment_monitor/scripts/fetch-xhs-data.js {YYYY-MM-DD}
```

**特点**:
- 每日 21:00 自动更新
- 聚焦 ICBC 相关舆情（升金有礼、i豆活动等）
- 已预筛选，直接合并到最终数据
- `sourceType` 标记为 `social`，`source` 显示为"小红书"

---

## 微博智搜轮询策略（重要）

微博智搜 API 有时返回 `analyzing: true`，表示结果正在分析中。**此时必须等待并重试**，不能直接放弃。

### 轮询规则
| 项目 | 配置 |
|------|------|
| 首次等待 | 30 秒 |
| 间隔递增 | 每次 +30 秒（30s → 60s → 90s → 120s...） |
| 最大重试 | 5 次 |
| 最大总等待 | 约 7.5 分钟 |

### 执行方式
1. 调用 `weibo_search` 搜索关键词
2. 若返回结果正常 → 直接记录
3. 若返回 `analyzing: true` → 等待 30 秒后再次调用
4. 重复步骤 3，最多 5 次
5. 若仍 `analyzing`，记录异常原因，跳过该关键词

### 参考脚本
```bash
node sentiment_monitor/scripts/fetch-weibo-data.js
```

---

_版本：v1.2 | 更新日期：2026-05-11_
