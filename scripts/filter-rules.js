/**
 * filter-rules.js
 * 舆情数据过滤规则引擎
 * 统一过滤不需要的噪音数据（互助帖、广告、无关内容等）
 */

// ==================== 过滤规则配置 ====================

/**
 * 互助帖过滤 - 用户互相点赞、关注、组队等低价值内容
 */
const HUZHU_KEYWORDS = [
  '互点', '互赞', '互关', '搭子', '互助',
  '互粉', '互刷', '互评', '互收藏',
  '求互', '来互', '互的', '互一下',
  '组队', '组队做', '组队互', '组队刷',
  '拉人', '拉新', '助力', '帮点',
  '互相点', '互相赞', '互相关',
  '抱团', '互暖', '互t', '互d'
];

/**
 * 广告/营销帖过滤 - 明显商业推广、非真实用户内容
 */
const AD_KEYWORDS = [
  '推广', '广告', '代运营', '代发',
  '接单', '接广告', '商务合作',
  '软文', '文案代写', '代笔',
  '刷量', '买粉', '买赞', '买评论',
  '水军', '僵尸粉', '机器刷',
  '代刷', '代做任务', '任务代做'
];

/**
 * 无关银行过滤 - 其他银行活动，与工行无关
 */
const IRRELEVANT_BANK_KEYWORDS = [
  '农业银行', '农行', '建设银行', '建行',
  '中国银行', '中行', '招商银行', '招行',
  '邮储银行', '交通银行', '交行',
  '中信银行', '光大银行', '浦发银行',
  '平安银行', '兴业银行', '广发银行',
  '华夏银行', '民生银行', '恒丰银行',
  '浙商银行', '渤海银行', '微众银行',
  '网商银行', '百信银行'
];

// 注意：以下关键词需要出现在不含"工行/工银/工商银行"的上下文中才算无关

/**
 * 合并所有噪音关键词（用于快速匹配）
 */
const ALL_NOISE_KEYWORDS = [
  ...HUZHU_KEYWORDS,
  ...AD_KEYWORDS
];

// ==================== 过滤函数 ====================

/**
 * 检查文本是否包含互助相关关键词
 * @param {string} title
 * @param {string} content
 * @returns {boolean} true = 是互助帖（应过滤）
 */
function isHuZhu(title, content) {
  const text = `${title || ''} ${content || ''}`;
  return HUZHU_KEYWORDS.some(kw => text.includes(kw));
}

/**
 * 检查是否为广告/营销帖
 * @param {string} title
 * @param {string} content
 * @returns {boolean} true = 是广告（应过滤）
 */
function isAd(title, content) {
  const text = `${title || ''} ${content || ''}`;
  return AD_KEYWORDS.some(kw => text.includes(kw));
}

/**
 * 检查是否为其他银行内容（不含工行关键词时）
 * @param {string} title
 * @param {string} content
 * @returns {boolean} true = 无关银行内容（应过滤）
 */
function isIrrelevantBank(title, content) {
  const text = `${title || ''} ${content || ''}`;
  // 如果包含工行相关，不算无关
  if (/工行|工银|工商银行|ICBC/.test(text)) return false;
  // 如果不含工行但含其他银行，算无关
  return IRRELEVANT_BANK_KEYWORDS.some(kw => text.includes(kw));
}

/**
 * 检查是否包含工行相关关键词
 * @param {string} title
 * @param {string} content
 * @returns {boolean} true = 包含工行相关内容
 */
function containsICBC(title, content) {
  const text = `${title || ''} ${content || ''}`;
  return /工行|工银|工商银行|ICBC|爱购周末|工银星礼遇/i.test(text);
}

/**
 * 通用噪音过滤 - 一键过滤所有非必要内容
 * @param {Object} record - 单条舆情记录
 * @returns {Object|null} 过滤后的记录，或 null（表示应丢弃）
 */
function filterNoise(record) {
  const title = record.title || '';
  const content = record.content || record.title || '';

  // 1. 过滤互助帖
  if (isHuZhu(title, content)) {
    return { ...record, _filtered: true, _filterReason: '互助帖' };
  }

  // 2. 过滤广告
  if (isAd(title, content)) {
    return { ...record, _filtered: true, _filterReason: '广告营销' };
  }

  // 3. 过滤无关银行
  if (isIrrelevantBank(title, content)) {
    return { ...record, _filtered: true, _filterReason: '非工行内容' };
  }

  // 4. 【新增】过滤完全不包含工行关键词的内容（如娱乐新闻、明星八卦等）
  if (!containsICBC(title, content)) {
    return { ...record, _filtered: true, _filterReason: '非工行内容' };
  }

  return record;
}

/**
 * 批量过滤 - 返回过滤后的记录数组 + 过滤统计
 * @param {Array} records
 * @returns {Object} { kept, removed, stats }
 */
function filterBatch(records) {
  const kept = [];
  const removed = [];
  const stats = {
    total: records.length,
    kept: 0,
    removed: 0,
    byReason: {}
  };

  for (const r of records) {
    const result = filterNoise(r);
    if (result._filtered) {
      removed.push(result);
      const reason = result._filterReason;
      stats.byReason[reason] = (stats.byReason[reason] || 0) + 1;
      stats.removed++;
    } else {
      kept.push(result);
      stats.kept++;
    }
  }

  return { kept, removed, stats };
}

// ==================== 导出 ====================
module.exports = {
  HUZHU_KEYWORDS,
  AD_KEYWORDS,
  IRRELEVANT_BANK_KEYWORDS,
  ALL_NOISE_KEYWORDS,
  isHuZhu,
  isAd,
  isIrrelevantBank,
  containsICBC,
  filterNoise,
  filterBatch
};
