#!/usr/bin/env python3
"""
dashboard.html 批量改造脚本
1. KPI卡片合并
2. 筛选器前置+低调化
3. 热词云改造
4. 用户反馈功能
"""

import re

with open('dashboard.html', 'r', encoding='utf-8') as f:
    html = f.read()

# ============================================================
# 1. 新增 CSS 样式（插入到 </style> 之前）
# ============================================================
new_css = '''
/* ── KPI Bar (Compact) ── */
.kpi-bar {
  display: flex;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  margin-bottom: 24px;
  box-shadow: var(--shadow-panel);
}
.kpi-bar-item {
  flex: 1;
  padding: 14px 12px;
  text-align: center;
  border-right: 1px solid var(--border);
  position: relative;
}
.kpi-bar-item:last-child { border-right: none; }
.kpi-bar-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-dim);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-bottom: 6px;
}
.kpi-bar-value {
  font-family: var(--font-display);
  font-size: 26px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.02em;
  color: var(--text);
}
.kpi-bar-item.accent .kpi-bar-value { color: var(--accent-light); }
.kpi-bar-item.negative .kpi-bar-value { color: var(--bad); }
.kpi-bar-item.positive .kpi-bar-value { color: var(--green); }

/* ── Filter Bar (Subtle) ── */
.filter-bar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
  padding: 10px 16px;
  margin-bottom: 8px;
  background: transparent;
}
.filter-bar .filter-group { display: flex; align-items: center; gap: 6px; }
.filter-bar .filter-input, .filter-bar .filter-select {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 5px 10px;
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--text-muted);
  outline: none;
  transition: border-color 0.2s;
}
.filter-bar .filter-input:focus, .filter-bar .filter-select:focus {
  border-color: var(--accent);
}
.filter-bar .filter-input::placeholder { color: var(--text-dim); font-size: 12px; }
.filter-bar .btn {
  padding: 5px 14px;
  font-size: 11px;
  border-radius: var(--radius-sm);
}

/* ── Real Word Cloud ── */
.word-cloud-real {
  position: relative;
  width: 100%;
  min-height: 220px;
  padding: 12px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 6px 10px;
}
.word-cloud-item {
  display: inline-block;
  padding: 4px 14px;
  border-radius: 100px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.22, 1, 0.36, 1);
  border: 1px solid transparent;
  white-space: nowrap;
  user-select: none;
}
.word-cloud-item:hover {
  transform: scale(1.1);
  border-color: var(--accent);
  box-shadow: 0 0 16px var(--accent-glow);
  z-index: 2;
}
.word-cloud-item.active {
  background: var(--accent);
  color: #fff !important;
  border-color: var(--accent);
  box-shadow: 0 0 12px var(--accent-glow);
}

/* ── Feedback ── */
.feedback-area {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
.feedback-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-bottom: 10px;
}
.feedback-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.feedback-btn {
  padding: 6px 16px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 12px;
  font-family: var(--font-body);
  cursor: pointer;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.feedback-btn:hover { border-color: var(--accent); color: var(--text); }
.feedback-btn.active-yes { background: rgba(55,196,134,0.12); border-color: var(--green); color: var(--green); }
.feedback-btn.active-no { background: rgba(239,102,120,0.12); border-color: var(--bad); color: var(--bad); }
.feedback-note {
  font-size: 11px;
  color: var(--text-dim);
  margin-top: 8px;
}

/* ── Keyword Filter Hint ── */
.keyword-filter-hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.keyword-filter-hint .hint-remove {
  cursor: pointer;
  color: var(--text-dim);
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
}
.keyword-filter-hint .hint-remove:hover { color: var(--bad); }
'''

html = html.replace('</style>', new_css + '\n</style>')

# ============================================================
# 2. 替换 KPI HTML（4张卡片 → 紧凑bar）
# ============================================================
old_kpi = '''  <!-- ═══ 核心指标 ═══ -->
  <div class="kpi-section">
    <div class="kpi-card" data-delay="2">
      <div class="kpi-sublabel">舆情总量</div>
      <div class="kpi-big" id="kpi-total">--</div>
    </div>
    <div class="kpi-card" data-delay="3">
      <div class="kpi-sublabel">24h内新增</div>
      <div class="kpi-big" id="kpi-recent">--</div>
    </div>
    <div class="kpi-card accent-negative" data-delay="4">
      <div class="kpi-sublabel">需关注</div>
      <div class="kpi-big" id="kpi-negative">--</div>
    </div>
    <div class="kpi-card accent-positive" data-delay="5">
      <div class="kpi-sublabel">正面反馈</div>
      <div class="kpi-big" id="kpi-positive">--</div>
    </div>
  </div>'''

new_kpi = '''  <!-- ═══ 核心指标 ═══ -->
  <div class="kpi-bar" data-delay="2">
    <div class="kpi-bar-item accent">
      <div class="kpi-bar-label">舆情总量</div>
      <div class="kpi-bar-value" id="kpi-total">--</div>
    </div>
    <div class="kpi-bar-item">
      <div class="kpi-bar-label">24h内新增</div>
      <div class="kpi-bar-value" id="kpi-recent">--</div>
    </div>
    <div class="kpi-bar-item negative">
      <div class="kpi-bar-label">需关注</div>
      <div class="kpi-bar-value" id="kpi-negative">--</div>
    </div>
    <div class="kpi-bar-item positive">
      <div class="kpi-bar-label">正面反馈</div>
      <div class="kpi-bar-value" id="kpi-positive">--</div>
    </div>
  </div>'''

html = html.replace(old_kpi, new_kpi)

# ============================================================
# 3. 移动筛选器位置：从 charts 前面移到 table-section 前面
# ============================================================
old_filter = '''  <!-- ═══ FILTERS ═══ -->
  <div class="filter-section" data-delay="5">
    <div class="toolbar-mobile-hint" id="mobile-filter-hint">
      <span>👆 点击筛选查看条件</span>
      <button class="toolbar-overflow-btn" onclick="openMobileFilter()">☰</button>
    </div>
    <div class="filter-group filter-desktop">
      <span class="filter-label">时间</span>
      <input type="date" class="filter-input" id="filter-date-start" style="width:130px;">
      <span style="color:var(--text-dim);font-size:12px;">→</span>
      <input type="date" class="filter-input" id="filter-date-end" style="width:130px;">
    </div>
    <div class="filter-group filter-desktop">
      <span class="filter-label">关键词</span>
      <input type="text" class="filter-input" id="filter-keyword" placeholder="搜索..." style="width:140px;">
    </div>
    <div class="filter-group filter-desktop">
      <span class="filter-label">情感</span>
      <select class="filter-select" id="filter-sentiment">
        <option value="">全部</option>
        <option value="positive">正面</option>
        <option value="negative">负面</option>
        <option value="neutral">中性</option>
      </select>
    </div>
    <div class="filter-group filter-desktop">
      <span class="filter-label">来源</span>
      <select class="filter-select" id="filter-source">
        <option value="">全部</option>
        <option value="social">微博</option>
        <option value="xiaohongshu">小红书</option>
        <option value="news">新闻媒体</option>
        <option value="complaint">投诉平台</option>
        <option value="forum">论坛社区</option>
        <option value="official">官方</option>
      </select>
    </div>
    <div class="filter-group filter-desktop">
      <span class="filter-label">类别</span>
      <select class="filter-select" id="filter-category">
        <option value="">全部</option>
        <option value="i豆兑换">i豆兑换</option>
        <option value="薅羊毛">薅羊毛</option>
        <option value="资产达标">资产达标</option>
        <option value="投诉维权">投诉维权</option>
        <option value="虚假宣传">虚假宣传</option>
        <option value="其他">其他</option>
      </select>
    </div>
    <div class="filter-group" style="margin-left:auto;">
      <button class="btn btn-secondary" onclick="resetFilters()">重置</button>
      <button class="btn btn-primary" onclick="onQuery()">查询</button>
    </div>
  </div>'''

# 从原位置删除
html = html.replace(old_filter, '')

# ============================================================
# 4. 在 table-section 前面插入低调的筛选器
# ============================================================
table_marker = '''  <!-- ═══ DATA TABLE ═══ -->
  <div class="table-section" data-delay="9">'''

new_table_header = '''  <!-- ═══ 关键词筛选提示 ═══ -->
  <div id="keyword-filter-hint" style="display:none;"></div>

  <!-- ═══ FILTERS (subtle) ═══ -->
  <div class="filter-bar" data-delay="8">
    <div class="toolbar-mobile-hint" id="mobile-filter-hint" style="width:100%;margin:0 0 8px;">
      <span>👆 点击筛选查看条件</span>
      <button class="toolbar-overflow-btn" onclick="openMobileFilter()">☰</button>
    </div>
    <div class="filter-group filter-desktop">
      <span class="filter-label">时间</span>
      <input type="date" class="filter-input" id="filter-date-start" style="width:115px;">
      <span style="color:var(--text-dim);font-size:11px;">→</span>
      <input type="date" class="filter-input" id="filter-date-end" style="width:115px;">
    </div>
    <div class="filter-group filter-desktop">
      <span class="filter-label">关键词</span>
      <input type="text" class="filter-input" id="filter-keyword" placeholder="搜索..." style="width:120px;">
    </div>
    <div class="filter-group filter-desktop">
      <span class="filter-label">情感</span>
      <select class="filter-select" id="filter-sentiment">
        <option value="">全部</option>
        <option value="positive">正面</option>
        <option value="negative">负面</option>
        <option value="neutral">中性</option>
      </select>
    </div>
    <div class="filter-group filter-desktop">
      <span class="filter-label">来源</span>
      <select class="filter-select" id="filter-source">
        <option value="">全部</option>
        <option value="social">微博</option>
        <option value="xiaohongshu">小红书</option>
        <option value="news">新闻媒体</option>
        <option value="complaint">投诉平台</option>
        <option value="forum">论坛社区</option>
        <option value="official">官方</option>
      </select>
    </div>
    <div class="filter-group filter-desktop">
      <span class="filter-label">类别</span>
      <select class="filter-select" id="filter-category">
        <option value="">全部</option>
        <option value="i豆兑换">i豆兑换</option>
        <option value="薅羊毛">薅羊毛</option>
        <option value="资产达标">资产达标</option>
        <option value="投诉维权">投诉维权</option>
        <option value="虚假宣传">虚假宣传</option>
        <option value="其他">其他</option>
      </select>
    </div>
    <div class="filter-group filter-desktop" style="margin-left:auto;">
      <button class="btn btn-secondary" onclick="resetFilters()">重置</button>
      <button class="btn btn-primary" onclick="onQuery()">查询</button>
    </div>
  </div>

  <!-- ═══ DATA TABLE ═══ -->
  <div class="table-section" data-delay="9">'''

html = html.replace(table_marker, new_table_header)

# ============================================================
# 5. 改造热词云 renderWordCloud 函数
# ============================================================
old_wordcloud = '''function renderWordCloud() {
  const keywords = loadedData.hotKeywords || [];
  const container = document.getElementById("word-cloud");
  if (keywords.length === 0) {
    container.innerHTML = '<div style="color:var(--text-dim);font-size:13px;">无数据</div>';
    return;
  }
  const maxCount = Math.max(...keywords.map(k => k.count), 1);
  container.innerHTML = keywords.map(k => {
    const size = 12 + (k.count / maxCount) * 10;
    const opacity = 0.5 + (k.count / maxCount) * 0.5;
    return '<span class="word-item-dark" style="font-size:' + size + 'px;opacity:' + opacity + '">' + k.word + '</span>';
  }).join("");
}'''

new_wordcloud = '''function renderWordCloud() {
  const keywords = loadedData.hotKeywords || [];
  const container = document.getElementById("word-cloud");
  if (keywords.length === 0) {
    container.innerHTML = '<div style="color:var(--text-dim);font-size:13px;">无数据</div>';
    return;
  }
  const maxCount = Math.max(...keywords.map(k => k.count), 1);
  const colors = [
    '#57b3ff', '#f6b84b', '#37c486', '#ef6678', '#ce93d8',
    '#88a0c7', '#4fc3f7', '#ff9800', '#81c784', '#e57373'
  ];
  // 随机但确定性的洗牌，让每次渲染布局一致
  const seeded = keywords.map((k, i) => {
    const ratio = k.count / maxCount;
    const size = 12 + ratio * 18; // 12px ~ 30px
    const opacity = 0.55 + ratio * 0.45;
    const color = colors[i % colors.length];
    const weight = ratio;
    return { ...k, size, opacity, color, weight };
  });
  // 按count分组：大词在前，小词在后，交错排列
  seeded.sort((a, b) => b.count - a.count);

  const activeKeyword = getActiveKeywordFilter();
  container.innerHTML = '<div class="word-cloud-real">' + seeded.map((k, i) => {
    const isActive = activeKeyword === k.word;
    const order = i % 2 === 0 ? '' : 'order:' + (Math.floor(Math.random() * 3)) + ';';
    return '<span class="word-cloud-item ' + (isActive ? 'active' : '') + '" '
      + 'style="font-size:' + k.size.toFixed(1) + 'px;'
      + 'color:' + (isActive ? '#fff' : k.color) + ';'
      + 'opacity:' + (isActive ? 1 : k.opacity) + ';"
      + ' onclick="filterByKeyword(\'' + k.word + '\')">'
      + k.word + ' <small style="font-size:0.7em;opacity:0.6">' + k.count + '</small></span>';
  }).join('') + '</div>';
}

function getActiveKeywordFilter() {
  const kw = document.getElementById('filter-keyword').value.trim();
  return kw || '';
}

function filterByKeyword(word) {
  const input = document.getElementById('filter-keyword');
  const current = input.value.trim();
  if (current === word) {
    // 再次点击取消筛选
    input.value = '';
    hideKeywordFilterHint();
  } else {
    input.value = word;
    showKeywordFilterHint(word);
  }
  applyFilters();
}

function showKeywordFilterHint(word) {
  const hint = document.getElementById('keyword-filter-hint');
  if (!hint) return;
  hint.innerHTML = '<div class="keyword-filter-hint">热词筛选：<strong>' + word + '</strong><span class="hint-remove" onclick="clearKeywordFilter()">✕</span></div>';
  hint.style.display = 'block';
}

function hideKeywordFilterHint() {
  const hint = document.getElementById('keyword-filter-hint');
  if (!hint) return;
  hint.innerHTML = '';
  hint.style.display = 'none';
}

function clearKeywordFilter() {
  document.getElementById('filter-keyword').value = '';
  hideKeywordFilterHint();
  applyFilters();
}'''

html = html.replace(old_wordcloud, new_wordcloud)

# ============================================================
# 6. 改造 showDetail 函数，添加反馈功能
# ============================================================
old_showdetail = '''function showDetail(id) {
  const item = (loadedData.records || []).find(d => d.id === id);
  if (!item) return;

  document.getElementById('modal-title').textContent = item.title || '舆情详情';

  const kwHtml = (item.keywords || []).map(k =>
    `<span style="display:inline-block;padding:2px 8px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:4px;font-size:12px;margin:2px;color:var(--text-muted);">${k}</span>`
  ).join('');

  const amountHtml = item.amount && item.amount !== '-' ? `
    <div class="detail-row"><div class="detail-label">涉诉金额</div><div class="detail-value" style="color:#c62828;font-weight:600;">${item.amount}</div></div>` : '';

  const catClass = 'tag-category-' + (item.category || '其他');
  const catLabel = CONFIG.labels.category[item.category] || item.category || '其他';

  document.getElementById('modal-body').innerHTML = `
    <div class="detail-row"><div class="detail-label">发布时间</div><div class="detail-value">${item.date}${item.publishTime && item.publishTime !== item.date ? ' ' + item.publishTime.slice(11) : ''}</div></div>
    <div class="detail-row"><div class="detail-label">信息来源</div><div class="detail-value">${item.source}</div></div>
    <div class="detail-row"><div class="detail-label">发布者</div><div class="detail-value">${item.author}</div></div>
    <div class="detail-row"><div class="detail-label">类别</div><div class="detail-value"><span class="tag ${catClass}">${catLabel}</span></div></div>
    <div class="detail-row"><div class="detail-label">情感倾向</div><div class="detail-value"><span class="tag tag-sentiment-${item.sentiment}">${getSentimentLabel(item.sentiment)}</span></div></div>
    <div class="detail-row"><div class="detail-label">热度</div><div class="detail-value"><span style="font-weight:600;color:var(--gold);">🔥 ${item.heatScore || 0}</span> <span style="color:var(--text-dim);font-size:12px;">(👍${item.likes || 0} 💬${item.comments || 0} ⭐${item.favorites || 0})</span></div></div>
    <div class="detail-row"><div class="detail-label">关键词</div><div class="detail-value">${kwHtml}</div></div>
    <div class="detail-row"><div class="detail-label">标题</div><div class="detail-value" style="font-weight:600;">${item.title}</div></div>
    <div class="detail-row"><div class="detail-label">内容详情</div></div>
    <div class="detail-content">${item.content}</div>
    <div class="detail-row" style="margin-top:20px;"><div class="detail-label">原文链接</div><div class="detail-value"><a href="${item.url}" target="_blank" class="link-btn">${item.url}</a></div></div>
    <div class="detail-row"><div class="detail-label">处理状态</div><div class="detail-value">${item.status}</div></div>
    ${amountHtml}
    <div style="margin-top:24px;padding-top:20px;border-top:1px solid #eee;">
      <div class="chart-title" style="margin-bottom:16px;">舆情处理时间线</div>
      <div class="timeline">
        <div class="timeline-item"><div class="timeline-time">${item.date}</div><div class="timeline-text">舆情发布</div></div>
        <div class="timeline-item"><div class="timeline-time">${item.date}</div><div class="timeline-text">系统收录并标记：${getSentimentLabel(item.sentiment)}</div></div>
        <div class="timeline-item"><div class="timeline-time">${loadedData.reportDate || '今日'}</div><div class="timeline-text">当前状态：${item.status}</div></div>
      </div>
    </div>`;

  document.getElementById('modal').classList.add('active');
}'''

new_showdetail = '''function showDetail(id) {
  const item = (loadedData.records || []).find(d => d.id === id);
  if (!item) return;

  document.getElementById('modal-title').textContent = item.title || '舆情详情';

  const kwHtml = (item.keywords || []).map(k =>
    `<span style="display:inline-block;padding:2px 8px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:4px;font-size:12px;margin:2px;color:var(--text-muted);">${k}</span>`
  ).join('');

  const amountHtml = item.amount && item.amount !== '-' ? `
    <div class="detail-row"><div class="detail-label">涉诉金额</div><div class="detail-value" style="color:#c62828;font-weight:600;">${item.amount}</div></div>` : '';

  const catClass = 'tag-category-' + (item.category || '其他');
  const catLabel = CONFIG.labels.category[item.category] || item.category || '其他';

  const fb = getFeedback(item.id);
  const fbYesClass = fb === 'yes' ? 'active-yes' : '';
  const fbNoClass = fb === 'no' ? 'active-no' : '';
  const fbMsg = fb === 'yes' ? '您已标记为「准确」' : fb === 'no' ? '您已标记为「不准确」' : '';

  document.getElementById('modal-body').innerHTML = `
    <div class="detail-row"><div class="detail-label">发布时间</div><div class="detail-value">${item.date}${item.publishTime && item.publishTime !== item.date ? ' ' + item.publishTime.slice(11) : ''}</div></div>
    <div class="detail-row"><div class="detail-label">信息来源</div><div class="detail-value">${item.source}</div></div>
    <div class="detail-row"><div class="detail-label">发布者</div><div class="detail-value">${item.author}</div></div>
    <div class="detail-row"><div class="detail-label">类别</div><div class="detail-value"><span class="tag ${catClass}">${catLabel}</span></div></div>
    <div class="detail-row"><div class="detail-label">情感倾向</div><div class="detail-value"><span class="tag tag-sentiment-${item.sentiment}">${getSentimentLabel(item.sentiment)}</span></div></div>
    <div class="detail-row"><div class="detail-label">热度</div><div class="detail-value"><span style="font-weight:600;color:var(--gold);">🔥 ${item.heatScore || 0}</span> <span style="color:var(--text-dim);font-size:12px;">(👍${item.likes || 0} 💬${item.comments || 0} ⭐${item.favorites || 0})</span></div></div>
    <div class="detail-row"><div class="detail-label">关键词</div><div class="detail-value">${kwHtml}</div></div>
    <div class="detail-row"><div class="detail-label">标题</div><div class="detail-value" style="font-weight:600;">${item.title}</div></div>
    <div class="detail-row"><div class="detail-label">内容详情</div></div>
    <div class="detail-content">${item.content}</div>
    <div class="detail-row" style="margin-top:20px;"><div class="detail-label">原文链接</div><div class="detail-value"><a href="${item.url}" target="_blank" class="link-btn">${item.url}</a></div></div>
    <div class="detail-row"><div class="detail-label">处理状态</div><div class="detail-value">${item.status}</div></div>
    ${amountHtml}
    <div style="margin-top:24px;padding-top:20px;border-top:1px solid var(--border);">
      <div style="font-size:12px;font-weight:600;color:var(--text-dim);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:16px;">舆情处理时间线</div>
      <div class="timeline">
        <div class="timeline-item"><div class="timeline-time">${item.date}</div><div class="timeline-text">舆情发布</div></div>
        <div class="timeline-item"><div class="timeline-time">${item.date}</div><div class="timeline-text">系统收录并标记：${getSentimentLabel(item.sentiment)}</div></div>
        <div class="timeline-item"><div class="timeline-time">${loadedData.reportDate || '今日'}</div><div class="timeline-text">当前状态：${item.status}</div></div>
      </div>
    </div>
    <div class="feedback-area">
      <div class="feedback-title">这条舆情判断是否准确？</div>
      <div class="feedback-buttons">
        <button class="feedback-btn ${fbYesClass}" id="fb-yes-${item.id}" onclick="submitFeedback('${item.id}', true)">✓ 准确</button>
        <button class="feedback-btn ${fbNoClass}" id="fb-no-${item.id}" onclick="submitFeedback('${item.id}', false)">✗ 不准确</button>
      </div>
      <div class="feedback-note" id="fb-msg-${item.id}">${fbMsg}</div>
    </div>`;

  document.getElementById('modal').classList.add('active');
}'''

html = html.replace(old_showdetail, new_showdetail)

# ============================================================
# 7. 添加反馈相关的JS函数
# ============================================================
# 在 closeModal 函数后面插入反馈函数
feedback_js = '''
// ===================== 用户反馈 =====================
const FEEDBACK_KEY = 'sentiment_feedback_v1';

function getFeedback(id) {
  try {
    const data = JSON.parse(localStorage.getItem(FEEDBACK_KEY) || '{}');
    return data[id] || null;
  } catch (e) { return null; }
}

function submitFeedback(id, isAccurate) {
  try {
    const data = JSON.parse(localStorage.getItem(FEEDBACK_KEY) || '{}');
    data[id] = isAccurate ? 'yes' : 'no';
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(data));

    // 更新UI
    const yesBtn = document.getElementById('fb-yes-' + id);
    const noBtn = document.getElementById('fb-no-' + id);
    const msgEl = document.getElementById('fb-msg-' + id);

    if (yesBtn) {
      yesBtn.classList.toggle('active-yes', isAccurate);
      yesBtn.classList.toggle('active-no', false);
    }
    if (noBtn) {
      noBtn.classList.toggle('active-no', !isAccurate);
      noBtn.classList.toggle('active-yes', false);
    }
    if (msgEl) {
      msgEl.textContent = isAccurate ? '您已标记为「准确」，感谢反馈！' : '您已标记为「不准确」，我们会持续优化。';
    }

    // 可选：console记录
    console.log('[Feedback]', id, isAccurate ? 'accurate' : 'inaccurate');
  } catch (e) {
    console.warn('反馈保存失败', e);
  }
}
'''

# 找到 closeModal 函数末尾，在其后插入
closemodal_pattern = '''function closeModal() {
  document.getElementById('modal').classList.remove('active');
}'''

html = html.replace(closemodal_pattern, closemodal_pattern + feedback_js)

# ============================================================
# 8. 确保移动端筛选面板的 change 事件也触发 applyFilters
# ============================================================
# 在初始化处的 change 事件监听器也加上 filter-keyword 的 enter 事件
old_init_events = """  ['filter-sentiment', 'filter-source', 'filter-category'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('change', applyFilters);
  });"""

new_init_events = """  ['filter-sentiment', 'filter-source', 'filter-category'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('change', applyFilters);
  });
  // 筛选器 change 时同步热词云高亮状态
  var kwInput = document.getElementById('filter-keyword');
  if (kwInput) {
    kwInput.addEventListener('input', function() {
      var val = kwInput.value.trim();
      if (!val) hideKeywordFilterHint();
      else showKeywordFilterHint(val);
      renderWordCloud();
    });
  }"""

html = html.replace(old_init_events, new_init_events)

# ============================================================
# 9. 修改时间线部分的 border-top 颜色（原来是 #eee 在深色模式下看不见）
# ============================================================
# 已经在 showDetail 中修复了

# ============================================================
# 10. 移动端响应式：filter-bar 适配
# ============================================================
# 在 @media (max-width: 768px) 中添加
old_mobile_css = '''  .filter-section {
    padding: 14px 16px;
    gap: 10px;
  }

  .filter-section .filter-desktop {
    display: none;
  }'''

new_mobile_css = '''  .filter-section {
    padding: 14px 16px;
    gap: 10px;
  }

  .filter-section .filter-desktop {
    display: none;
  }

  .filter-bar {
    padding: 8px 0;
  }

  .filter-bar .filter-desktop {
    display: none;
  }'''

html = html.replace(old_mobile_css, new_mobile_css)

# ============================================================
# 11. 修改热词云 panel 标题
# ============================================================
old_wordcloud_title = '''    <div class="chart-panel wide" data-delay="9">
      <div class="panel-header">
        <span class="panel-number">04</span>
        <h3>热词云</h3>
      </div>
      <div class="panel-body" id="word-cloud"></div>
    </div>'''

new_wordcloud_title = '''    <div class="chart-panel wide" data-delay="9">
      <div class="panel-header">
        <span class="panel-number">04</span>
        <h3>热词云</h3>
      </div>
      <div class="panel-body" id="word-cloud" style="padding:0;"></div>
    </div>'''

html = html.replace(old_wordcloud_title, new_wordcloud_title)

# ============================================================
# 12. 写回文件
# ============================================================
with open('dashboard.html', 'w', encoding='utf-8') as f:
    f.write(html)

print('Done. File written.')
